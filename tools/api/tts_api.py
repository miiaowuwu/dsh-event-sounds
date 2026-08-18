"""百炼 CosyVoice API 文生音频（音色复刻 + 语音合成，云调用）

由使用者自备阿里云百炼 API Key，脚本调用云端 CosyVoice 合成音频。

运行（任意 Python 3，无需 conda/GPU，仅标准库）:
    python tts_api.py                      # 交互式填写
    python tts_api.py "要合成的文本"       # 直接传文本
    python tts_api.py 文本.txt             # 传文本文件

注意: 调用 API 会产生 token 消耗，费用由使用者自行承担。

音色处理（默认自动，无需去控制台操作）:
  AUTO_CLONE=True 时，脚本自动把参考音频上传到免费公共文件服务，
  调用百炼「声音复刻」接口创建音色并缓存（api_voice_id.txt），后续自动复用；
  想每次强制重新创建音色，把 REFRESH_VOICE 设为 True。
  也可设 AUTO_CLONE=False，在百炼控制台「声音复刻」手动创建音色，把音色名填入 VOICE_NAME。

一次性准备:
1. 注册/登录阿里云并实名认证
2. 开通"百炼"(大模型服务平台)，获取 API Key(sk-xxx)，填入下方 API_KEY 或环境变量 DASHSCOPE_API_KEY
"""
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import wave

# ==================== 配置区 ====================
# 使用者自己的 API Key（也可用环境变量 DASHSCOPE_API_KEY 提供）
API_KEY = os.environ.get('DASHSCOPE_API_KEY', '')
# 合成接口地址：留空则按下方规则自动拼默认百炼地址；
# 若接入自定义网关/其他服务，可直接填完整 URL（如 https://your-host/api/v1/services/audio/tts/SpeechSynthesizer）
API_ENDPOINT = ''
# 百炼业务空间 ID：仅在 API_ENDPOINT 留空时生效；
# 留空则使用默认域名 dashscope.aliyuncs.com，填了则使用 cn-beijing 专属域名
WORKSPACE_ID = ''
# 语音合成模型：可自定义；必须与音色创建时 target_model 一致
# cosyvoice-v3.5-plus(1.5元/万字符) / cosyvoice-v3.5-flash(0.8元/万字符) / cosyvoice-v3-flash / cosyvoice-v2 等
MODEL = 'cosyvoice-v3.5-plus'
# 复刻音色名：仅在 AUTO_CLONE=False 时使用（控制台创建后获得，如 cosyvoice-v3.5-plus-bailian-xxx）
VOICE_NAME = ''
# 示例音频（调音色）：默认取脚本同目录的 reference.wav（分发时把音频命名为 reference.wav 放旁边即可）；
# 想用其他角色/示例音频，改这个路径或直接替换 reference.wav
REFERENCE_WAV = os.path.join(os.path.dirname(__file__), 'reference.wav')
# 合成音频输出目录（统一进插件音效库目录 sounds/generated/，可被音效库 manifest 引用）
OUTPUT_DIR = os.path.normpath(os.path.join(os.path.dirname(__file__), '..', '..', 'sounds', 'generated'))
# 输出采样率（Hz）
SAMPLE_RATE = 24000
# 末尾裁切（秒）：若合成音频结尾有"滴"声等伪影，可设为 0.3 左右裁掉最后一段
TRIM_TAIL_SEC = 0.0
# 单次请求最大字符数（超长文本自动按句切分）
MAX_CHARS_PER_REQUEST = 500
# 待合成文本：留空则运行时提示输入
TTS_TEXT = ''
# 自动音色：True=脚本自动上传示例音频创建/复用复刻音色（无需手动去控制台建）；
# False=使用上方 VOICE_NAME（手动在控制台创建）
AUTO_CLONE = False
# 自动创建音色时的名称前缀（仅数字/英文字母，<=10 字符）
VOICE_PREFIX = 'angelina'
# 是否每次强制重新上传并创建音色（默认复用已创建音色，节省配额与时间）
REFRESH_VOICE = False
# 音色缓存文件（保存已创建的 voice_id，自动复用）
VOICE_CACHE_FILE = os.path.join(os.path.dirname(__file__), 'api_voice_id.txt')
# 声音复刻接口地址：留空则与合成接口同规则自动推导
CUSTOMIZATION_ENDPOINT = ''
# ---- OSS 上传（推荐，国内稳定；免费额度足够）----
# 参考音频需公网 URL，百炼复刻接口才能访问。
# 国内网络连不上国外免费图床时，用阿里云 OSS：
#   1. 开通 OSS，创建 Bucket（地域选华北2北京，读写权限选"公共读"）
#   2. 创建 RAM AccessKey(ID/Secret)，授权该 Bucket 读写
#   3. 把下面 4 项填好（Secret 也可用环境变量，勿公开）
OSS_BUCKET = ''                    # 例如 my-tts-ref
OSS_ENDPOINT = ''                  # 例如 oss-cn-beijing.aliyuncs.com
OSS_ACCESS_KEY_ID = os.environ.get('OSS_ACCESS_KEY_ID', '')
OSS_ACCESS_KEY_SECRET = os.environ.get('OSS_ACCESS_KEY_SECRET', '')
# ===============================================

