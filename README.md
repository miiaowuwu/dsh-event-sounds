# dsh-event-sounds — Voice Control Plugin (Angelina「hirari do～」)

English | [中文](README.zh.md)

A DSH Web GUI client plugin: plays a chosen sound effect when the conversation **ends / shows options / requests permission / stops**.

> 🐋 Character reference: a fan-made project for **Angelina** from *Arknights*. The bundled sample sounds are Angelina's "hirari do～" and "Huh?" voice clips, for personal learning and entertainment only — **not for commercial use**.

## Install

**DeepSeek Harness Desktop users (recommended — no dependencies needed):**

1. **Quit the desktop app**
2. From [Releases](https://github.com/miiaowuwu/dsh-event-sounds/releases) download [dsh-event-sounds-Setup-1.0.0-x64.exe](https://github.com/miiaowuwu/dsh-event-sounds/releases/latest/download/dsh-event-sounds-Setup-1.0.0-x64.exe) and **double-click it**
3. **Restart the app** — the 🔊 floating ball means it's installed

The installer calls the official `dsh plugin` command using the app's bundled runtime. Fully automated, no manual config edits.

- **Update**: run the Setup exe again and restart the app
- **Uninstall**: double-click [dsh-event-sounds-UnSetup-1.0.0-x64.exe](https://github.com/miiaowuwu/dsh-event-sounds/releases/latest/download/dsh-event-sounds-UnSetup-1.0.0-x64.exe) and restart the app

**`npx @deepseek-ai/dsh web` users (need Node.js + pnpm + git):**

```bash
npx @deepseek-ai/dsh plugin --profile web add github:miiaowuwu/dsh-event-sounds
npx @deepseek-ai/dsh web
```

> If GitHub is unstable in your region, install from a local path instead: `npx @deepseek-ai/dsh plugin --profile web add link:D:/your/path/dsh-event-sounds`

## Features

- **Draggable floating ball** (🔊): drag it anywhere on screen; **dragging it to a screen edge collapses it into a small half-ball (a ">" icon only)**; click to open the settings dialog; position is persisted, defaults to the left side
- **Settings dialog**: draggable (grab the title bar), z-index on top
  - 4 trigger conditions: **session end / options popup / permission request / stop**, each with an independent 【enable checkbox + sound dropdown】
  - **Appearance**: Whale Girl (default) / Pure White / Pure Black
  - Volume slider (0–100%), ▶ test playback + status bar, reset button position
  - Sound library (local audio in the plugin `sounds/` folder) + refresh
- **Sound source**: local audio files in the plugin `sounds/` directory (mp3/wav/ogg/m4a/flac/opus/aac/wma/webm), served by the host side via the `/dsh-sounds-control` static server (Range/206 chunking, ETag, streaming)
- **Persistent config**: dual-write to localStorage + host-side `config.json`, survives restarts
- **Preload on startup**: fetches config and sound list and buffers the configured sound when the app opens, so the first play is instant
- Falls back to a Web Audio built-in beep when no sound is selected or loading fails

## Directory structure

```
dsh-event-sounds/
├── package.json          # Package manifest (dsh.client / dsh.bundle.patch)
├── cordis.patch.yml      # Composition patch: mounts line ui-event-sounds
├── README.md
├── LICENSE
├── sounds/               # ★ Put your audio files here (mp3/wav/ogg etc.)
├── lib/
│   ├── index.js          # Host side: /dsh-sounds-control static server (list/config/audio)
│   └── client.js         # Browser side: floating ball + settings dialog + trigger detection + playback
```

## Dual-side structure

The plugin is two halves, loaded automatically from a single install:

- **Host side (Node half)** [lib/index.js](lib/index.js): runs in the DSH main process (Node), exposes the plugin `sounds/` directory to the browser side through the `/dsh-sounds-control` static server (sound list / audio files / config.json persistence)
- **Browser side (Web GUI half)** [lib/client.js](lib/client.js): runs in the DSH Web GUI page — floating ball, settings dialog, trigger detection, and sound playback

Mounting of both halves is driven by `package.json` — no separate install needed:

- `dsh.client` declaration (`exports "./client"`) → loads the browser side in the Web GUI
- `dsh.bundle.patch` ([cordis.patch.yml](cordis.patch.yml)) → registers the host side in the DSH main process

## Usage

1. **Add sounds**: put audio files in the `sounds/` folder at the plugin root (mp3/wav/ogg/m4a/flac/opus/aac/wma/webm supported), e.g. Angelina's "hirari do～" and "Huh?" clips
2. **Open the settings dialog**: click the 🔊 floating ball
3. **Refresh the sound list**: click "Refresh"; the plugin enumerates all audio files under `sounds/`
4. **Configure triggers**: for the four events (session end / options popup / permission request / stop), set 【enable + sound】independently
5. **Test playback**: click ▶ to verify, adjust volume with the slider (0–100%)
6. **In effect**: the chosen sound plays automatically on matching events; a built-in beep plays as a fallback when nothing is selected or loading fails

> Tip: drag the floating ball anywhere; it collapses into a half-ball at screen edges; switch between Whale Girl / Pure White / Pure Black under "Appearance"; position and config are saved automatically and survive restarts.

## Disclaimer

- This is a **fan-made (unofficial) personal project** with no affiliation, sponsorship, or authorization from the official *Arknights* team or Shanghai Hypergryph Network Technology Co., Ltd.
- Character images, names, quotes, and voice assets referenced in this project (including Angelina's "hirari do～" and "Huh?" voice clips) belong to the official *Arknights* team and their respective right holders; the copyright of the voices belongs to the respective voice actors.
- This project is for personal learning, research, and entertainment only — **not for commercial use** and not for profit.
- The sound assets shipped with the project are local audio files added by users; users are responsible for ensuring their usage complies with applicable laws and the original right holders' requirements.
- If any right holder believes any content of this project infringes their rights, please contact the author to remove the material and we will handle it promptly.
- This project is provided as-is; the author is not responsible for any consequences arising from its use.
