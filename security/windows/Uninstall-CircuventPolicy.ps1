<#
================================================================================
Circuvent Technologies - Endpoint Security Uninstaller & Rollback Script
Script: Uninstall-CircuventPolicy.ps1
Requires: Administrator Privileges
================================================================================
#>

[CmdletBinding()]
param (
    [string]$AdminOverridePin = ""
)

$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
    Write-Error "ERROR: Must be run as Administrator."
    exit 1
}

Write-Host "Reverting Circuvent Endpoint Security Policies..." -ForegroundColor Yellow

# 1. Stop and remove scheduled task
Unregister-ScheduledTask -TaskName "CircuventEndpointSecurityGuard" -Confirm:$false -ErrorAction SilentlyContinue

# 2. Re-enable USBSTOR driver
Set-ItemProperty -Path "HKLM:\SYSTEM\CurrentControlSet\Services\USBSTOR" -Name "Start" -Value 3 -Type DWord -Force

# 3. Remove RemovableStorageDevices policies
Remove-Item -Path "HKLM:\SOFTWARE\Policies\Microsoft\Windows\RemovableStorageDevices" -Recurse -Force -ErrorAction SilentlyContinue

# 4. Re-enable WpdBusEnum
Set-ItemProperty -Path "HKLM:\SYSTEM\CurrentControlSet\Services\WpdBusEnum" -Name "Start" -Value 3 -Type DWord -Force

# 5. Remove Firewall Egress Rules
Remove-NetFirewallRule -DisplayName "Circuvent - Block Outbound SMTP" -ErrorAction SilentlyContinue
Remove-NetFirewallRule -DisplayName "Circuvent - Allow Corporate Mail (mx.circuvent.com)" -ErrorAction SilentlyContinue

Write-Host "Policies successfully reverted. USB storage and firewall rules restored to default." -ForegroundColor Green
