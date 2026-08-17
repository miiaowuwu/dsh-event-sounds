# =============================================================
# dsh-event-sounds —— 傻瓜式安装脚本（DeepSeek Harness Desktop）
#
# 用法（任选其一）：
#   1. 右键本文件 ->「使用 PowerShell 运行」
#   2. 在 PowerShell 中执行：  & "D:\...\dsh-event-sounds\install.ps1"
#
# 作用：自动把插件登记进桌面应用的 desktop profile（dependencies +
#       bundles），并用应用自带的 pnpm 完成安装。可重复执行。
# 装完重启 DeepSeek Harness Desktop 即可生效。
# =============================================================
$ErrorActionPreference = "Stop"

$pluginDir  = Split-Path -Parent $MyInvocation.MyCommand.Path
$pluginName = "dsh-client-ui-event-sounds"

$profileDir = Join-Path $env:USERPROFILE ".dsh\profiles\desktop"
$pkgFile    = Join-Path $profileDir "package.json"
$pnpm       = Join-Path $env:APPDATA "@deepseek-ai\dsh-desktop\runtime-bin\pnpm.cmd"

# 1) 检查桌面应用 profile 与自带 pnpm 是否存在
if (-not (Test-Path $pkgFile)) {
    Write-Host "[错误] 未找到桌面应用 profile：$pkgFile" -ForegroundColor Red
    Write-Host "       请先安装 DeepSeek Harness Desktop 并至少启动过一次。"
    exit 1
}
if (-not (Test-Path $pnpm)) {
    Write-Host "[错误] 未找到桌面应用自带的 pnpm：$pnpm" -ForegroundColor Red
    exit 1
}

# 2) 把插件登记进 profile 的 dependencies 与 bundles（保留中文路径，UTF-8 读写）
Write-Host "[1/2] 登记插件到 desktop profile ..."
$json = Get-Content $pkgFile -Raw -Encoding UTF8 | ConvertFrom-Json
$json.dependencies.$pluginName = "link:$($pluginDir.Replace('\', '/'))"
if ($pluginName -notin $json.dsh.profile.bundles) {
    $json.dsh.profile.bundles += $pluginName
}
[System.IO.File]::WriteAllText($pkgFile, ($json | ConvertTo-Json -Depth 10), (New-Object System.Text.UTF8Encoding($false)))

# 3) 用应用自带 pnpm 安装依赖
Write-Host "[2/2] 使用应用自带 pnpm 安装依赖 ..."
Push-Location $profileDir
try {
    & $pnpm install
    if ($LASTEXITCODE -ne 0) { throw "pnpm install 失败（退出码 $LASTEXITCODE）" }
} finally {
    Pop-Location
}

Write-Host ""
Write-Host "====================================================" -ForegroundColor Green
Write-Host " 安装完成！请重启 DeepSeek Harness Desktop。"          -ForegroundColor Green
Write-Host " 成功标志：界面右上角绿色「dsh-event-sounds 已加载」 + 🔊 悬浮球" -ForegroundColor Green
Write-Host "====================================================" -ForegroundColor Green
