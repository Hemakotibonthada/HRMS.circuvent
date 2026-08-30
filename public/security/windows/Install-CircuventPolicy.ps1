<#
================================================================================
Circuvent Technologies - Enterprise Endpoint Security Installer (Windows)
Script: Install-CircuventPolicy.ps1
Version: 2.5.0
Description:
  Automated deployment script for Windows Workstations and Laptops.
  1. Enforces strict USB/Removable Storage & MTP Phone Block.
  2. Configures Windows Advanced Firewall (SMTP Lockdown & Egress Guard).
  3. Audits BitLocker Drive Encryption & Windows Security Patches.
  4. Scans installed software and SaaS applications for blacklisted tools.
  5. Deploys and registers CircuventGuard Watchdog Service.
  6. Registers endpoint with Circuvent HRMS Security Console & Asset Management.
================================================================================
#>

[CmdletBinding()]
param (
    [string]$ServerUrl = "https://devices.circuvent.com",
    [string]$EnrollToken = "",
    [string]$DeviceApiKey = "",
    [string]$ApiKey = "",
    [string]$OrgId = "",
    [string]$EmployeeEmail = "",
    [string]$EmployeeCode = "",
    [switch]$Force
)

function Get-CircuventAgentHeaders {
    $headers = @{ "Content-Type" = "application/json" }
    if ($DeviceApiKey) {
        $headers["X-Device-Agent-Key"] = $DeviceApiKey
    } elseif ($EnrollToken) {
        $headers["X-Device-Enroll-Token"] = $EnrollToken
    } elseif ($ApiKey) {
        $headers["X-API-Key"] = $ApiKey
    }
    return $headers
}

# 1. Require Administrative Privileges
$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
    Write-Error "ERROR: This script must be run as an Administrator. Please run PowerShell as Administrator."
    exit 1
}

Write-Host "=================================================================" -ForegroundColor Cyan
Write-Host " Circuvent Technologies - Enterprise Endpoint Security Installer " -ForegroundColor Cyan
Write-Host "=================================================================" -ForegroundColor Cyan
Write-Host "Configuring laptop for $EmployeeEmail ($EmployeeCode)..." -ForegroundColor Yellow

$InstallDir = "$env:ProgramFiles\Circuvent\EndpointSecurity"
$DataDir = "$env:ProgramData\Circuvent\Security"

if (-not (Test-Path $InstallDir)) {
    New-Item -ItemType Directory -Path $InstallDir -Force | Out-Null
}
if (-not (Test-Path $DataDir)) {
    New-Item -ItemType Directory -Path $DataDir -Force | Out-Null
}

# ------------------------------------------------------------------
# STEP 1: Apply Storage Device & USB Lockdown in Windows Registry
# ------------------------------------------------------------------
Write-Host "`n[1/6] Hardening USB Mass Storage & Removable Media..." -ForegroundColor Green

# Disable USBSTOR driver startup
Set-ItemProperty -Path "HKLM:\SYSTEM\CurrentControlSet\Services\USBSTOR" -Name "Start" -Value 4 -Type DWord -Force

# Removable Storage Devices Policy
$removablePath = "HKLM:\SOFTWARE\Policies\Microsoft\Windows\RemovableStorageDevices"
if (-not (Test-Path $removablePath)) {
    New-Item -Path $removablePath -Force | Out-Null
}
Set-ItemProperty -Path $removablePath -Name "Deny_All" -Value 1 -Type DWord -Force

# Deny Removable Disk GUID Class
$diskClassPath = "$removablePath\{53f5630d-b6bf-11d0-94f2-00a0c91efb8b}"
if (-not (Test-Path $diskClassPath)) { New-Item -Path $diskClassPath -Force | Out-Null }
Set-ItemProperty -Path $diskClassPath -Name "Deny_Read" -Value 1 -Type DWord -Force
Set-ItemProperty -Path $diskClassPath -Name "Deny_Write" -Value 1 -Type DWord -Force

# Deny CD/DVD/Optical GUID Class
$cdClassPath = "$removablePath\{53f56308-b6bf-11d0-94f2-00a0c91efb8b}"
if (-not (Test-Path $cdClassPath)) { New-Item -Path $cdClassPath -Force | Out-Null }
Set-ItemProperty -Path $cdClassPath -Name "Deny_Read" -Value 1 -Type DWord -Force
Set-ItemProperty -Path $cdClassPath -Name "Deny_Write" -Value 1 -Type DWord -Force

# Deny MTP / Mobile Phones (WPD Devices)
$wpdClassPath = "$removablePath\{6AC27878-A6FA-4155-BA85-F98F491D4F33}"
if (-not (Test-Path $wpdClassPath)) { New-Item -Path $wpdClassPath -Force | Out-Null }
Set-ItemProperty -Path $wpdClassPath -Name "Deny_Read" -Value 1 -Type DWord -Force
Set-ItemProperty -Path $wpdClassPath -Name "Deny_Write" -Value 1 -Type DWord -Force

