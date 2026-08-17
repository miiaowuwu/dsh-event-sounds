# =============================================================
# dsh-event-sounds —— 卸载脚本（删除安装）
#
# 用法（任选其一）：
#   1. 右键本文件 ->「使用 PowerShell 运行」
#   2. 在 PowerShell 中执行：  & "D:\...\dsh-event-sounds\uninstall.ps1"
#
# 作用：从桌面应用的 desktop profile 中移除本插件（dependencies +
#       bundles），并清理 node_modules 里的链接。可重复执行。
# 卸载完重启 DeepSeek Harness Desktop 即可生效。
# =============================================================
$ErrorActionPreference = "Stop"

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

# 2) 从 profile 的 dependencies 与 bundles 中移除插件（UTF-8 读写，保留中文路径）
Write-Host "[1/2] 从 desktop profile 移除插件 ..."
$json = Get-Content $pkgFile -Raw -Encoding UTF8 | ConvertFrom-Json
if ($json.dependencies.PSObject.Properties.Name -contains $pluginName) {
    $json.dependencies.PSObject.Properties.Remove($pluginName)
}
if ($pluginName -in $json.dsh.profile.bundles) {
    $json.dsh.profile.bundles = @($json.dsh.profile.bundles | Where-Object { $_ -ne $pluginName })
}
[System.IO.File]::WriteAllText($pkgFile, ($json | ConvertTo-Json -Depth 10), (New-Object System.Text.UTF8Encoding($false)))

# 3) 用应用自带 pnpm 清理 node_modules 中的链接
Write-Host "[2/2] 清理依赖链接 ..."
Push-Location $profileDir
try {
    & $pnpm install
    if ($LASTEXITCODE -ne 0) { throw "pnpm install 失败（退出码 $LASTEXITCODE）" }
} finally {
    Pop-Location
}

Write-Host ""
Write-Host "================================================" -ForegroundColor Yellow
Write-Host " 卸载完成！请重启 DeepSeek Harness Desktop。"      -ForegroundColor Yellow
Write-Host "================================================" -ForegroundColor Yellow