SETUP_GUIDE = """请先完成以下一次性准备（费用自负）:
  1. 阿里云实名认证后开通「百炼」
  2. 创建 API Key(sk-xxx)，配置到本脚本 API_KEY 或环境变量 DASHSCOPE_API_KEY
  （默认 AUTO_CLONE=True，脚本会自动上传示例音频创建并复用复刻音色，无需手动操作；
    也可设 AUTO_CLONE=False 并在控制台「声音复刻」手动创建音色，把音色名填入 VOICE_NAME）"""


def split_text(text, max_chars):
    """按句子边界切分长文本，避免单次请求超限"""
    if len(text) <= max_chars:
        return [text]
    chunks, cur = [], ''
    for seg in text.split('。'):
        piece = seg + '。' if seg else ''
        if len(cur) + len(piece) > max_chars and cur:
            chunks.append(cur)
            cur = ''
        cur += piece
    if cur.strip():
        chunks.append(cur)
    return chunks


def synthesize(text, api_key, model, voice, base_url):
    """调用非实时语音合成 HTTP API。

    服务端以 JSON 返回带签名的音频 URL（output.audio.url），下载该 wav 后按帧拼接，
    返回 (拼接后的音频帧, wav参数)，长文本自动切分也不会产生多个输出文件。
    """
    import io
    frames_all = b''
    wav_params = None
    total_chars = 0
    chunks = split_text(text, MAX_CHARS_PER_REQUEST)
    for i, chunk in enumerate(chunks):
        payload = {
            'model': model,
            'input': {'text': chunk, 'voice': voice},
            'format': 'wav',
            'sample_rate': SAMPLE_RATE,
        }
        req = urllib.request.Request(
            base_url,
            data=json.dumps(payload).encode('utf-8'),
            headers={'Authorization': 'Bearer {}'.format(api_key), 'Content-Type': 'application/json'},
            method='POST')
        try:
            with urllib.request.urlopen(req, timeout=180) as resp:
                body = resp.read().decode('utf-8', 'ignore')
        except urllib.error.HTTPError as e:
            body = e.read().decode('utf-8', 'ignore')
            hint = ''
            if e.code == 400 and ('418' in body or 'voice' in body.lower()):
                hint = ('\n  提示: 请检查 VOICE_NAME 是否为百炼控制台「声音复刻」创建的复刻音色名'
                        '(格式类似 cosyvoice-v3.5-plus-xxx)，且创建音色时选择的模型必须与 MODEL 一致')
            raise RuntimeError('API 调用失败 (HTTP {}): {}{}'.format(e.code, body[:500], hint))
        try:
            obj = json.loads(body)
        except Exception:
            raise RuntimeError('响应不是 JSON: {}'.format(body[:300]))
        audio_url = obj.get('output', {}).get('audio', {}).get('url')
        if not audio_url:
            raise RuntimeError('响应中无音频 URL: {}'.format(body[:300]))
        total_chars += obj.get('usage', {}).get('characters', 0)
        with urllib.request.urlopen(audio_url, timeout=120) as aresp:
            audio_bytes = aresp.read()
        with wave.open(io.BytesIO(audio_bytes), 'rb') as wf:
            params = (wf.getnchannels(), wf.getsampwidth(), wf.getframerate())
            if wav_params is None:
                wav_params = params
            elif params != wav_params:
                raise RuntimeError('分段音频格式不一致: {} vs {}'.format(wav_params, params))
            frames_all += wf.readframes(wf.getnframes())
        print('  第 {}/{} 段完成 ({} 字)'.format(i + 1, len(chunks), len(chunk)))
    print('  计费字符: {}'.format(total_chars))
    return frames_all, wav_params


