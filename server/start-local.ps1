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

function Find-LocalMySqlServer {
    $programFiles = [Environment]::GetFolderPath("ProgramFiles")
    $mysqlRoot = Join-Path $programFiles "MySQL"
    $candidates = Get-ChildItem -LiteralPath $mysqlRoot -Directory -Filter "MySQL Server *" -ErrorAction SilentlyContinue |
        Sort-Object Name -Descending |
        ForEach-Object { Join-Path $_.FullName "bin\mysqld.exe" }
    return $candidates | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
}

function Start-ProjectMySql([string]$HostName, [int]$Port, [string]$DbUser, [string]$DbPassword, [string]$DbName) {
    if ($HostName -notin @("127.0.0.1", "localhost") -or $Port -ne 3306) {
        return $false
    }

    $mysqlServer = Find-LocalMySqlServer
    if (-not $mysqlServer) {
        return $false
    }

    $logDir = Join-Path $env:TEMP "infinite-canvas-local"
    New-Item -ItemType Directory -Path $logDir -Force | Out-Null
    $dataDir = Join-Path $env:LOCALAPPDATA "InfiniteCanvas\mysql-data"
    $mysqlHome = Split-Path (Split-Path $mysqlServer -Parent) -Parent
    $outLog = Join-Path $logDir "mysql.out.log"
    $errLog = Join-Path $logDir "mysql.err.log"

    # An empty data directory is initialized with an empty root password and then
    # bound to the DSN credentials, so a fresh machine needs no manual database setup.
    $fresh = -not (Test-Path -LiteralPath (Join-Path $dataDir "mysql"))
    if ($fresh) {
        New-Item -ItemType Directory -Path $dataDir -Force | Out-Null
        $init = Start-Process -FilePath $mysqlServer -ArgumentList @(
            "--initialize-insecure",
            "--basedir=`"$mysqlHome`"",
            "--datadir=`"$dataDir`"",
            "--console"
        ) -Wait -PassThru -WindowStyle Hidden -RedirectStandardOutput (Join-Path $logDir "mysql-init.out.log") -RedirectStandardError (Join-Path $logDir "mysql-init.err.log")
        if ($init.ExitCode -ne 0 -or -not (Test-Path -LiteralPath (Join-Path $dataDir "mysql"))) {
            return $false
        }
    }

    $process = Start-Process -FilePath $mysqlServer -ArgumentList @(
        "--basedir=`"$mysqlHome`"",
        "--datadir=`"$dataDir`"",
        "--port=$Port",
        "--bind-address=$HostName",
        "--console"
    ) -PassThru -WindowStyle Hidden -RedirectStandardOutput $outLog -RedirectStandardError $errLog

    $ready = $false
    for ($attempt = 0; $attempt -lt 30; $attempt++) {
        if (Test-TcpEndpoint $HostName $Port) {
            $ready = $true
            break
        }
        $process.Refresh()
        if ($process.HasExited) {
            return $false
        }
        Start-Sleep -Seconds 1
    }
    if (-not $ready) {
        return (Test-TcpEndpoint $HostName $Port)
    }

    if ($fresh) {
        $statements = @("CREATE DATABASE IF NOT EXISTS ``$DbName`` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci")
        if ($DbPassword) {
            $statements = @("ALTER USER '$DbUser'@'localhost' IDENTIFIED BY '$DbPassword'") + $statements
        }
        $sqlFile = Join-Path $logDir "mysql-init.sql"
        Set-Content -LiteralPath $sqlFile -Value ($statements -join "; ") -Encoding ASCII
        $client = Start-Process -FilePath (Join-Path (Split-Path $mysqlServer -Parent) "mysql.exe") -ArgumentList @(
            "-u", $DbUser, "--skip-password", "--protocol=TCP", "-h", $HostName, "-P", "$Port"
        ) -Wait -PassThru -WindowStyle Hidden -RedirectStandardInput $sqlFile -RedirectStandardOutput (Join-Path $logDir "mysql-init-sql.out.log") -RedirectStandardError (Join-Path $logDir "mysql-init-sql.err.log")
        if ($client.ExitCode -ne 0) {
            return $false
        }
    }
    return $true
}

$databaseDsn = if ($env:DATABASE_DSN) { $env:DATABASE_DSN } else { "root:password@tcp(127.0.0.1:3306)/infinite_canvas?charset=utf8mb4&parseTime=True&loc=UTC" }
if ($databaseDsn -notmatch "^(?<user>[^:@]+)(:(?<password>[^@]*))?@tcp\((?<host>[^:()]+):(?<port>\d+)\)/(?<database>[^?]+)") {
    throw "DATABASE_DSN must use a TCP MySQL address for local startup."
}
$databaseUser = $Matches.user
$databasePassword = $Matches.password
$databaseHost = $Matches.host
$databasePort = [int]$Matches.port
$databaseName = $Matches.database
if (-not (Test-TcpEndpoint $databaseHost $databasePort)) {
    if (-not (Start-ProjectMySql $databaseHost $databasePort $databaseUser $databasePassword $databaseName)) {
        throw "MySQL is not accepting connections at ${databaseHost}:${databasePort}. Start MySQL and check DATABASE_DSN; its credentials are not displayed."
    }
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