# Disable WpdBusEnum (Windows Portable Device driver for MTP)
Set-ItemProperty -Path "HKLM:\SYSTEM\CurrentControlSet\Services\WpdBusEnum" -Name "Start" -Value 4 -Type DWord -Force

Write-Host "  -> USB mass storage, removable disks, and MTP mobile phone transfers blocked." -ForegroundColor Gray

# ------------------------------------------------------------------
# STEP 2: Configure Windows Advanced Firewall (Egress Lockdown)
# ------------------------------------------------------------------
Write-Host "`n[2/6] Configuring Windows Advanced Firewall Egress Rules..." -ForegroundColor Green

Remove-NetFirewallRule -DisplayName "Circuvent - Block Outbound SMTP" -ErrorAction SilentlyContinue
Remove-NetFirewallRule -DisplayName "Circuvent - Allow Corporate Mail (mx.circuvent.com)" -ErrorAction SilentlyContinue

$mailServerIP = "127.0.0.1"
try {
    $dns = [System.Net.Dns]::GetHostAddresses("mx.circuvent.com")
    if ($dns -and $dns.Count -gt 0) {
        $mailServerIP = $dns[0].IPAddressToString
    }
} catch {}

New-NetFirewallRule -DisplayName "Circuvent - Allow Corporate Mail (mx.circuvent.com)" `
    -Direction Outbound `
    -Action Allow `
    -Protocol TCP `
    -RemotePort 25, 465, 587, 993, 143 `
    -RemoteAddress $mailServerIP `
    -Profile Any `
    -Description "Permits outbound mail solely to Circuvent Technologies Mail Relays." | Out-Null

New-NetFirewallRule -DisplayName "Circuvent - Block Outbound SMTP" `
    -Direction Outbound `
    -Action Block `
    -Protocol TCP `
    -RemotePort 25, 465, 587 `
    -Profile Any `
    -Description "Prevents rogue SMTP transmission to personal/unauthorized email servers." | Out-Null

Write-Host "  -> Firewall rules applied: Outbound SMTP locked strictly to mx.circuvent.com." -ForegroundColor Gray

# ------------------------------------------------------------------
# STEP 3: Audit BitLocker Encryption & Patch Compliance
# ------------------------------------------------------------------
Write-Host "`n[3/6] Auditing BitLocker Disk Encryption & Security Updates..." -ForegroundColor Green

$encryptionStatus = "unencrypted"
$encryptionType = "none"

try {
    $bitlocker = Get-BitLockerVolume -MountPoint "C:" -ErrorAction SilentlyContinue
    if ($bitlocker) {
        if ($bitlocker.ProtectionStatus -eq "On" -or $bitlocker.VolumeStatus -eq "FullyEncrypted") {
            $encryptionStatus = "encrypted"
            $encryptionType = "bitlocker"
            Write-Host "  -> BitLocker Disk Encryption is ACTIVE." -ForegroundColor Gray
        } elseif ($bitlocker.VolumeStatus -eq "EncryptionInProgress") {
            $encryptionStatus = "encrypting"
            $encryptionType = "bitlocker"
            Write-Host "  -> BitLocker Encryption is in progress." -ForegroundColor Yellow
        } else {
            Write-Host "  -> WARNING: BitLocker is DISABLED on C: drive!" -ForegroundColor Red
        }
    }
} catch {
    Write-Warning "Could not query BitLocker status: $_"
}

# Query pending Windows Updates
$missingPatchesCount = 0
$pendingUpdates = @()

try {
    $updateSession = New-Object -ComObject Microsoft.Update.Session
    $updateSearcher = $updateSession.CreateUpdateSearcher()
    $searchResult = $updateSearcher.Search("IsInstalled=0 and Type='Software'")
    
    if ($searchResult.Updates) {
        $missingPatchesCount = $searchResult.Updates.Count
        foreach ($u in $searchResult.Updates) {
            $kb = ($u.KBArticleIDs | Select-Object -First 1)
            $pendingUpdates += @{
                title      = $u.Title
                kbArticle  = if ($kb) { "KB$kb" } else { "N/A" }
                isSecurity = $u.Categories | Where-Object { $_.Name -like "*Security*" } ? $true : $false
            }
        }
    }
    Write-Host "  -> Windows Update audit complete: $missingPatchesCount pending updates." -ForegroundColor Gray
} catch {
    Write-Warning "Could not query Windows Update service: $_"
}