def save_wav(frames, wav_params, out_path):
    channels, sampwidth, framerate = wav_params
    with wave.open(out_path, 'wb') as wf:
        wf.setnchannels(channels)
        wf.setsampwidth(sampwidth)
        wf.setframerate(framerate)
        wf.writeframes(frames)


def show_reference_info(ref_wav):
    if not os.path.exists(ref_wav):
        print('  [warn] 参考音频不存在: {}'.format(ref_wav))
        return
    try:
        import soundfile
        info = soundfile.info(ref_wav)
        print('  参考音频: {:.1f}s, {}Hz, {}声道 (建议 10~20 秒)'.format(
            info.duration, info.samplerate, info.channels))
    except ImportError:
        print('  参考音频: {}'.format(ref_wav))


def multipart_upload(upload_url, filepath, field='file', extra=None, timeout=60):
    """用 urllib 做 multipart/form-data 上传，返回响应文本"""
    import uuid
    boundary = '----WebKitFormBoundary' + uuid.uuid4().hex
    with open(filepath, 'rb') as f:
        content = f.read()
    parts = []
    for k, v in (extra or {}).items():
        parts += [('--' + boundary).encode(),
                  'Content-Disposition: form-data; name="{}"'.format(k).encode(), b'', str(v).encode()]
    parts += [('--' + boundary).encode(),
              'Content-Disposition: form-data; name="{}"; filename="{}"'.format(
                  field, os.path.basename(filepath)).encode(),
              b'Content-Type: application/octet-stream', b'', content,
              ('--' + boundary + '--').encode(), b'']
    req = urllib.request.Request(upload_url, data=b'\r\n'.join(parts),
                                 headers={'Content-Type': 'multipart/form-data; boundary=' + boundary},
                                 method='POST')
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return resp.read().decode('utf-8', 'ignore')


def oss_upload(filepath):
    """用阿里云 OSS 签名 PUT 上传，返回公网直链 URL（需 Bucket 为公共读）"""
    import base64
    import hashlib
    import hmac
    import email.utils

    if not (OSS_BUCKET and OSS_ENDPOINT and OSS_ACCESS_KEY_ID and OSS_ACCESS_KEY_SECRET):
        raise RuntimeError('未配置 OSS（OSS_BUCKET/OSS_ENDPOINT/OSS_ACCESS_KEY_ID/OSS_ACCESS_KEY_SECRET）')
    object_name = 'cosyvoice-ref/{}'.format(os.path.basename(filepath))
    url = 'https://{}.{}/{}'.format(OSS_BUCKET, OSS_ENDPOINT, object_name)
    date = email.utils.formatdate(usegmt=True)
    content_type = 'application/octet-stream'
    string_to_sign = 'PUT\n\n{}\n{}\n/{}/{}'.format(content_type, date, OSS_BUCKET, object_name)
    signature = base64.b64encode(
        hmac.new(OSS_ACCESS_KEY_SECRET.encode(), string_to_sign.encode(), hashlib.sha1).digest()).decode()
    req = urllib.request.Request(
        url, data=open(filepath, 'rb').read(), method='PUT',
        headers={'Authorization': 'OSS {}:{}'.format(OSS_ACCESS_KEY_ID, signature),
                 'Date': date, 'Content-Type': content_type})
    with urllib.request.urlopen(req, timeout=60) as resp:
        if resp.status != 200:
            raise RuntimeError('OSS 上传失败 (HTTP {})'.format(resp.status))
    return url


