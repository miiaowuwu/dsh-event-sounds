# =============================================================
# build-single-exe.ps1 —— 生成自包含单文件安装/卸载器（releases 发布用）
#
# 用法：
#   右键本文件 ->「使用 PowerShell 运行」，或  & releases\build-single-exe.ps1
#
# 产物（生成到本目录下的 <版本>\）：
#   dsh-event-sounds-Setup-1.0.0-x64.exe    双击 = 安装（内嵌全部插件文件）
#   dsh-event-sounds-UnSetup-1.0.0-x64.exe  双击 = 卸载
#   两个 exe 由同一份脚本编译，运行时会按自身文件名自动判断模式。
#
# 原理：本脚本位于 releases\ 下，自动读取上一级插件包目录的全部运行文件，
#   以 base64 内嵌进 exe；安装时解压到 %LOCALAPPDATA%\dsh-event-sounds，
#   再调用官方 dsh CLI 安装。
# 前置：已安装 ps2exe（Install-Module ps2exe -Scope CurrentUser -Force）
# =============================================================
$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path   # releases\
$pkgDir    = Split-Path -Parent $scriptDir                    # 插件包根目录（releases 的上一级）

# ---- 版本与架构（改这里即可重新打包）----
$releaseVersion = "1.0.0"
$arch          = "x64"
$releaseDir    = Join-Path $scriptDir $releaseVersion
$setupExeName  = "dsh-event-sounds-Setup-$releaseVersion-$arch.exe"
$unsetupExeName = "dsh-event-sounds-UnSetup-$releaseVersion-$arch.exe"

# 需内嵌的文件（相对插件包根目录；config.json 是运行时状态，不内嵌）
$files = @(
    "package.json",
    "cordis.patch.yml",
    "README.md",
    "LICENSE",
    "lib\index.js",
    "lib\client.js",
    "sounds\README.txt",
    "sounds\「hirari do～」.mp3",
    "sounds\呢？.mp3"
)

Write-Host "[1/3] 编码插件文件（base64）..."
$dataLines = foreach ($f in $files) {
    $full = Join-Path $pkgDir $f
    if (-not (Test-Path -LiteralPath $full)) { throw "缺少文件：$f" }
    $b64 = [System.Convert]::ToBase64String([System.IO.File]::ReadAllBytes($full))
    "        @{ path = '$($f.Replace('\', '/'))'; b64 = '$b64' }"
}

$header = @'
# =============================================================
# dsh-event-sounds —— 自包含单文件安装/卸载器（由 build-single-exe.ps1 生成）
#   文件名含 UnSetup = 卸载；否则 = 安装；-Uninstall 开关强制卸载。
#   安装时会内嵌插件文件解压到 %LOCALAPPDATA%\dsh-event-sounds
# =============================================================
param(
    [switch]$Uninstall,                 # 强制卸载模式（Setup 版亦可）
    [string]$ProfileName = "desktop",   # 目标 dsh profile 名
    [string]$RuntimeBin  = ""           # 桌面应用 runtime-bin 目录（留空自动探测）
)
$ErrorActionPreference = "Stop"