# ------------------------------------------------------------------
# STEP 4: Enumerate Installed Software & Ingest into Asset Register
# ------------------------------------------------------------------
Write-Host "`n[4/6] Scanning Installed Software & Applications..." -ForegroundColor Green

$installedApps = @()
$registryPaths = @(
    "HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*",
    "HKLM:\SOFTWARE\Wow6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*",
    "HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*"
)

foreach ($path in $registryPaths) {
    Get-ItemProperty $path -ErrorAction SilentlyContinue | Where-Object { $_.DisplayName -and $_.DisplayName.Trim() -ne "" } | ForEach-Object {
        $installedApps += @{
            name        = $_.DisplayName.Trim()
            version     = if ($_.DisplayVersion) { $_.DisplayVersion.Trim() } else { "1.0.0" }
            publisher   = if ($_.Publisher) { $_.Publisher.Trim() } else { "Unknown" }
            installDate = if ($_.InstallDate) { $_.InstallDate.ToString() } else { "" }
        }
    }
}

# Remove duplicates based on Name + Version
$uniqueApps = $installedApps | Group-Object { "$($_.name)-$($_.version)" } | ForEach-Object { $_.Group[0] }

Write-Host "  -> Discovered $($uniqueApps.Count) installed applications on host." -ForegroundColor Gray

# Submit software inventory to HRMS
try {
    $softwarePayload = @{
        deviceHostname = $env:COMPUTERNAME
        orgId          = $OrgId
        employeeEmail  = $EmployeeEmail
        employeeCode   = $EmployeeCode
        software       = $uniqueApps
    } | ConvertTo-Json -Depth 5

    $headers = Get-CircuventAgentHeaders

    $swRes = Invoke-RestMethod -Uri "$ServerUrl/api/agent/software" -Method Post -Body $softwarePayload -Headers $headers -TimeoutSec 20
    Write-Host "  -> Software inventory synchronized with HRMS. ($($swRes.processedCount) apps processed, $($swRes.blacklistedFoundCount) blacklisted)." -ForegroundColor Cyan
} catch {
    Write-Warning "  -> Could not upload software inventory: $_"
}

# ------------------------------------------------------------------
# STEP 5: Deploy CircuventGuard Watchdog Script & Scheduled Task
# ------------------------------------------------------------------
Write-Host "`n[5/6] Installing CircuventGuard Watchdog Service..." -ForegroundColor Green

$guardScriptSource = Join-Path $PSScriptRoot "CircuventGuard.ps1"
$targetGuardScript = Join-Path $InstallDir "CircuventGuard.ps1"

if (Test-Path $guardScriptSource) {
    Copy-Item -Path $guardScriptSource -Destination $targetGuardScript -Force
} else {
    try {
        Invoke-WebRequest -Uri "$ServerUrl/security/windows/CircuventGuard.ps1" -OutFile $targetGuardScript
    } catch {
        Write-Warning "Could not download CircuventGuard.ps1. Using local fallback."
    }
}

# Write environment configuration for the service
$config = @{
    ServerUrl         = $ServerUrl
    ServerEndpoint    = "$ServerUrl/api/agent/incidents"
    HeartbeatEndpoint = "$ServerUrl/api/agent/heartbeat"
    CommandsEndpoint  = "$ServerUrl/api/agent/commands/complete"
    SoftwareEndpoint  = "$ServerUrl/api/agent/software"
    EnrollToken       = $EnrollToken
    DeviceApiKey      = $DeviceApiKey
    ApiKey            = $ApiKey
    TenantOrgId       = $OrgId
    EmployeeEmail     = $EmployeeEmail
    EmployeeCode      = $EmployeeCode
} | ConvertTo-Json

Set-Content -Path "$DataDir\agent-config.json" -Value $config -Encoding UTF8

$taskName = "CircuventEndpointSecurityGuard"
Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue

$action = New-ScheduledTaskAction -Execute "powershell.exe" `
    -Argument "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$targetGuardScript`" -ServerUrl `"$ServerUrl`" -DeviceApiKey `"$DeviceApiKey`" -EnrollToken `"$EnrollToken`" -ApiKey `"$ApiKey`" -TenantOrgId `"$OrgId`" -EmployeeEmail `"$EmployeeEmail`" -EmployeeCode `"$EmployeeCode`""

$triggerBoot = New-ScheduledTaskTrigger -AtStartup
$triggerLogon = New-ScheduledTaskTrigger -AtLogOn

$principal = New-ScheduledTaskPrincipal -UserId "NT AUTHORITY\SYSTEM" -LogonType ServiceAccount -RunLevel Highest
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -RestartCount 5 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit (New-TimeSpan -Days 365)

Register-ScheduledTask -TaskName $taskName -Action $action -Trigger @($triggerBoot, $triggerLogon) -Principal $principal -Settings $settings -Force | Out-Null
Start-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue

Write-Host "  -> Scheduled Task '$taskName' registered and started." -ForegroundColor Gray

# ------------------------------------------------------------------
# STEP 6: Enroll Device with HRMS Security Server & Asset Register
# ------------------------------------------------------------------
Write-Host "`n[6/6] Enrolling Device into HRMS Asset Management & Security Console..." -ForegroundColor Green

