$ErrorActionPreference = "Stop"

$root = $PSScriptRoot
$serverScript = Join-Path $root "server\start-local.ps1"
$webDir = Join-Path $root "web"
$logDir = Join-Path $env:TEMP "infinite-canvas-local"
New-Item -ItemType Directory -Path $logDir -Force | Out-Null
$stamp = "$(Get-Date -Format 'yyyyMMdd-HHmmss')-$PID"
$serverOut = Join-Path $logDir "server-$stamp.out.log"
$serverErr = Join-Path $logDir "server-$stamp.err.log"
$webOut = Join-Path $logDir "web-$stamp.out.log"
$webErr = Join-Path $logDir "web-$stamp.err.log"
$launched = @()

function Test-PortAvailable([int]$Port) {
    $listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, $Port)
    $started = $false
    try {
        $listener.Start()
        $started = $true
        return $true
    } catch {
        return $false
    } finally {
        if ($started) {
            $listener.Stop()
        }
    }
}

function Test-AccountHealth {
    try {
        $health = Invoke-RestMethod -Uri "http://127.0.0.1:1011/healthz" -UseBasicParsing
        return $health.status -eq "ok" -and $health.checks.mysql -eq "ok" -and $health.checks.redis -eq "ok"
    } catch {
        return $false
    }
}

function Test-CanvasWeb {
    try {
        $response = Invoke-WebRequest -Uri "http://127.0.0.1:1010/plugins/index.json" -UseBasicParsing
        return $response.StatusCode -eq 200 -and $response.Content.TrimStart().StartsWith("[")
    } catch {
        return $false
    }
}

function Wait-ForReady($Process, [scriptblock]$Probe, [string]$Service, [string]$LogPath) {
    while ($true) {
        $Process.Refresh()
        if ($Process.HasExited) {
            $details = if (Test-Path -LiteralPath $LogPath) { (Get-Content -LiteralPath $LogPath -Tail 8 -ErrorAction SilentlyContinue) -join [Environment]::NewLine } else { "" }
            $message = "$Service exited before becoming ready. Check log: $LogPath"
            if ($details) {
                $message += [Environment]::NewLine + $details
            }
            throw $message
        }
        if (& $Probe) {
            return
        }
        Start-Sleep -Seconds 1
    }
}

function Stop-StartedProcess($Process) {
    if ($null -ne $Process) {
        $Process.Refresh()
        if (-not $Process.HasExited) {
            & taskkill.exe /PID $Process.Id /T /F | Out-Null
        }
    }
}

$accountReady = Test-AccountHealth
if (-not $accountReady -and -not (Test-PortAvailable 1011)) {
    throw "Port 1011 is occupied by a service that did not pass the account health check. No existing process was stopped."
}
$webReady = Test-CanvasWeb
if (-not $webReady -and -not (Test-PortAvailable 1010)) {
    throw "Port 1010 is occupied by a service that did not identify itself as this Vite app. No existing process was stopped."
}

try {
    if (-not $accountReady) {
        $shell = (Get-Process -Id $PID).Path
        $arguments = "-NoProfile -ExecutionPolicy Bypass -File `"$serverScript`""
        $serverProcess = Start-Process -FilePath $shell -ArgumentList $arguments -WorkingDirectory (Join-Path $root "server") -PassThru -WindowStyle Hidden -RedirectStandardOutput $serverOut -RedirectStandardError $serverErr
        $launched += $serverProcess
        Wait-ForReady $serverProcess { Test-AccountHealth } "账户服务" $serverErr
        Write-Host "账户服务已就绪：http://127.0.0.1:1011/healthz"
    } else {
        Write-Host "复用已通过健康检查的账户服务：http://127.0.0.1:1011"
    }

    if (-not $webReady) {
        $webProcess = Start-Process -FilePath (Join-Path $env:SystemRoot "System32\cmd.exe") -ArgumentList '/c "npm run dev"' -WorkingDirectory $webDir -PassThru -WindowStyle Hidden -RedirectStandardOutput $webOut -RedirectStandardError $webErr
        $launched += $webProcess
        Wait-ForReady $webProcess { Test-CanvasWeb } "前端开发服务" $webErr
    } else {
        Write-Host "复用已运行的画布前端。"
    }

    Write-Host "本地服务已就绪：http://localhost:1010"
    Write-Host "启动日志目录：$logDir"
} catch {
    foreach ($process in $launched) {
        Stop-StartedProcess $process
    }
    throw
}