def upload_public(wav_path):
    """把参考音频上传到公网，返回直链 URL。
    优先 OSS（国内稳定），否则尝试免费公共文件服务。
    注意: 参考音频会上传到公共可访问位置（建议个人/非营利用途使用）。"""
    if OSS_BUCKET:
        try:
            url = oss_upload(wav_path)
            print('  uploaded -> {} (OSS)'.format(url))
            return url
        except Exception as e:
            print('  [warn] OSS 上传失败: {}，尝试公共文件服务...'.format(e))
    services = [
        ('tmpfiles.org', 'https://tmpfiles.org/api/v1/upload', 'file', None, 'json_url'),
        ('0x0.st', 'https://0x0.st', 'file', None, 'text'),
        ('catbox.moe', 'https://catbox.moe/user/api.php', 'fileToUpload', {'reqtype': 'fileupload'}, 'text'),
    ]
    last_err = ''
    for name, url, field, extra, mode in services:
        try:
            text = multipart_upload(url, wav_path, field=field, extra=extra)
            if mode == 'json_url':
                text = json.loads(text)['data']['url']
            text = text.strip().rstrip('.')
            if text.startswith('http'):
                print('  uploaded -> {} ({})'.format(text, name))
                return text
            last_err = '{}: 返回异常 {}'.format(name, text[:100])
        except Exception as e:
            last_err = '{}: {}'.format(name, e)
        print('  [warn] {} 上传失败，尝试下一个...'.format(name))
    raise RuntimeError('参考音频上传失败: {}。可检查网络后重试，或设 AUTO_CLONE=False 手动在控制台创建音色并填 VOICE_NAME'.format(last_err))


def customization_url():
    if CUSTOMIZATION_ENDPOINT:
        return CUSTOMIZATION_ENDPOINT
    if WORKSPACE_ID:
        return 'https://{}.cn-beijing.maas.aliyuncs.com/api/v1/services/audio/tts/customization'.format(WORKSPACE_ID)
    return 'https://dashscope.aliyuncs.com/api/v1/services/audio/tts/customization'


def create_voice(api_key, target_model, audio_url):
    """调用声音复刻接口创建音色，返回 voice_id"""
    payload = {
        'model': 'voice-enrollment',
        'input': {
            'action': 'create_voice',
            'target_model': target_model,
            'url': audio_url,
            'prefix': VOICE_PREFIX,
            'language_hints': ['zh'],
        },
    }
    req = urllib.request.Request(
        customization_url(),
        data=json.dumps(payload).encode('utf-8'),
        headers={'Authorization': 'Bearer {}'.format(api_key), 'Content-Type': 'application/json'},
        method='POST')
    try:
        with urllib.request.urlopen(req, timeout=180) as resp:
            data = json.loads(resp.read().decode('utf-8'))
    except urllib.error.HTTPError as e:
        body = e.read().decode('utf-8', 'ignore')
        raise RuntimeError('创建音色失败 (HTTP {}): {}'.format(e.code, body[:500]))
    voice_id = data.get('output', {}).get('voice_id') or data.get('output', {}).get('voiceName')
    if not voice_id:
        raise RuntimeError('创建音色响应异常: {}'.format(str(data)[:500]))
    return voice_id


