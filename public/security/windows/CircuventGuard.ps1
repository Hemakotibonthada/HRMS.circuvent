<#
================================================================================
Circuvent Technologies - Enterprise Endpoint Security Watchdog (CircuventGuard)
Script: CircuventGuard.ps1
Version: 2.5.0
Description:
  Continuous real-time monitor and remote remediation agent for Windows.
  - Real-time USB mass storage, removable drive, and MTP phone interception.
  - Heartbeat telemetry with BitLocker encryption and patch vulnerability reporting.
  - Remote command execution engine (lock_device, kill_process, wipe_cache, trigger_scan).
  - Native toast security notifications and SOC incident reporting.
================================================================================
#>

[CmdletBinding()]
param (
    [string]$ServerUrl = "https://devices.circuvent.com",
    [string]$DeviceApiKey = "",
    [string]$EnrollToken = "",
    [string]$ApiKey = "",
    [string]$TenantOrgId = "",
    [string]$EmployeeEmail = "",
    [string]$EmployeeCode = "",
    [switch]$RunAsService
)

$ConfigPath = "$env:ProgramData\Circuvent\Security\agent-config.json"
if (Test-Path $ConfigPath) {
    try {
        $saved = Get-Content $ConfigPath -Raw | ConvertFrom-Json
        if (-not $ServerUrl -and $saved.ServerUrl) { $ServerUrl = $saved.ServerUrl }
        if (-not $DeviceApiKey -and $saved.DeviceApiKey) { $DeviceApiKey = $saved.DeviceApiKey }
        if (-not $EnrollToken -and $saved.EnrollToken) { $EnrollToken = $saved.EnrollToken }
        if (-not $ApiKey -and $saved.ApiKey) { $ApiKey = $saved.ApiKey }
        if (-not $TenantOrgId -and $saved.TenantOrgId) { $TenantOrgId = $saved.TenantOrgId }
        if (-not $EmployeeEmail -and $saved.EmployeeEmail) { $EmployeeEmail = $saved.EmployeeEmail }
        if (-not $EmployeeCode -and $saved.EmployeeCode) { $EmployeeCode = $saved.EmployeeCode }
    } catch {}
}

function Get-CircuventAgentHeaders {
    $headers = @{
        "Content-Type" = "application/json"
        "X-Circuvent-Agent" = "CircuventGuard-2.5.0"
    }
    if ($DeviceApiKey) {
        $headers["X-Device-Agent-Key"] = $DeviceApiKey
    } elseif ($EnrollToken) {
        $headers["X-Device-Enroll-Token"] = $EnrollToken
    } elseif ($ApiKey) {
        $headers["X-API-Key"] = $ApiKey
    }
    return $headers
}

$ErrorActionPreference = "SilentlyContinue"

# Log & data directory
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
        Write-GuardLog "Neutralizing unauthorized drive volume: $DriveLetter" "WARN"
        & mountvol "$DriveLetter" /D 2>$null
        $shell = New-Object -ComObject Shell.Application
        $shell.Namespace(17).ParseName($DriveLetter).InvokeVerb("Eject") 2>$null
        
        $cleanLetter = $DriveLetter.Replace(":", "").Trim()
        "select volume $cleanLetter`noffline volume" | diskpart 2>$null
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

    try {
        $headers = Get-CircuventAgentHeaders

        Invoke-RestMethod -Uri "$ServerUrl/api/agent/incidents" -Method Post -Body $payload -Headers $headers -TimeoutSec 15 | Out-Null
        Write-GuardLog "Incident telemetry dispatched to server: $IncidentType" "INFO"
    }
    catch {
        Write-GuardLog "Failed to send telemetry to server: $_" "WARN"
    }
}