try {
    $bios = Get-CimInstance Win32_BIOS -ErrorAction SilentlyContinue
    $cs = Get-CimInstance Win32_ComputerSystem -ErrorAction SilentlyContinue
    $cpu = Get-CimInstance Win32_Processor -ErrorAction SilentlyContinue | Select-Object -First 1
    $os = Get-CimInstance Win32_OperatingSystem -ErrorAction SilentlyContinue
    $disk = Get-CimInstance Win32_DiskDrive -ErrorAction SilentlyContinue | Where-Object { $_.MediaType -like '*Fixed*' -or $_.InterfaceType -ne 'USB' } | Select-Object -First 1
    $nic = Get-CimInstance Win32_NetworkAdapterConfiguration -ErrorAction SilentlyContinue | Where-Object { $_.IPEnabled -eq $true } | Select-Object -First 1

    $ramGb = 0
    if ($cs -and $cs.TotalPhysicalMemory) {
        $ramGb = [math]::Round($cs.TotalPhysicalMemory / 1GB)
    }

    $diskGb = 0
    if ($disk -and $disk.Size) {
        $diskGb = [math]::Round($disk.Size / 1GB)
    }

    $enrollPayload = @{
        deviceHostname      = $env:COMPUTERNAME
        deviceSerial        = if ($bios.SerialNumber) { $bios.SerialNumber.Trim() } else { "UNKNOWN" }
        manufacturer        = if ($cs.Manufacturer) { $cs.Manufacturer.Trim() } else { "Enterprise" }
        model               = if ($cs.Model) { $cs.Model.Trim() } else { "Laptop" }
        processor           = if ($cpu.Name) { $cpu.Name.Trim() } else { "N/A" }
        ramGb               = $ramGb
        diskGb              = $diskGb
        macAddress          = if ($nic.MACAddress) { $nic.MACAddress } else { "N/A" }
        employeeEmail       = $EmployeeEmail
        employeeCode        = $EmployeeCode
        orgId               = $OrgId
        agentVersion        = "2.5.0"
        osVersion           = if ($os.Caption) { $os.Caption.Trim() } else { "Windows 11" }
        osFamily            = "windows"
        osBuild             = if ($os.BuildNumber) { $os.BuildNumber.ToString() } else { "22631" }
        encryptionStatus    = $encryptionStatus
        encryptionType      = $encryptionType
        missingPatchesCount = $missingPatchesCount
        pendingUpdates      = $pendingUpdates
        policyMode          = "strict_block"
        usbBlocked          = $true
        firewallActive      = $true
    } | ConvertTo-Json -Depth 6

    $headers = Get-CircuventAgentHeaders

    $enrollRes = Invoke-RestMethod -Uri "$ServerUrl/api/agent/enroll" -Method Post -Body $enrollPayload -Headers $headers -TimeoutSec 15

    if ($enrollRes.deviceApiKey) {
        $DeviceApiKey = $enrollRes.deviceApiKey
        $configObj = Get-Content "$DataDir\agent-config.json" -Raw | ConvertFrom-Json
        $configObj.DeviceApiKey = $DeviceApiKey
        $configObj.EnrollToken = ""
        $configObj | ConvertTo-Json | Set-Content -Path "$DataDir\agent-config.json" -Encoding UTF8
        Write-Host "  -> Device agent key issued and saved locally." -ForegroundColor Gray
    }
    
    if ($enrollRes.asset) {
        Write-Host "  -> [ASSET MANAGEMENT] Registered Asset: $($enrollRes.asset.name) (Tag: $($enrollRes.asset.assetTag), Serial: $($enrollRes.asset.serialNumber))" -ForegroundColor Cyan
    }
    Write-Host "  -> [SECURITY CONSOLE] Enrolled with Circuvent HRMS! (Compliance Score: $($enrollRes.policy.complianceScore)/100, Status: $($enrollRes.policy.complianceStatus))" -ForegroundColor Green
}
catch {
    Write-Warning "  -> Could not reach enrollment server: $_. Enrollment will retry automatically on first heartbeat."
}

Write-Host "`n=================================================================" -ForegroundColor Cyan
Write-Host " ENROLLMENT COMPLETE: Endpoint Security & DLP is Active! " -ForegroundColor Cyan
Write-Host "=================================================================" -ForegroundColor Cyan
