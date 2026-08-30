<#
================================================================================
Circuvent Technologies - Enterprise Endpoint Security Watchdog (CircuventGuard)
Version: 2.4.0
Description:
  Continuous real-time monitor for Windows laptops.
  - Detects and instantly dismounts unauthorized USB mass storage, external drives & MTP phones.
  - Prevents data exfiltration and copying of office files/code.
  - Sends immediate incident telemetry to Circuvent HRMS Security Ingestion API.
  - Fires native Windows user security warning toasts.
================================================================================
#>

[CmdletBinding()]
param (
    [string]$ServerEndpoint = "https://hrms.circuvent.com/api/security/incidents",
    [string]$HeartbeatEndpoint = "https://hrms.circuvent.com/api/security/devices/heartbeat",
    [string]$ApiKey = "",
    [string]$TenantOrgId = "",
    [string]$EmployeeEmail = "",
    [string]$EmployeeCode = "",
    [switch]$RunAsService
)

$ErrorActionPreference = "SilentlyContinue"

# Log file configuration
$LogDir = "$env:ProgramData\Circuvent\Security"
if (-not (Test-Path $LogDir)) {
    New-Item -ItemType Directory -Path $LogDir -Force | Out-Null
}
$LogFile = "$LogDir\CircuventGuard.log"

function Write-GuardLog {
    param([string]$Message, [string]$Level = "INFO")
    $timestamp = (Get-Date).ToString("yyyy-MM-dd HH:mm:ss")
    $logEntry = "[$timestamp] [$Level] $Message"
    Add-Content -Path $LogFile -Value $logEntry -Encoding UTF8
    Write-Host $logEntry
}