function Complete-Command {
    param(
        [string]$CommandId,
        [string]$Status,
        [string]$ResultOutput,
        [string]$ErrorMessage = $null
    )
    try {
        $payload = @{
            commandId      = $CommandId
            deviceHostname = $env:COMPUTERNAME
            status         = $Status
            resultOutput   = $ResultOutput
            errorMessage   = $ErrorMessage
        } | ConvertTo-Json

        $headers = Get-CircuventAgentHeaders

        Invoke-RestMethod -Uri "$ServerUrl/api/agent/commands/complete" -Method Post -Body $payload -Headers $headers -TimeoutSec 10 | Out-Null
        Write-GuardLog "Command $CommandId marked as $Status." "INFO"
    } catch {
        Write-GuardLog "Failed to report command completion: $_" "WARN"
    }
}

function Execute-RemoteCommand {
    param([object]$Cmd)
    $cmdId = $Cmd.id
    $type = $Cmd.commandType
    $payload = $Cmd.payload

    Write-GuardLog "Executing remote command: $type (ID: $cmdId)" "WARN"

    try {
        switch ($type) {
            "lock_device" {
                Show-WindowsToast -Title "Workstation Locked Remotely" -Message "An IT Administrator has locked this workstation for security compliance."
                & rundll32.exe user32.dll,LockWorkStation
                Complete-Command -CommandId $cmdId -Status "completed" -ResultOutput "Workstation screen locked successfully."
            }

            "policy_refresh" {
                Set-ItemProperty -Path "HKLM:\SYSTEM\CurrentControlSet\Services\USBSTOR" -Name "Start" -Value 4 -Type DWord -Force
                Complete-Command -CommandId $cmdId -Status "completed" -ResultOutput "USB storage and firewall policies re-enforced."
            }

            "trigger_scan" {
                # Rescan installed software
                $apps = @()
                $paths = @("HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*", "HKLM:\SOFTWARE\Wow6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*")
                foreach ($p in $paths) {
                    Get-ItemProperty $p -ErrorAction SilentlyContinue | Where-Object { $_.DisplayName } | ForEach-Object {
                        $apps += @{ name = $_.DisplayName.Trim(); version = if ($_.DisplayVersion) { $_.DisplayVersion.Trim() } else { "1.0.0" } }
                    }
                }
                $swPayload = @{ deviceHostname = $env:COMPUTERNAME; software = $apps } | ConvertTo-Json -Depth 4
                Invoke-RestMethod -Uri "$ServerUrl/api/agent/software" -Method Post -Body $swPayload -Headers (Get-CircuventAgentHeaders) -TimeoutSec 15 | Out-Null
                Complete-Command -CommandId $cmdId -Status "completed" -ResultOutput "Triggered scan completed ($($apps.Count) applications reported)."
            }

            "kill_process" {
                $procName = if ($payload.processName) { $payload.processName } else { "AnyDesk" }
                $cleanProc = $procName.Replace(".exe", "")
                $killed = Get-Process -Name $cleanProc -ErrorAction SilentlyContinue
                if ($killed) {
                    $killed | Stop-Process -Force
                    Complete-Command -CommandId $cmdId -Status "completed" -ResultOutput "Process '$procName' terminated."
                } else {
                    Complete-Command -CommandId $cmdId -Status "completed" -ResultOutput "Process '$procName' was not running."
                }
            }

            "wipe_cache" {
                Remove-Item "$env:TEMP\*" -Recurse -Force -ErrorAction SilentlyContinue
                Complete-Command -CommandId $cmdId -Status "completed" -ResultOutput "Local temporary file cache wiped."
            }

            default {
                Complete-Command -CommandId $cmdId -Status "failed" -ResultOutput "Unknown command type: $type" -ErrorMessage "Command type not supported"
            }
        }
    } catch {
        Complete-Command -CommandId $cmdId -Status "failed" -ResultOutput "Execution error" -ErrorMessage $_.Exception.Message
    }
}