try {
    # ---- 运行模式：exe 文件名含 UnSetup 即卸载，否则安装 ----
    $ownName = [System.IO.Path]::GetFileNameWithoutExtension([System.Diagnostics.Process]::GetCurrentProcess().MainModule.FileName)
    $doUninstall = $Uninstall -or ($ownName -match "UnSetup")

    # ---- 内嵌插件文件（base64）----
    $embedded = @(
'@

$footer = @'
    )
    $pluginName = "dsh-client-ui-event-sounds"
    $targetDir = Join-Path $env:LOCALAPPDATA "dsh-event-sounds"

    # ---- 安装模式才解压插件文件（卸载模式只需移除登记并清理目录）----
    if (-not $doUninstall) {
        foreach ($e in $embedded) {
            $rel = $e.path.Replace('/', '\')
            $out = Join-Path $targetDir $rel
            $outDir = Split-Path -Parent $out
            if (-not (Test-Path $outDir)) { New-Item -ItemType Directory -Force -Path $outDir | Out-Null }
            [System.IO.File]::WriteAllBytes($out, [System.Convert]::FromBase64String($e.b64))
        }
    }
    $pluginDir = $targetDir

    # ---- Harness 根目录：优先 $env:DSH_HOME（与官方 dsh CLI 解析一致），默认 ~/.dsh ----
    $dshHome = if ($env:DSH_HOME -and $env:DSH_HOME.Trim()) { $env:DSH_HOME.Trim() } else { Join-Path $env:USERPROFILE ".dsh" }
    $profileDir = Join-Path $dshHome "profiles\$ProfileName"
    $pkgFile    = Join-Path $profileDir "package.json"
    # ---- 桌面应用自带运行时目录：默认 %APPDATA%\@deepseek-ai\dsh-desktop\runtime-bin ----
    if (-not $RuntimeBin) { $RuntimeBin = Join-Path $env:APPDATA "@deepseek-ai\dsh-desktop\runtime-bin" }
    $pnpm       = Join-Path $RuntimeBin "pnpm.cmd"

    # 1) 检查桌面应用 profile 与自带运行时是否存在
    if (-not (Test-Path $pkgFile)) {
        throw "未找到桌面应用 profile：$pkgFile`n       请先安装 DeepSeek Harness Desktop 并至少启动过一次。"
    }
    if (-not (Test-Path $pnpm)) {
        throw "未找到桌面应用自带的运行时：$pnpm"
    }

    # 2) 从应用生成的 pnpm.cmd 中解析应用 exe 路径（自动适配不同安装位置）
    $exe = $null
    foreach ($line in (Get-Content $pnpm)) {
        if ($line -match '"([^"]+\.exe)"') { $exe = $matches[1]; break }
    }
    if (-not $exe -or -not (Test-Path $exe)) {
        throw "未能从 $pnpm 中解析出桌面应用 exe 路径"
    }
    $cliBin = Join-Path (Split-Path -Parent $exe) "resources\app.asar.unpacked\node_modules\@deepseek-ai\dsh\lib\bin.js"
    if (-not (Test-Path $cliBin)) {
        throw "未找到桌面应用自带的 dsh CLI：$cliBin"
    }

    $env:ELECTRON_RUN_AS_NODE = "1"
    $env:PATH = "$RuntimeBin;$env:PATH"

    if ($doUninstall) {
        # ================= 卸载 =================
        Write-Host "[1/2] 调用官方 dsh CLI 移除插件 ..."
        $json = Get-Content $pkgFile -Raw -Encoding UTF8 | ConvertFrom-Json
        $stillInstalled = ($json.dependencies.PSObject.Properties.Name -contains $pluginName) -or ($pluginName -in $json.dsh.profile.bundles)
        if ($stillInstalled) {
            $p = Start-Process -FilePath $exe -ArgumentList @("`"$cliBin`"", "plugin", "--profile", $ProfileName, "remove", $pluginName, "--config.minimumReleaseAge=0") -Wait -PassThru
            if ($p.ExitCode -ne 0) { throw "dsh plugin remove 失败（退出码 $($p.ExitCode)）" }
        } else {
            Write-Host "       插件未登记，跳过 CLI（可重复执行）。"
        }
        Write-Host "[2/2] 校验移除结果 ..."
        $json = Get-Content $pkgFile -Raw -Encoding UTF8 | ConvertFrom-Json
        if ($json.dependencies.PSObject.Properties.Name -contains $pluginName) { throw "插件仍留在 dependencies，请检查上方输出" }
        if ($pluginName -in $json.dsh.profile.bundles) { throw "插件仍留在 bundles，请检查上方输出" }
        Remove-Item -Path $targetDir -Recurse -Force -ErrorAction SilentlyContinue
        Write-Host ""
        Write-Host "================================================" -ForegroundColor Yellow
        Write-Host " 卸载完成！请重启 DeepSeek Harness Desktop。"      -ForegroundColor Yellow
        Write-Host "================================================" -ForegroundColor Yellow
    } else {
        # ================= 安装 =================
        # --config.minimumReleaseAge=0：关掉 pnpm 的"发布年龄"供应链闸门（防止误伤
        #    应用刚发布的依赖导致偶发失败）。只对本次调用生效，不修改任何配置。
        Write-Host "[1/2] 调用官方 dsh CLI 登记并安装插件 ..."
        $linkSpec = "link:$($pluginDir.Replace('\', '/'))"
        $p = Start-Process -FilePath $exe -ArgumentList @("`"$cliBin`"", "plugin", "--profile", $ProfileName, "add", "`"$linkSpec`"", "--config.minimumReleaseAge=0") -Wait -PassThru
        if ($p.ExitCode -ne 0) { throw "dsh plugin add 失败（退出码 $($p.ExitCode)）" }
        Write-Host "[2/2] 校验注册结果 ..."
        $json = Get-Content $pkgFile -Raw -Encoding UTF8 | ConvertFrom-Json
        if (-not ($json.dependencies.PSObject.Properties.Name -contains $pluginName)) { throw "插件未写入 dependencies，请检查上方输出" }
        if ($pluginName -notin $json.dsh.profile.bundles) { throw "插件未进入 bundles，请检查上方输出" }
        Write-Host ""
        Write-Host "====================================================" -ForegroundColor Green
        Write-Host " 安装完成！请重启 DeepSeek Harness Desktop。"          -ForegroundColor Green
        Write-Host " 成功标志：界面右上角绿色「dsh-event-sounds 已加载」 + 悬浮球" -ForegroundColor Green
        Write-Host "====================================================" -ForegroundColor Green
    }
} catch {
    Write-Host ""
    Write-Host "[失败] $($_.Exception.Message)" -ForegroundColor Red
    if (-not $PSScriptRoot) { Read-Host "按回车键退出" }
    exit 1
}

if (-not $PSScriptRoot) { Read-Host "按回车键退出" }
'@

Write-Host "[2/3] 生成 dsh-event-sounds.install.ps1 ..."
$generated = $header + "`r`n" + ($dataLines -join "`r`n") + "`r`n" + $footer
$genPath = Join-Path $scriptDir "dsh-event-sounds.install.ps1"
[System.IO.File]::WriteAllText($genPath, $generated, (New-Object System.Text.UTF8Encoding($true)))

Write-Host "[3/3] 编译 exe ..."
Import-Module ps2exe
Get-Process | Where-Object { $_.ProcessName -like "dsh-event-sounds*" } | Stop-Process -Force -ErrorAction SilentlyContinue

# 产物直接输出到发布目录（releases\<版本>），不在包根留副本
New-Item -ItemType Directory -Force -Path $releaseDir | Out-Null
$setupExe   = Join-Path $releaseDir $setupExeName
$unsetupExe = Join-Path $releaseDir $unsetupExeName
foreach ($out in @($setupExe, $unsetupExe)) {
    if (Test-Path $out) { try { [System.IO.File]::Delete($out) } catch {} }
}
ps2exe -inputFile $genPath -outputFile $setupExe -noConsole:$false -version "$releaseVersion.0"
ps2exe -inputFile $genPath -outputFile $unsetupExe -noConsole:$false -version "$releaseVersion.0"

# 清理中间脚本（已编译进 exe）
Remove-Item -Force $genPath -ErrorAction SilentlyContinue

Write-Host ""
Write-Host "完成！"
Write-Host "  安装：$setupExe"
Write-Host "  卸载：$unsetupExe"