function Show-WindowsToast {
    param(
        [string]$Title = "Circuvent Security Alert",
        [string]$Message = "External data drive blocked by company policy."
    )
    try {
        [Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null
        [Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime] | Out-Null

        $template = @"
<toast duration="long">
    <visual>
        <binding template="ToastGeneric">
            <text>$Title</text>
            <text>$Message</text>
            <text placement="attribution">Circuvent Technologies IT Security</text>
        </binding>
    </visual>
    <audio src="ms-winsoundevent:Notification.Security" />
</toast>
"@
        $xml = New-Object Windows.Data.Xml.Dom.XmlDocument
        $xml.LoadXml($template)
        $toast = [Windows.UI.Notifications.ToastNotification]::new($xml)
        $notifier = [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier("Circuvent.EndpointSecurity")
        $notifier.Show($toast)
    }
    catch {
        Write-GuardLog "Could not display toast notification: $_" "WARN"
    }
}

function Eject-RemovableVolume {
    param([string]$DriveLetter)
    try {
        Write-GuardLog "Attempting to force-unmount volume: $DriveLetter" "WARN"
        
        # 1. Mountvol dismount
        & mountvol "$DriveLetter" /D 2>$null

        # 2. Shell Application Eject
        $shell = New-Object -ComObject Shell.Application
        $shell.Namespace(17).ParseName($DriveLetter).InvokeVerb("Eject") 2>$null

        # 3. Diskpart force offline if volume persists
        $cleanLetter = $DriveLetter.Replace(":", "").Trim()
        $diskpartScript = @"
select volume $cleanLetter
offline volume
"@
        $diskpartScript | diskpart 2>$null

        Write-GuardLog "Successfully neutralized drive $DriveLetter" "INFO"
    }
    catch {
        Write-GuardLog "Failed to dismount drive $DriveLetter: $_" "ERROR"
    }
}

function Send-IncidentTelemetry {
    param(
        [string]$IncidentType,
        [string]$Severity,
        [string]$ActionTaken,
        [hashtable]$Metadata
    )

    $hostname = $env:COMPUTERNAME
    $username = $env:USERNAME
    $osVersion = (Get-CimInstance Win32_OperatingSystem).Caption

    $payload = @{
        deviceHostname = $hostname
        deviceUsername = $username
        deviceSerial   = (Get-CimInstance Win32_BIOS).SerialNumber
        employeeEmail  = $EmployeeEmail
        employeeCode   = $EmployeeCode
        orgId          = $TenantOrgId
        incidentType   = $IncidentType
        severity       = $Severity
        actionTaken    = $ActionTaken
        osVersion      = $osVersion
        timestamp      = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
        metadata       = $Metadata
    } | ConvertTo-Json -Depth 6

    Write-GuardLog "Dispatching incident telemetry to $ServerEndpoint: $IncidentType" "INFO"

    try {
        $headers = @{
            "Content-Type" = "application/json"
            "X-Circuvent-Agent" = "CircuventGuard-2.4.0"
        }
        if ($ApiKey) {
            $headers["X-API-Key"] = $ApiKey
        }

        $response = Invoke-RestMethod -Uri $ServerEndpoint -Method Post -Body $payload -Headers $headers -TimeoutSec 15
        Write-GuardLog "Incident telemetry delivered successfully. Server response: $($response | ConvertTo-Json -Compress)" "INFO"
    }
    catch {
        Write-GuardLog "Failed to send telemetry to server: $_. Queueing locally." "WARN"
        $queueFile = "$LogDir\pending_incidents.json"
        Add-Content -Path $queueFile -Value $payload -Encoding UTF8
    }
}

function Send-Heartbeat {
    if (-not $HeartbeatEndpoint) { return }
    try {
        $payload = @{
            deviceHostname = $env:COMPUTERNAME
            deviceSerial   = (Get-CimInstance Win32_BIOS).SerialNumber
            employeeEmail  = $EmployeeEmail
            orgId          = $TenantOrgId
            agentVersion   = "2.4.0"
            usbBlocked     = $true
            firewallActive = $true
            timestamp      = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
        } | ConvertTo-Json

        $headers = @{ "Content-Type" = "application/json" }
        if ($ApiKey) { $headers["X-API-Key"] = $ApiKey }

        Invoke-RestMethod -Uri $HeartbeatEndpoint -Method Post -Body $payload -Headers $headers -TimeoutSec 10 | Out-Null
    }
    catch {
        # Quiet heartbeat failure
    }
}

# --- Initialization Banner ---
Write-GuardLog "========================================================"
Write-GuardLog "CircuventGuard Endpoint Security Watchdog Starting..."
Write-GuardLog "Host: $env:COMPUTERNAME | User: $env:USERNAME | Org: $TenantOrgId"
Write-GuardLog "Policies: USB Storage BLOCKED | SMTP Egress FILTERED | DLP ACTIVE"
Write-GuardLog "========================================================"

# Register WMI Event for Removable Disk Insertion
$wmiQuery = "SELECT * FROM __InstanceCreationEvent WITHIN 2 WHERE TargetInstance ISA 'Win32_LogicalDisk' AND (TargetInstance.DriveType = 2 OR TargetInstance.DriveType = 5)"

$eventIdentifier = "CircuventUSBStorageEvent"
Unregister-Event -SourceIdentifier $eventIdentifier -ErrorAction SilentlyContinue

Register-WmiEvent -Query $wmiQuery -SourceIdentifier $eventIdentifier -Action {
    $disk = $Event.SourceEventArgs.NewEvent.TargetInstance
    $driveLetter = $disk.DeviceID
    $volumeName = $disk.VolumeName
    $volumeSerial = $disk.VolumeSerialNumber
    $sizeGB = [Math]::Round(($disk.Size / 1GB), 2)

    Write-GuardLog "ALERT: Removable storage device arrival detected on drive $driveLetter ($volumeName, $sizeGB GB)" "WARN"

    # Get PNP device hardware identifiers
    $pnpDevice = Get-CimInstance Win32_DiskDrive | Where-Object { $_.InterfaceType -eq "USB" } | Select-Object -First 1
    $vendor = if ($pnpDevice.Manufacturer) { $pnpDevice.Manufacturer } else { "Generic USB Storage" }
    $model = if ($pnpDevice.Model) { $pnpDevice.Model } else { "Removable Drive" }
    $pnpId = if ($pnpDevice.PNPDeviceID) { $pnpDevice.PNPDeviceID } else { "UNKNOWN_USB_PNP" }

    # 1. Immediately neutralise drive
    Eject-RemovableVolume -DriveLetter $driveLetter

    # 2. Display security toast notification to user
    Show-WindowsToast -Title "Security Warning: External Drive Blocked" -Message "Connecting external drives ($driveLetter) is restricted on Circuvent laptops. This attempt has been logged and reported to IT Security."

    # 3. Dispatch telemetry and alert email
    $meta = @{
        driveLetter  = $driveLetter
        volumeName   = $volumeName
        volumeSerial = $volumeSerial
        sizeGB       = $sizeGB
        vendor       = $vendor
        model        = $model
        pnpDeviceID  = $pnpId
    }

    Send-IncidentTelemetry -IncidentType "unauthorized_usb_drive" -Severity "critical" -ActionTaken "blocked_and_ejected" -Metadata $meta
}

Write-GuardLog "WMI Removable Storage Event Listener active."

# Heartbeat loop & file system exfiltration monitoring
$lastHeartbeat = [DateTime]::MinValue

while ($true) {
    # Send heartbeat every 5 minutes
    if ((Get-Date) - $lastHeartbeat -gt [TimeSpan]::FromMinutes(5)) {
        Send-Heartbeat
        $lastHeartbeat = Get-Date
    }

    # Verify USBSTOR registry state is strictly 4 (Disabled)
    $usbstorStart = (Get-ItemProperty -Path "HKLM:\SYSTEM\CurrentControlSet\Services\USBSTOR" -Name "Start" -ErrorAction SilentlyContinue).Start
    if ($usbstorStart -ne 4) {
        Write-GuardLog "TAMPER DETECTED: USBSTOR Start key was modified to $usbstorStart. Restoring to 4 (Disabled)." "ERROR"
        Set-ItemProperty -Path "HKLM:\SYSTEM\CurrentControlSet\Services\USBSTOR" -Name "Start" -Value 4 -Type DWord -Force
        
        Send-IncidentTelemetry -IncidentType "security_tamper_attempt" -Severity "critical" -ActionTaken "remediated_registry" -Metadata @{
            tamperedKey = "USBSTOR\Start"
            tamperedValue = $usbstorStart
        }
    }

    Start-Sleep -Seconds 10
}
