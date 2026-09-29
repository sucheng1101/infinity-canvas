$ErrorActionPreference = "Stop"

$envFile = Join-Path $PSScriptRoot ".env.local"
if (Test-Path -LiteralPath $envFile) {
    Get-Content -LiteralPath $envFile | ForEach-Object {
        $line = $_.Trim()
        if (-not $line -or $line.StartsWith("#")) {
            return
        }
        $name, $value = $line -split "=", 2
        if ($name -and $null -ne $value) {
            [Environment]::SetEnvironmentVariable($name.Trim(), $value.Trim(), "Process")
        }
    }
}

function Test-TcpEndpoint($HostName, [int]$Port) {
    $client = New-Object System.Net.Sockets.TcpClient
    try {
        $client.Connect($HostName, $Port)
        return $true
    } catch {
        return $false
    } finally {
        $client.Close()
    }
}

$databaseDsn = if ($env:DATABASE_DSN) { $env:DATABASE_DSN } else { "root:password@tcp(127.0.0.1:3306)/infinite_canvas?charset=utf8mb4&parseTime=True&loc=UTC" }
if ($databaseDsn -notmatch "@tcp\((?<host>[^:()]+):(?<port>\d+)\)/") {
    throw "DATABASE_DSN must use a TCP MySQL address for local startup."
}
$databaseHost = $Matches.host
$databasePort = [int]$Matches.port
if (-not (Test-TcpEndpoint $databaseHost $databasePort)) {
    throw "MySQL is not accepting connections at ${databaseHost}:${databasePort}. Start MySQL and check DATABASE_DSN; its credentials are not displayed."
}

$redisAddress = if ($env:REDIS_ADDR) { $env:REDIS_ADDR } else { "127.0.0.1:6379" }
if ($redisAddress -match "^\[(?<host>.+)\]:(?<port>\d+)$") {
    $redisHost = $Matches.host
    $redisPort = [int]$Matches.port
} elseif ($redisAddress -match "^(?<host>[^:]+):(?<port>\d+)$") {
    $redisHost = $Matches.host
    $redisPort = [int]$Matches.port
} else {
    throw "REDIS_ADDR must use host:port format for local startup."
}
if (-not (Test-TcpEndpoint $redisHost $redisPort)) {
    throw "Redis is not accepting connections at ${redisHost}:${redisPort}. Start Redis and check REDIS_ADDR."
}

if ($env:SERVER_ADDR -and $env:SERVER_ADDR -notmatch ":1011$") {
    throw "SERVER_ADDR must use port 1011 because the local Vite proxy targets 127.0.0.1:1011."
}

go run .
