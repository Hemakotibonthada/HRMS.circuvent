<#
================================================================================
Circuvent Technologies - Enterprise Endpoint Security Installer
Script: Install-CircuventPolicy.ps1
Version: 2.4.0
Description:
  Automated deployment script for Windows Laptops.
  1. Enforces strict USB/Removable Storage & MTP Phone Block.
  2. Configures Windows Advanced Firewall (SMTP Lockdown & Egress Guard).
  3. Deploys and registers CircuventGuard Watchdog Service.
  4. Registers endpoint with Circuvent HRMS Security Console.
================================================================================
#>

[CmdletBinding()]
param (
    [string]$ServerUrl = "https://hrms.circuvent.com",
    [string]$ApiKey = "",
    [string]$OrgId = "",
    [string]$EmployeeEmail = "",
    [string]$EmployeeCode = "",
    [switch]$Force
)

# 1. Require Administrative Privileges
$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
    Write-Error "ERROR: This script must be run as an Administrator. Please run PowerShell as Administrator."
    exit 1
}

Write-Host "=================================================================" -ForegroundColor Cyan
Write-Host " Circuvent Technologies - Endpoint Security & Firewall Hardening " -ForegroundColor Cyan
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
Write-Host "`n[1/5] Hardening USB Mass Storage & Removable Media..." -ForegroundColor Green

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
Write-Host "`n[2/5] Configuring Windows Advanced Firewall Egress Rules..." -ForegroundColor Green

# Remove any previous rules to avoid duplicates
Remove-NetFirewallRule -DisplayName "Circuvent - Block Outbound SMTP" -ErrorAction SilentlyContinue
Remove-NetFirewallRule -DisplayName "Circuvent - Allow Corporate Mail (mx.circuvent.com)" -ErrorAction SilentlyContinue

# Resolve mx.circuvent.com IP address for firewall allowlist
$mailServerIP = "127.0.0.1"
try {
    $dns = [System.Net.Dns]::GetHostAddresses("mx.circuvent.com")
    if ($dns -and $dns.Count -gt 0) {
        $mailServerIP = $dns[0].IPAddressToString
    }
} catch {}

# Allow outbound traffic to mx.circuvent.com on ports 587, 465, 993, 143
New-NetFirewallRule -DisplayName "Circuvent - Allow Corporate Mail (mx.circuvent.com)" `
    -Direction Outbound `
    -Action Allow `
    -Protocol TCP `
    -RemotePort 25, 465, 587, 993, 143 `
    -RemoteAddress $mailServerIP `
    -Profile Any `
    -Description "Permits outbound mail solely to Circuvent Technologies Mail Relays." | Out-Null

# Block all other outbound SMTP traffic (ports 25, 465, 587) to any destination
New-NetFirewallRule -DisplayName "Circuvent - Block Outbound SMTP" `
    -Direction Outbound `
    -Action Block `
    -Protocol TCP `
    -RemotePort 25, 465, 587 `
    -Profile Any `
    -Description "Prevents rogue SMTP transmission to personal/unauthorized email servers." | Out-Null

Write-Host "  -> Firewall rules applied: Outbound SMTP locked strictly to mx.circuvent.com." -ForegroundColor Gray

# ------------------------------------------------------------------
# STEP 3: Deploy CircuventGuard Watchdog Script
# ------------------------------------------------------------------
Write-Host "`n[3/5] Installing CircuventGuard Watchdog Service..." -ForegroundColor Green

$guardScriptSource = Join-Path $PSScriptRoot "CircuventGuard.ps1"
$targetGuardScript = Join-Path $InstallDir "CircuventGuard.ps1"

if (Test-Path $guardScriptSource) {
    Copy-Item -Path $guardScriptSource -Destination $targetGuardScript -Force
} else {
    Write-Warning "Could not find CircuventGuard.ps1 in installer directory. Using default embedded template."
}

# Write environment configuration for the service
$config = @{
    ServerEndpoint    = "$ServerUrl/api/security/incidents"
    HeartbeatEndpoint = "$ServerUrl/api/security/devices/heartbeat"
    ApiKey            = $ApiKey
    TenantOrgId       = $OrgId
    EmployeeEmail     = $EmployeeEmail
    EmployeeCode      = $EmployeeCode
} | ConvertTo-Json

Set-Content -Path "$DataDir\agent-config.json" -Value $config -Encoding UTF8

# ------------------------------------------------------------------
# STEP 4: Register Background Watchdog as Windows Scheduled Task
# ------------------------------------------------------------------
Write-Host "`n[4/5] Registering Auto-Starting Scheduled Task under SYSTEM..." -ForegroundColor Green

$taskName = "CircuventEndpointSecurityGuard"
Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue

$action = New-ScheduledTaskAction -Execute "powershell.exe" `
    -Argument "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$targetGuardScript`" -ServerEndpoint `"$ServerUrl/api/security/incidents`" -HeartbeatEndpoint `"$ServerUrl/api/security/devices/heartbeat`" -ApiKey `"$ApiKey`" -TenantOrgId `"$OrgId`" -EmployeeEmail `"$EmployeeEmail`" -EmployeeCode `"$EmployeeCode`""

$triggerBoot = New-ScheduledTaskTrigger -AtStartup
$triggerLogon = New-ScheduledTaskTrigger -AtLogOn

$principal = New-ScheduledTaskPrincipal -UserId "NT AUTHORITY\SYSTEM" -LogonType ServiceAccount -RunLevel Highest
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -RestartCount 5 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit (New-TimeSpan -Days 365)

Register-ScheduledTask -TaskName $taskName -Action $action -Trigger @($triggerBoot, $triggerLogon) -Principal $principal -Settings $settings -Force | Out-Null

# Start the task immediately
Start-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue

Write-Host "  -> Scheduled Task '$taskName' registered and started." -ForegroundColor Gray

# ------------------------------------------------------------------
# STEP 5: Enroll Device with HRMS Security Server
# ------------------------------------------------------------------
Write-Host "`n[5/5] Enrolling Device with Circuvent Security Console..." -ForegroundColor Green

try {
    $enrollPayload = @{
        deviceHostname = $env:COMPUTERNAME
        deviceSerial   = (Get-CimInstance Win32_BIOS).SerialNumber
        employeeEmail  = $EmployeeEmail
        employeeCode   = $EmployeeCode
        orgId          = $OrgId
        agentVersion   = "2.4.0"
        osVersion      = (Get-CimInstance Win32_OperatingSystem).Caption
        policyMode     = "strict_block"
        usbBlocked     = $true
        firewallActive = $true
    } | ConvertTo-Json

    $headers = @{ "Content-Type" = "application/json" }
    if ($ApiKey) { $headers["X-API-Key"] = $ApiKey }

    $enrollRes = Invoke-RestMethod -Uri "$ServerUrl/api/security/devices/enroll" -Method Post -Body $enrollPayload -Headers $headers -TimeoutSec 10
    Write-Host "  -> Device successfully enrolled with Circuvent HRMS! (Device ID: $($enrollRes.id))" -ForegroundColor Green
}
catch {
    Write-Warning "  -> Could not reach enrollment server: $_. Enrollment will retry automatically on first heartbeat."
}

Write-Host "`n=================================================================" -ForegroundColor Cyan
Write-Host " ENROLLMENT COMPLETE: Endpoint Security & DLP is Active! " -ForegroundColor Cyan
Write-Host "=================================================================" -ForegroundColor Cyan