def get_or_create_voice(api_key, model):
    """自动模式：优先复用已创建音色，否则上传参考音频并创建"""
    cache = {}
    if os.path.exists(VOICE_CACHE_FILE):
        try:
            with open(VOICE_CACHE_FILE, encoding='utf-8') as f:
                cache = json.load(f)
        except Exception:
            cache = {}
    if cache.get('model') == model and cache.get('voice_id') and not REFRESH_VOICE:
        print('voice: {} (复用已创建音色，缓存)'.format(cache['voice_id']))
        return cache['voice_id']
    print('上传示例音频并创建音色: {}'.format(REFERENCE_WAV))
    audio_url = upload_public(REFERENCE_WAV)
    voice_id = create_voice(api_key, model, audio_url)
    with open(VOICE_CACHE_FILE, 'w', encoding='utf-8') as f:
        json.dump({'model': model, 'voice_id': voice_id}, f, ensure_ascii=False)
    print('voice created: {}'.format(voice_id))
    return voice_id


def main():
    api_key = API_KEY
    voice = VOICE_NAME
    ref_wav = REFERENCE_WAV
    text = TTS_TEXT or (sys.argv[1] if len(sys.argv) > 1 else '')

    if not api_key:
        print(SETUP_GUIDE)
        return 1

    # 音色解析：AUTO_CLONE=True 时自动上传创建/复用复刻音色；
    # VOICE_NAME 仅在 AUTO_CLONE=False 的手动模式下生效
    if AUTO_CLONE:
        voice = get_or_create_voice(api_key, MODEL)
    elif not voice:
        print('未配置 VOICE_NAME：请手动在控制台创建音色后填入，或设 AUTO_CLONE=True 自动创建')
        print(SETUP_GUIDE)
        return 1

    interactive = not text

    # 1. 示例音频（调音色）：默认 晋升后交谈1.wav，可换其他角色/示例音频
    print('示例音频(调音色): {}'.format(ref_wav))
    if interactive:
        ans = input('  回车用默认，或输入其他示例音频路径: ').strip()
        if ans:
            ref_wav = ans
    show_reference_info(ref_wav)

    # 2. 待合成文本
    if interactive:
        text = input('请输入待合成文本: ').strip()
    if not text:
        print('文本为空，退出')
        return 1
    if text.lower().endswith('.txt') and os.path.exists(text):
        with open(text, encoding='utf-8') as f:
            text = f.read().strip()

    if API_ENDPOINT:
        base_url = API_ENDPOINT
    elif WORKSPACE_ID:
        base_url = ('https://{}.cn-beijing.maas.aliyuncs.com/api/v1/services/audio/tts/SpeechSynthesizer'
                    .format(WORKSPACE_ID))
    else:
        base_url = 'https://dashscope.aliyuncs.com/api/v1/services/audio/tts/SpeechSynthesizer'

    print('\nendpoint={}'.format(base_url))
    print('model={} voice={}'.format(MODEL, voice))
    print('synthesizing {} 字 ...'.format(len(text)))
    t0 = time.time()
    frames, wav_params = synthesize(text, api_key, MODEL, voice, base_url)
    if TRIM_TAIL_SEC > 0:
        channels, sampwidth, framerate = wav_params
        trim_bytes = int(TRIM_TAIL_SEC * framerate * sampwidth * channels)
        if len(frames) > trim_bytes:
            frames = frames[:-trim_bytes]
    os.makedirs(OUTPUT_DIR, exist_ok=True)
    out_path = os.path.join(OUTPUT_DIR, 'api_{}.wav'.format(time.strftime('%Y%m%d_%H%M%S')))
    save_wav(frames, wav_params, out_path)
    print('done in {:.1f}s -> {} ({:.0f} KB)'.format(time.time() - t0, out_path, len(frames) / 1024))
    return 0


if __name__ == '__main__':
    sys.exit(main())