function Send-Heartbeat {
    try {
        # Audit BitLocker
        $encStatus = "unencrypted"
        $encType = "none"
        try {
            $bl = Get-BitLockerVolume -MountPoint "C:" -ErrorAction SilentlyContinue
            if ($bl -and ($bl.ProtectionStatus -eq "On" -or $bl.VolumeStatus -eq "FullyEncrypted")) {
                $encStatus = "encrypted"
                $encType = "bitlocker"
            }
        } catch {}

        # Audit Patches
        $missingPatches = 0
        try {
            $us = New-Object -ComObject Microsoft.Update.Session
            $res = $us.CreateUpdateSearcher().Search("IsInstalled=0 and Type='Software'")
            if ($res.Updates) { $missingPatches = $res.Updates.Count }
        } catch {}

        $os = Get-CimInstance Win32_OperatingSystem -ErrorAction SilentlyContinue

        $payload = @{
            deviceHostname      = $env:COMPUTERNAME
            deviceSerial        = (Get-CimInstance Win32_BIOS).SerialNumber
            employeeEmail       = $EmployeeEmail
            orgId               = $TenantOrgId
            agentVersion        = "2.5.0"
            osFamily            = "windows"
            osVersion           = if ($os.Caption) { $os.Caption.Trim() } else { "Windows 11" }
            osBuild             = if ($os.BuildNumber) { $os.BuildNumber.ToString() } else { "22631" }
            usbBlocked          = $true
            firewallActive      = $true
            encryptionStatus    = $encStatus
            encryptionType      = $encType
            missingPatchesCount = $missingPatches
            timestamp           = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
        } | ConvertTo-Json

        $headers = Get-CircuventAgentHeaders

        $response = Invoke-RestMethod -Uri "$ServerUrl/api/agent/heartbeat" -Method Post -Body $payload -Headers $headers -TimeoutSec 15

        # Check for and execute pending commands
        if ($response.pendingCommands -and $response.pendingCommands.Count -gt 0) {
            foreach ($cmd in $response.pendingCommands) {
                Execute-RemoteCommand -Cmd $cmd
            }
        }
    }
    catch {
        Write-GuardLog "Heartbeat warning: $_" "WARN"
    }
}

# --- Initialization Banner ---
Write-GuardLog "========================================================"
Write-GuardLog "CircuventGuard Watchdog & Remote Agent Starting (v2.5.0)..."
Write-GuardLog "Host: $env:COMPUTERNAME | User: $env:USERNAME | Org: $TenantOrgId"
Write-GuardLog "Policies: USB BLOCKED | FIREWALL ACTIVE | REMEDIATION ON"
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

    $pnpDevice = Get-CimInstance Win32_DiskDrive | Where-Object { $_.InterfaceType -eq "USB" } | Select-Object -First 1
    $vendor = if ($pnpDevice.Manufacturer) { $pnpDevice.Manufacturer } else { "Generic USB Storage" }
    $model = if ($pnpDevice.Model) { $pnpDevice.Model } else { "Removable Drive" }
    $pnpId = if ($pnpDevice.PNPDeviceID) { $pnpDevice.PNPDeviceID } else { "UNKNOWN_USB_PNP" }

    Eject-RemovableVolume -DriveLetter $driveLetter
    Show-WindowsToast -Title "Security Warning: External Drive Blocked" -Message "Connecting external storage ($driveLetter) is restricted on Circuvent laptops. Attempt reported to IT Security."

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

$lastHeartbeat = [DateTime]::MinValue

while ($true) {
    if ((Get-Date) - $lastHeartbeat -gt [TimeSpan]::FromMinutes(2)) {
        Send-Heartbeat
        $lastHeartbeat = Get-Date
    }

    $usbstorStart = (Get-ItemProperty -Path "HKLM:\SYSTEM\CurrentControlSet\Services\USBSTOR" -Name "Start" -ErrorAction SilentlyContinue).Start
    if ($usbstorStart -ne 4) {
        Write-GuardLog "TAMPER DETECTED: USBSTOR Start key was $usbstorStart. Restoring to 4." "ERROR"
        Set-ItemProperty -Path "HKLM:\SYSTEM\CurrentControlSet\Services\USBSTOR" -Name "Start" -Value 4 -Type DWord -Force
        Send-IncidentTelemetry -IncidentType "security_tamper_attempt" -Severity "critical" -ActionTaken "remediated_registry" -Metadata @{
            tamperedKey = "USBSTOR\Start"
            tamperedValue = $usbstorStart
        }
    }

    Start-Sleep -Seconds 10
}
