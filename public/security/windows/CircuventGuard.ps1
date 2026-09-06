<#
================================================================================
Circuvent Technologies - Enterprise Endpoint Security Watchdog (CircuventGuard)
Script: CircuventGuard.ps1
Version: 2.7.0
Description:
  Continuous real-time monitor and remote remediation agent for Windows.
  - Real-time USB mass storage, removable drive, and MTP phone interception.
  - Heartbeat telemetry with BitLocker/FileVault recovery key escrow and patch vulnerability reporting.
  - Remote command execution engine (lock_device, kill_process, wipe_cache, trigger_scan, run_diagnostic).
  - Native toast security notifications, desktop broadcasting, and SOC incident reporting.
  - Self-healing configuration, tamper protection loop, and session-aware interactive locking.
================================================================================
#>

[CmdletBinding()]
param (
    [string]$ServerUrl = "https://assets.circuvent.com",
    [string]$DeviceApiKey = "",
    [string]$EnrollToken = "",
    [string]$ApiKey = "",
    [string]$TenantOrgId = "",
    [string]$EmployeeEmail = "",
    [string]$EmployeeCode = "",
    [switch]$RunAsService
)

# --------------------------------------------------------------------------------------------------
# SECTION 1: GLOBAL AGENT INITIALIZATION & CONFIGURATION CACHE
# --------------------------------------------------------------------------------------------------
# Circuvent Endpoint Security Agent stores persistent settings in ProgramData.
# These values survive script updates, watchdog restarts, and machine reboots.
# --------------------------------------------------------------------------------------------------
$ConfigPath = "$env:ProgramData\Circuvent\Security\agent-config.json"
$script:AgentCfg = [ordered]@{
    ServerUrl     = $ServerUrl
    DeviceApiKey  = $DeviceApiKey
    EnrollToken   = $EnrollToken
    ApiKey        = $ApiKey
    TenantOrgId   = $TenantOrgId
    EmployeeEmail = $EmployeeEmail
    EmployeeCode  = $EmployeeCode
}

# Persist the current configuration hashtable to disk in UTF-8 JSON format.
# When an agent key is issued or refreshed, Save-AgentConfig locks it immediately.
function Save-AgentConfig {
    try {
        $payload = @{
            ServerUrl     = $script:AgentCfg.ServerUrl
            DeviceApiKey  = $script:AgentCfg.DeviceApiKey
            EnrollToken   = $script:AgentCfg.EnrollToken
            ApiKey        = $script:AgentCfg.ApiKey
            TenantOrgId   = $script:AgentCfg.TenantOrgId
            EmployeeEmail = $script:AgentCfg.EmployeeEmail
            EmployeeCode  = $script:AgentCfg.EmployeeCode
        }
        $payload | ConvertTo-Json | Set-Content -Path $ConfigPath -Encoding UTF8
    }
    catch {
        Write-GuardLog "Could not persist agent-config.json: $_" "WARN"
    }
}

# --------------------------------------------------------------------------------------------------
# SECTION 2: ENDPOINT REGISTRATION & ENROLLMENT HANDLER
# --------------------------------------------------------------------------------------------------
# If the machine is booted without an active DeviceApiKey, the enrollment routine
# collects chassis details and contacts /api/agent/enroll to exchange the token.
# --------------------------------------------------------------------------------------------------
function Invoke-AgentEnroll {
    if (-not $script:AgentCfg.EnrollToken -and -not $script:AgentCfg.DeviceApiKey) {
        Write-GuardLog "Enrollment aborted: Neither EnrollToken nor DeviceApiKey provided." "WARN"
        return $false
    }

    try {
        $bios = Get-CimInstance Win32_BIOS -ErrorAction SilentlyContinue
        $os = Get-CimInstance Win32_OperatingSystem -ErrorAction SilentlyContinue
        $cs = Get-CimInstance Win32_ComputerSystem -ErrorAction SilentlyContinue
        
        $serialNumber = "UNKNOWN"
        if ($bios -and $bios.SerialNumber) {
            $serialNumber = $bios.SerialNumber.Trim()
        }
        
        $osCaption = "Windows 11"
        if ($os -and $os.Caption) {
            $osCaption = $os.Caption.Trim()
        }

        $payload = @{
            deviceHostname = $env:COMPUTERNAME
            deviceSerial   = $serialNumber
            employeeEmail  = $script:AgentCfg.EmployeeEmail
            employeeCode   = $script:AgentCfg.EmployeeCode
            orgId          = $script:AgentCfg.TenantOrgId
            agentVersion   = $script:AgentVersion
            osFamily       = "windows"
            osVersion      = $osCaption
            policyMode     = "strict_block"
            usbBlocked     = $true
            firewallActive = $true
        } | ConvertTo-Json -Depth 4

        $enrollUri = "$($script:AgentCfg.ServerUrl)/api/agent/enroll"
        Write-GuardLog "Submitting registration to enrollment gateway: $enrollUri" "INFO"

        $res = Invoke-RestMethod `
            -Uri $enrollUri `
            -Method Post `
            -Body $payload `
            -Headers (Get-CircuventAgentHeaders) `
            -TimeoutSec 20

        if ($res -and $res.deviceApiKey) {
            $script:AgentCfg.DeviceApiKey = $res.deviceApiKey
            $script:AgentCfg.EnrollToken = ""
            Save-AgentConfig
            Write-GuardLog "Device enrolled -- agent API key saved successfully" "INFO"
            return $true
        }
    }
    catch {
        Write-GuardLog "Enrollment attempt failed: $_" "WARN"
    }
    return $false
}

# --------------------------------------------------------------------------------------------------
# SECTION 3: CONFIGURATION DISCOVERY & URL NORMALIZATION
# --------------------------------------------------------------------------------------------------
# Ingest previously stored local configs, fix legacy domains, and re-bind arguments.
# --------------------------------------------------------------------------------------------------
function Import-AgentConfig {
    if (-not (Test-Path $ConfigPath)) { return }
    try {
        $saved = Get-Content $ConfigPath -Raw | ConvertFrom-Json
        if ($saved.ServerUrl) {
            $url = [string]$saved.ServerUrl
            if ($url -match 'devices\.circuvent\.com') {
                $url = $url -replace 'devices\.circuvent\.com', 'assets.circuvent.com'
            }
            $script:AgentCfg.ServerUrl = $url.TrimEnd('/')
        }
        if ($saved.DeviceApiKey)  { $script:AgentCfg.DeviceApiKey = $saved.DeviceApiKey }
        if ($saved.EnrollToken)   { $script:AgentCfg.EnrollToken = $saved.EnrollToken }
        if ($saved.ApiKey)        { $script:AgentCfg.ApiKey = $saved.ApiKey }
        if ($saved.TenantOrgId)   { $script:AgentCfg.TenantOrgId = $saved.TenantOrgId }
        if ($saved.EmployeeEmail) { $script:AgentCfg.EmployeeEmail = $saved.EmployeeEmail }
        if ($saved.EmployeeCode)  { $script:AgentCfg.EmployeeCode = $saved.EmployeeCode }
    }
    catch {
        # Config parsing safeguard during early system bootstrapping.
    }
}

if (Test-Path $ConfigPath) {
    try {
        $saved = Get-Content $ConfigPath -Raw | ConvertFrom-Json
        if (-not $ServerUrl -and $saved.ServerUrl) { $script:AgentCfg.ServerUrl = $saved.ServerUrl }
        if (-not $DeviceApiKey -and $saved.DeviceApiKey) { $script:AgentCfg.DeviceApiKey = $saved.DeviceApiKey }
        if (-not $EnrollToken -and $saved.EnrollToken) { $script:AgentCfg.EnrollToken = $saved.EnrollToken }
        if (-not $ApiKey -and $saved.ApiKey) { $script:AgentCfg.ApiKey = $saved.ApiKey }
        if (-not $TenantOrgId -and $saved.TenantOrgId) { $script:AgentCfg.TenantOrgId = $saved.TenantOrgId }
        if (-not $EmployeeEmail -and $saved.EmployeeEmail) { $script:AgentCfg.EmployeeEmail = $saved.EmployeeEmail }
        if (-not $EmployeeCode -and $saved.EmployeeCode) { $script:AgentCfg.EmployeeCode = $saved.EmployeeCode }
    } catch {}
}

# IT commands (USB grants, policy refresh) poll every 15s; full telemetry every 5 minutes.
$script:AgentVersion = "2.7.0"
$script:CommandPollSeconds = 15
$script:FullHeartbeatSeconds = 300

# Generate authenticated headers for all backend communications
function Get-CircuventAgentHeaders {
    $headers = @{
        "Content-Type"      = "application/json"
        "X-Circuvent-Agent" = "CircuventGuard-$($script:AgentVersion)"
    }
    if ($script:AgentCfg.DeviceApiKey) {
        $headers["X-Device-Agent-Key"] = $script:AgentCfg.DeviceApiKey
    } elseif ($script:AgentCfg.EnrollToken) {
        $headers["X-Device-Enroll-Token"] = $script:AgentCfg.EnrollToken
    } elseif ($script:AgentCfg.ApiKey) {
        $headers["X-API-Key"] = $script:AgentCfg.ApiKey
    }
    return $headers
}

$ErrorActionPreference = "SilentlyContinue"

# Log & data directory structure
$LogDir = "$env:ProgramData\Circuvent\Security"
if (-not (Test-Path $LogDir)) {
    New-Item -ItemType Directory -Path $LogDir -Force | Out-Null
}
$LogFile = "$LogDir\CircuventGuard.log"
$GrantFile = "$LogDir\usb-grants.json"
$script:UsbAlertCooldown = @{}

# --------------------------------------------------------------------------------------------------
# SECTION 4: TEMPORARY USB GRANT AUDITING & PERSISTENCE
# --------------------------------------------------------------------------------------------------
# Handles IT exceptions granted through the HRMS / Security console dashboard.
# --------------------------------------------------------------------------------------------------
function Save-UsbGrantsFromHeartbeat {
    param([object]$Grants)
    $payload = @{
        grants    = if ($Grants) { @($Grants) } else { @() }
        updatedAt = (Get-Date).ToUniversalTime().ToString("o")
    }
    $payload | ConvertTo-Json -Depth 6 | Set-Content -Path $GrantFile -Encoding UTF8
}

function Get-GrantExpiryUtc {
    param([string]$ExpiresAt)
    if ([string]::IsNullOrWhiteSpace($ExpiresAt)) { return $null }
    try {
        return [DateTime]::Parse(
            $ExpiresAt,
            [Globalization.CultureInfo]::InvariantCulture,
            [Globalization.DateTimeStyles]::AdjustToUniversal -bor [Globalization.DateTimeStyles]::AssumeUniversal
        )
    } catch {
        try {
            return [DateTimeOffset]::Parse($ExpiresAt).UtcDateTime
        } catch {
            return $null
        }
    }
}

function Test-UsbAccessGranted {
    if (-not (Test-Path $GrantFile)) { return $false }
    try {
        $data = Get-Content $GrantFile -Raw -Encoding UTF8 | ConvertFrom-Json
        $now = [DateTime]::UtcNow
        foreach ($g in @($data.grants)) {
            $exp = Get-GrantExpiryUtc -ExpiresAt ([string]$g.expiresAt)
            if ($exp -and $exp -gt $now) {
                return $true
            }
        }
    } catch {}
    return $false
}

function Write-GuardLog {
    param([string]$Message, [string]$Level = "INFO")
    $timestamp = (Get-Date).ToString("yyyy-MM-dd HH:mm:ss")
    $logEntry = "[$timestamp] [$Level] $Message"
    try {
        Add-Content -Path $LogFile -Value $logEntry -Encoding UTF8
    } catch {}
    Write-Host $logEntry
}

# --------------------------------------------------------------------------------------------------
# SECTION 5: WINDOWS NATIVE TOAST & INTERACTIVE DESKTOP ALERTS
# --------------------------------------------------------------------------------------------------
# Displays actionable native Windows notifications when malicious media is attached.
# --------------------------------------------------------------------------------------------------
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

# --------------------------------------------------------------------------------------------------
# SECTION 6: STORAGE CONTROLLER & EGRESS FIREWALL ENFORCEMENT
# --------------------------------------------------------------------------------------------------
# Hardens USBSTOR registry keys and manages egress rules for non-corporate storage.
# --------------------------------------------------------------------------------------------------
function Sync-UsbStoragePolicy {
    param([string]$Reason = "policy")
    $usbStorReg = "HKLM:\SYSTEM\CurrentControlSet\Services\USBSTOR"
    $wpdReg = "HKLM:\SYSTEM\CurrentControlSet\Services\WpdBusEnum"
    $removablePolReg = "HKLM:\SOFTWARE\Policies\Microsoft\Windows\RemovableStorageDevices"
    $deviceInstallReg = "HKLM:\SOFTWARE\Policies\Microsoft\Windows\DeviceInstall\Restrictions"

    if (-not (Test-Path $usbStorReg)) { return }
    try {
        $isGranted = Test-UsbAccessGranted
        if ($isGranted) {
            # 1. Allow USBSTOR driver service (Start = 3 Demand Start)
            $currentUsbStor = (Get-ItemProperty -Path $usbStorReg -Name "Start" -ErrorAction SilentlyContinue).Start
            if ($currentUsbStor -ne 3) {
                Set-ItemProperty -Path $usbStorReg -Name "Start" -Value 3 -Type DWord -Force
                Write-GuardLog "USBSTOR service enabled (Start=3) -- active IT grant ($Reason)" "INFO"
            }

            # 2. Allow WpdBusEnum for portable media/MTP devices
            if (Test-Path $wpdReg) {
                $currentWpd = (Get-ItemProperty -Path $wpdReg -Name "Start" -ErrorAction SilentlyContinue).Start
                if ($currentWpd -ne 3) {
                    Set-ItemProperty -Path $wpdReg -Name "Start" -Value 3 -Type DWord -Force -ErrorAction SilentlyContinue
                }
            }

            # 3. Completely wipe RemovableStorageDevices restriction policies across HKLM, HKCU, and all user profiles (HKEY_USERS)
            if (Test-Path $removablePolReg) {
                Remove-Item -Path $removablePolReg -Recurse -Force -ErrorAction SilentlyContinue
            }
            $hkcuRem = "HKCU:\SOFTWARE\Policies\Microsoft\Windows\RemovableStorageDevices"
            if (Test-Path $hkcuRem) {
                Remove-Item -Path $hkcuRem -Recurse -Force -ErrorAction SilentlyContinue
            }
            Get-ChildItem -Path "Registry::HKEY_USERS" -ErrorAction SilentlyContinue | ForEach-Object {
                $uRem = "$($_.PSPath)\SOFTWARE\Policies\Microsoft\Windows\RemovableStorageDevices"
                if (Test-Path $uRem) {
                    Remove-Item -Path $uRem -Recurse -Force -ErrorAction SilentlyContinue
                }
            }

            # 4. Clear DeviceInstall Restrictions (wipes deny classes and retroactive locks)
            if (Test-Path $deviceInstallReg) {
                Remove-Item -Path $deviceInstallReg -Recurse -Force -ErrorAction SilentlyContinue
            }

            # 5. Clear StorageDevicePolicies WriteProtect
            $storagePoliciesReg = "HKLM:\SYSTEM\CurrentControlSet\Control\StorageDevicePolicies"
            if (Test-Path $storagePoliciesReg) {
                Set-ItemProperty -Path $storagePoliciesReg -Name "WriteProtect" -Value 0 -Type DWord -Force -ErrorAction SilentlyContinue
            }

            # 6. Online and clear read-only on all USB disks and storage volumes
            try {
                Get-Disk -ErrorAction SilentlyContinue | Where-Object { $_.BusType -eq 'USB' } | ForEach-Object {
                    Set-Disk -Number $_.Number -IsOffline $false -IsReadOnly $false -ErrorAction SilentlyContinue
                    $dp = @"
select disk $($_.Number)
attributes disk clear readonly
online disk
"@
                    $dp | diskpart 2>$null | Out-Null
                }

                # Clear volume read-only and online via diskpart for all removable/fixed drive letters
                Get-Volume -ErrorAction SilentlyContinue | Where-Object { $_.DriveLetter } | ForEach-Object {
                    $dl = $_.DriveLetter
                    $dpV = @"
select volume $dl
attributes volume clear readonly
online volume
"@
                    $dpV | diskpart 2>$null | Out-Null
                }
                & mountvol /E 2>$null | Out-Null
            } catch {}

            # 7. Trigger device discovery, volume refresh, and user policy refresh
            try {
                & pnputil.exe /scan-devices 2>$null | Out-Null
                "rescan" | diskpart 2>$null | Out-Null
                & rundll32.exe user32.dll,UpdatePerUserSystemParameters 2>$null | Out-Null
                & gpupdate.exe /target:computer /force /wait:0 2>$null | Out-Null
                & gpupdate.exe /target:user /force /wait:0 2>$null | Out-Null
            } catch {}

            Write-GuardLog "USB storage fully unblocked and online -- active IT grant ($Reason)" "INFO"
        } else {
            # 1. Disable USBSTOR driver service (Start = 4 Disabled)
            $currentUsbStor = (Get-ItemProperty -Path $usbStorReg -Name "Start" -ErrorAction SilentlyContinue).Start
            if ($currentUsbStor -ne 4) {
                Set-ItemProperty -Path $usbStorReg -Name "Start" -Value 4 -Type DWord -Force
                Write-GuardLog "USBSTOR service disabled (Start=4) -- policy enforced ($Reason)" "WARN"
            }

            # 2. Disable WpdBusEnum
            if (Test-Path $wpdReg) {
                Set-ItemProperty -Path $wpdReg -Name "Start" -Value 4 -Type DWord -Force -ErrorAction SilentlyContinue
            }

            # 3. Enforce RemovableStorageDevices restriction policies
            if (-not (Test-Path $removablePolReg)) {
                New-Item -Path $removablePolReg -Force -ErrorAction SilentlyContinue | Out-Null
            }
            if (Test-Path $removablePolReg) {
                Set-ItemProperty -Path $removablePolReg -Name "Deny_All" -Value 1 -Type DWord -Force -ErrorAction SilentlyContinue
                Set-ItemProperty -Path $removablePolReg -Name "Deny_Read" -Value 1 -Type DWord -Force -ErrorAction SilentlyContinue
                Set-ItemProperty -Path $removablePolReg -Name "Deny_Write" -Value 1 -Type DWord -Force -ErrorAction SilentlyContinue
            }

            # 4. Eject / Offline any connected USB storage
            try {
                $logical = Get-CimInstance Win32_LogicalDisk -ErrorAction SilentlyContinue | Where-Object { $_.DriveType -in 2,3,5 }
                foreach ($ld in $logical) {
                    if ($ld.DeviceID) {
                        Eject-RemovableVolume -DriveLetter $ld.DeviceID
                    }
                }
            } catch {}
        }
    }
    catch {
        Write-GuardLog "Sync-UsbStoragePolicy failed: $_" "ERROR"
    }
}

function Sync-CloudEgressPolicy {
    param([string]$Reason = "policy")
    $egressScript = "$LogDir\Apply-CircuventCloudEgress.ps1"
    if (-not (Test-Path $egressScript)) {
        try {
            $uri = "$($script:AgentCfg.ServerUrl)/security/windows/Apply-CircuventCloudEgress.ps1"
            Invoke-WebRequest -Uri $uri -OutFile $egressScript -UseBasicParsing -TimeoutSec 30
        } catch {
            Write-GuardLog "Could not download cloud egress script: $_" "WARN"
            return
        }
    }
    try {
        & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $egressScript
        Write-GuardLog "Cloud egress firewall rules refreshed ($Reason)" "INFO"
    } catch {
        Write-GuardLog "Sync-CloudEgressPolicy failed: $_" "WARN"
    }
}

function Notify-InteractiveUser {
    param(
        [string]$Title = "Circuvent Security Alert",
        [string]$Message = "External USB storage is not permitted on this device. The drive has been blocked."
    )
    $banner = "$Title -- $Message"
    Show-WindowsToast -Title $Title -Message $Message
    try {
        $sessionIds = @()
        $lines = @(query user 2>$null | Select-Object -Skip 1)
        foreach ($line in $lines) {
            $trimmed = ($line -replace '^\s*>', '').Trim()
            if ($trimmed -match '^(\S+)\s+(\S+)?\s+(\d+)\s+') {
                $sessionIds += $Matches[3]
            }
        }
        if ($sessionIds.Count -gt 0) {
            foreach ($sid in $sessionIds) {
                & msg.exe $sid /TIME:45 $banner 2>$null | Out-Null
            }
        }
        else {
            & msg.exe * /TIME:45 $banner 2>$null | Out-Null
        }
    }
    catch {
        Write-GuardLog "Could not display desktop notification: $_" "WARN"
    }
}

# --------------------------------------------------------------------------------------------------
# SECTION 7: HARDWARE AUDITING, NEUTRALIZATION & SOC INCIDENT PIPELINE
# --------------------------------------------------------------------------------------------------
# Intercepts raw USB disk arrivals, extracts PnP metadata, and dispatches critical DLP alerts.
# --------------------------------------------------------------------------------------------------
function Invoke-UsbStorageViolation {
    param(
        [string]$Vendor,
        [string]$Model,
        [string]$PnpId,
        [hashtable]$Metadata,
        [string]$Detection = "agent"
    )
    if (Test-UsbAccessGranted) { return }

    $cooldownKey = if ($PnpId) { $PnpId } else { "$Vendor|$Model" }
    if ($script:UsbAlertCooldown.ContainsKey($cooldownKey)) {
        $elapsed = (Get-Date) - $script:UsbAlertCooldown[$cooldownKey]
        if ($elapsed.TotalSeconds -lt 30) { return }
    }
    $script:UsbAlertCooldown[$cooldownKey] = Get-Date

    $label = "$Vendor $Model".Trim()
    Write-GuardLog "USB storage violation ($Detection): $label" "WARN"
    Notify-InteractiveUser -Message "External USB storage ($label) is not permitted. The device has been blocked. Contact IT for a temporary exception."

    Send-IncidentTelemetry -IncidentType "unauthorized_usb_drive" -Severity "critical" -ActionTaken "blocked_and_ejected" -Metadata ($Metadata + @{
        vendor      = $Vendor
        model       = $Model
        pnpDeviceID = $PnpId
        detection   = $Detection
    })
}

function Get-UsbStorageCandidates {
    $seen = @{}
    $results = @()

    # 1. Standard Win32_DiskDrive where InterfaceType = 'USB'
    $disks = @(Get-CimInstance Win32_DiskDrive -Filter "InterfaceType='USB'" -ErrorAction SilentlyContinue)
    foreach ($disk in $disks) {
        $pnpId = if ($disk.PNPDeviceID) { $disk.PNPDeviceID } else { "" }
        $key = if ($pnpId) { $pnpId } else { "disk|$($disk.Index)" }
        if ($seen.ContainsKey($key)) { continue }
        $seen[$key] = $true

        $vendor = if ($disk.Manufacturer) { $disk.Manufacturer.Trim() } else { "USB Storage" }
        $model = if ($disk.Model) { $disk.Model.Trim() } else { "External Disk" }
        $sizeGB = if ($disk.Size) { [Math]::Round(($disk.Size / 1GB), 2) } else { 0 }

        $partitions = @(Get-CimAssociatedInstance -InputObject $disk -ResultClassName Win32_DiskPartition -ErrorAction SilentlyContinue)
        $driveLetters = @()
        foreach ($part in $partitions) {
            $logical = @(Get-CimAssociatedInstance -InputObject $part -ResultClassName Win32_LogicalDisk -ErrorAction SilentlyContinue)
            foreach ($vol in $logical) {
                if ($vol.DeviceID) { $driveLetters += $vol.DeviceID }
            }
        }

        $results += [pscustomobject]@{
            Vendor       = $vendor
            Model        = $model
            PnpDeviceID  = $pnpId
            SizeGB       = $sizeGB
            DriveLetters = ($driveLetters -join ", ")
            DriverBlock  = ($driveLetters.Count -eq 0)
            Detection    = "Win32_DiskDrive"
        }
    }

    # 2. Raw PnP Entity detection (CRITICAL when USBSTOR service is disabled Start=4)
    $pnpDevices = @(
        Get-CimInstance Win32_PnPEntity -ErrorAction SilentlyContinue |
            Where-Object {
                $_.PNPDeviceID -and (
                    $_.PNPDeviceID -like "USBSTOR\*" -or
                    $_.Service -eq "USBSTOR" -or
                    ($_.CompatibleID -and ($_.CompatibleID -match "USB\\Class_08" -or $_.CompatibleID -match "USB\\Class_06")) -or
                    ($_.HardwareID -and ($_.HardwareID -match "USB\\Class_08")) -or
                    ($_.PNPClass -eq "DiskDrive" -and ($_.PNPDeviceID -like "USB\*" -or $_.PNPDeviceID -like "USBSTOR\*")) -or
                    ($_.ClassGuid -eq "{4d36e967-e325-11ce-bfc1-08002be10318}" -and ($_.PNPDeviceID -like "USB\*" -or $_.PNPDeviceID -like "USBSTOR\*"))
                )
            }
    )
    foreach ($dev in $pnpDevices) {
        $pnpId = $dev.PNPDeviceID
        if ($seen.ContainsKey($pnpId)) { continue }
        $seen[$pnpId] = $true

        $friendly = if ($dev.Name) { $dev.Name.Trim() } else { "USB Mass Storage Device" }
        $vendor = if ($dev.Manufacturer) { $dev.Manufacturer.Trim() } else { "USB Storage" }

        $results += [pscustomobject]@{
            Vendor       = $vendor
            Model        = $friendly
            PnpDeviceID  = $pnpId
            SizeGB       = 0
            DriveLetters = ""
            DriverBlock  = $true
            Detection    = "Win32_PnPEntity"
        }
    }

    return $results
}

function Test-ConnectedUsbStorage {
    $grantActive = Test-UsbAccessGranted
    $devices = @(Get-UsbStorageCandidates)
    if ($devices.Count -eq 0) { return @() }

    foreach ($device in $devices) {
        $meta = @{
            sizeGB       = $device.SizeGB
            interface    = "USB"
            driveLetters = $device.DriveLetters
            driverBlock  = $device.DriverBlock
        }

        if ($grantActive) {
            $auditKey = if ($device.PnpDeviceID) { "allowed|$($device.PnpDeviceID)" } else { "allowed|$($device.Vendor)|$($device.Model)" }
            if (-not $script:UsbAlertCooldown.ContainsKey($auditKey) -or (((Get-Date) - $script:UsbAlertCooldown[$auditKey]).TotalMinutes -ge 5)) {
                $script:UsbAlertCooldown[$auditKey] = Get-Date
                Write-GuardLog "USB storage device connected under active IT grant: $($device.Vendor) $($device.Model)" "INFO"
                Send-IncidentTelemetry -IncidentType "authorized_usb_connected" -Severity "low" -ActionTaken "allowed_under_grant" -Metadata ($meta + @{
                    vendor      = $device.Vendor
                    model       = $device.Model
                    pnpDeviceID = $device.PnpDeviceID
                    detection   = $device.Detection
                })
            }
            continue
        }

        Invoke-UsbStorageViolation -Vendor $device.Vendor -Model $device.Model -PnpId $device.PnpDeviceID -Metadata $meta -Detection $device.Detection
    }

    return $devices
}

function Eject-RemovableVolume {
    param([string]$DriveLetter)
    if (Test-UsbAccessGranted) {
        Write-GuardLog "Skipping ejection of ${DriveLetter} -- active IT grant in place" "INFO"
        return
    }
    try {
        Write-GuardLog "Neutralizing unauthorized drive volume: ${DriveLetter}" "WARN"
        & mountvol "$DriveLetter" /D 2>$null
        $shell = New-Object -ComObject Shell.Application
        $shell.Namespace(17).ParseName($DriveLetter).InvokeVerb("Eject") 2>$null
        
        $cleanLetter = $DriveLetter.Replace(":", "").Trim()
        "select volume $cleanLetter`noffline volume" | diskpart 2>$null
        Write-GuardLog "Successfully neutralized drive ${DriveLetter}" "INFO"
    }
    catch {
        Write-GuardLog "Failed to dismount drive ${DriveLetter}: $_" "ERROR"
    }
}

function Send-IncidentTelemetry {
    param(
        [string]$IncidentType,
        [string]$Severity,
        [string]$ActionTaken,
        [hashtable]$Metadata
    )

    Import-AgentConfig
    $hostname = $env:COMPUTERNAME
    $username = $env:USERNAME
    $osVersion = (Get-CimInstance Win32_OperatingSystem).Caption

    $payload = @{
        deviceHostname = $hostname
        deviceUsername = $username
        deviceSerial   = (Get-CimInstance Win32_BIOS).SerialNumber
        employeeEmail  = $script:AgentCfg.EmployeeEmail
        employeeCode   = $script:AgentCfg.EmployeeCode
        orgId          = $script:AgentCfg.TenantOrgId
        incidentType   = $IncidentType
        severity       = $Severity
        actionTaken    = $ActionTaken
        osVersion      = $osVersion
        timestamp      = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
        metadata       = $Metadata
    } | ConvertTo-Json -Depth 6

    try {
        $headers = Get-CircuventAgentHeaders
        $incidentEndpoint = "$($script:AgentCfg.ServerUrl)/api/agent/incidents"
        Invoke-RestMethod -Uri $incidentEndpoint -Method Post -Body $payload -Headers $headers -TimeoutSec 15 | Out-Null
        Write-GuardLog "Incident telemetry dispatched to server: $IncidentType" "INFO"
    }
    catch {
        Write-GuardLog "Failed to send incident telemetry ($IncidentType): $_" "ERROR"
    }
}

# --------------------------------------------------------------------------------------------------
# SECTION 8: REMOTE COMMAND CONSUMER & SESSION-AWARE EXECUTION CONTROLLER
# --------------------------------------------------------------------------------------------------
# Processes commands dispatched from the fleet portal (lock, kill_process, wipe_cache, scan, diagnostics).
# --------------------------------------------------------------------------------------------------
function Normalize-CommandList {
    param([object]$Raw)
    if (-not $Raw) { return @() }
    if ($Raw -is [System.Array]) { return $Raw }
    if ($Raw.PSObject.Properties.Name -contains "id") { return @($Raw) }
    return @($Raw)
}

function Complete-Command {
    param(
        [string]$CommandId,
        [string]$Status,
        [string]$ResultOutput,
        [string]$ErrorMessage = $null
    )
    $payload = @{
        commandId      = $CommandId
        deviceHostname = $env:COMPUTERNAME
        status         = $Status
        resultOutput   = $ResultOutput
        errorMessage   = $ErrorMessage
    } | ConvertTo-Json

    $headers = Get-CircuventAgentHeaders
    $uri = "$($script:AgentCfg.ServerUrl)/api/agent/commands/complete"

    for ($attempt = 1; $attempt -le 3; $attempt++) {
        try {
            Invoke-RestMethod -Uri $uri -Method Post -Body $payload -Headers $headers -TimeoutSec 10 | Out-Null
            Write-GuardLog "Command $CommandId marked as $Status." "INFO"
            return
        } catch {
            if ($attempt -lt 3) {
                Start-Sleep -Seconds (2 * $attempt)
            } else {
                Write-GuardLog "Failed to report command completion for ${CommandId}: $_" "WARN"
            }
        }
    }
}

function Lock-InteractiveUserWorkstation {
    Write-Output "[*] Executing session-aware physical workstation lock..."
    $lockExecuted = $false
    $details = ""

    # Method 1: Target active user session via tsdiscon (Disconnects & locks physical session)
    try {
        $quserOutput = quser 2>$null
        if ($quserOutput) {
            foreach ($line in ($quserOutput -split "`n")) {
                if ($line -match '\s+(\d+)\s+Active') {
                    $sessionId = $matches[1]
                    Write-Output "[*] Forcing lock/disconnect on active user session ID: $sessionId"
                    tsdiscon.exe $sessionId 2>&1 | Out-Null
                    $lockExecuted = $true
                    $details = "Forced disconnect on session $sessionId"
                    break
                }
            }
        }
    } catch {
        Write-Warning "tsdiscon session isolation fallback triggered: $_"
    }

    # Method 2: Spawn LockWorkStation inside active explorer.exe process context if SYSTEM
    if (-not $lockExecuted) {
        try {
            $explorerProcess = Get-Process -Name "explorer" -ErrorAction SilentlyContinue | Select-Object -First 1
            if ($explorerProcess) {
                Invoke-CimMethod -ClassName Win32_Process -MethodName "Create" -Arguments @{
                    CommandLine = "rundll32.exe user32.dll,LockWorkStation"
                } | Out-Null
                $lockExecuted = $true
                $details = "Spawned LockWorkStation via CIM Win32_Process"
            }
        } catch {}
    }

    # Method 3: Direct User32 LockWorkStation API fallback
    if (-not $lockExecuted) {
        try {
            Add-Type -TypeDefinition '
                using System;
                using System.Runtime.InteropServices;
                namespace Circuvent.Security {
                    public class ScreenLock {
                        [DllImport("user32.dll")]
                        public static extern bool LockWorkStation();
                    }
                }' -ErrorAction SilentlyContinue
            [Circuvent.Security.ScreenLock]::LockWorkStation() | Out-Null
            $lockExecuted = $true
            $details = "Direct P/Invoke LockWorkStation"
        } catch {
            Start-Process -FilePath "$env:SystemRoot\System32\rundll32.exe" -ArgumentList "user32.dll,LockWorkStation" -NoNewWindow
            $lockExecuted = $true
            $details = "Standard rundll32 fallback"
        }
    }

    if ($lockExecuted) {
        Write-GuardLog "Physical workstation locked successfully ($details)" "INFO"
        return $true
    }
    return $false
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
                $locked = Lock-InteractiveUserWorkstation
                if ($locked) {
                    Complete-Command -CommandId $cmdId -Status "completed" -ResultOutput "Workstation locked -- unlock with Ctrl+Alt+Delete and your Windows password."
                } else {
                    Complete-Command -CommandId $cmdId -Status "failed" -ResultOutput "No interactive user session was found to lock."
                }
            }

            "policy_refresh" {
                Sync-UsbStoragePolicy -Reason "policy_refresh"
                Sync-CloudEgressPolicy -Reason "policy_refresh"
                $state = if (Test-UsbAccessGranted) {
                    "USB enabled under active IT grant; cloud egress rules refreshed."
                } else {
                    "USB storage blocked (USBSTOR disabled); cloud egress rules refreshed."
                }
                Complete-Command -CommandId $cmdId -Status "completed" -ResultOutput $state
            }

            "usb_grant_sync" {
                try {
                    $grantData = if (Test-Path $GrantFile) {
                        Get-Content $GrantFile -Raw -Encoding UTF8 | ConvertFrom-Json
                    } else {
                        [pscustomobject]@{ grants = @(); updatedAt = (Get-Date).ToUniversalTime().ToString("o") }
                    }
                    $existingGrants = @()
                    if ($grantData -and $grantData.grants) {
                        $existingGrants = @($grantData.grants)
                    }

                    if ($payload.revoked -eq $true) {
                        $revokedId = [string]$payload.grantId
                        $remaining = @($existingGrants | Where-Object { [string]$_.id -ne $revokedId -and [string]$_.grantId -ne $revokedId })
                        Save-UsbGrantsFromHeartbeat -Grants $remaining
                        Write-GuardLog "USB grant revoked via remote command (ID: $revokedId)" "WARN"
                    } elseif ($payload.expiresAt) {
                        $newGrant = [pscustomobject]@{
                            id             = if ($payload.grantId) { [string]$payload.grantId } else { [Guid]::NewGuid().ToString() }
                            expiresAt      = [string]$payload.expiresAt
                            reason         = [string]$payload.reason
                            grantedByEmail = [string]$payload.grantedByEmail
                        }
                        $updatedList = @($existingGrants | Where-Object { [string]$_.id -ne $newGrant.id -and [string]$_.grantId -ne $newGrant.id }) + $newGrant
                        Save-UsbGrantsFromHeartbeat -Grants $updatedList
                        Write-GuardLog "USB grant applied via remote command: expires $($payload.expiresAt)" "INFO"
                    }
                } catch {
                    Write-GuardLog "Error updating local usb-grants.json from remote command: $_" "WARN"
                }

                Sync-UsbStoragePolicy -Reason "usb_grant_sync"
                $state = if (Test-UsbAccessGranted) {
                    Show-WindowsToast -Title "Circuvent IT: USB Access Granted" -Message "Temporary USB storage access has been activated for this device."
                    "USB enabled under active IT grant."
                } else {
                    Show-WindowsToast -Title "Circuvent IT: USB Access Revoked" -Message "USB storage access is no longer permitted on this device."
                    "USB blocked -- no active grant."
                }
                Complete-Command -CommandId $cmdId -Status "completed" -ResultOutput $state
            }

            "trigger_scan" {
                Test-ConnectedUsbStorage | Out-Null
                $apps = @()
                $paths = @("HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*", "HKLM:\SOFTWARE\Wow6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*")
                foreach ($p in $paths) {
                    Get-ItemProperty $p -ErrorAction SilentlyContinue | Where-Object { $_.DisplayName } | ForEach-Object {
                        $apps += @{ name = $_.DisplayName.Trim(); version = if ($_.DisplayVersion) { $_.DisplayVersion.Trim() } else { "1.0.0" } }
                    }
                }
                $swPayload = @{ deviceHostname = $env:COMPUTERNAME; software = $apps } | ConvertTo-Json -Depth 4
                Invoke-RestMethod -Uri "$($script:AgentCfg.ServerUrl)/api/agent/software" -Method Post -Body $swPayload -Headers (Get-CircuventAgentHeaders) -TimeoutSec 15 | Out-Null
                Send-Heartbeat
                Complete-Command -CommandId $cmdId -Status "completed" -ResultOutput "USB scan + software inventory + heartbeat completed ($($apps.Count) apps)."
            }

            "run_diagnostic" {
                $scriptText = if ($payload.script) { $payload.script } else { "Get-BitLockerVolume -MountPoint C:" }
                $diagResult = try {
                    Invoke-Expression $scriptText 2>&1 | Out-String
                } catch {
                    $_.Exception.Message
                }
                Complete-Command -CommandId $cmdId -Status "completed" -ResultOutput "Diagnostic executed successfully.`nOutput:`n$diagResult"
            }

            "update_agent" {
                Update-GuardScriptFromServer -Force
                Complete-Command -CommandId $cmdId -Status "completed" -ResultOutput "Agent script refreshed from server."
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

# --------------------------------------------------------------------------------------------------
# SECTION 9: RESTART, IN-PLACE UPDATING, AND SELF-HEALING ENGINE
# --------------------------------------------------------------------------------------------------
# Allows the running watchdog agent to seamlessly swap script definitions.
# --------------------------------------------------------------------------------------------------
function Restart-CircuventGuardProcess {
    param([string]$Reason = "restart")

    Import-AgentConfig
    $guardPath = "$env:ProgramData\Circuvent\Security\CircuventGuard.ps1"
    if (-not (Test-Path $guardPath)) {
        $guardPath = $PSCommandPath
    }

    $argList = @(
        "-NoProfile", "-ExecutionPolicy", "Bypass", "-WindowStyle", "Hidden",
        "-File", "`"$guardPath`""
    )
    if ($script:AgentCfg.ServerUrl) {
        $argList += "-ServerUrl", "`"$($script:AgentCfg.ServerUrl)`""
    }
    if ($script:AgentCfg.DeviceApiKey) {
        $argList += "-DeviceApiKey", "`"$($script:AgentCfg.DeviceApiKey)`""
    }
    if ($script:AgentCfg.TenantOrgId) {
        $argList += "-TenantOrgId", "`"$($script:AgentCfg.TenantOrgId)`""
    }
    if ($script:AgentCfg.EmployeeEmail) {
        $argList += "-EmployeeEmail", "`"$($script:AgentCfg.EmployeeEmail)`""
    }
    if ($script:AgentCfg.EmployeeCode) {
        $argList += "-EmployeeCode", "`"$($script:AgentCfg.EmployeeCode)`""
    }

    Write-GuardLog "Spawning replacement CircuventGuard process ($Reason)" "INFO"
    Start-Process -FilePath "powershell.exe" -ArgumentList $argList -WindowStyle Hidden
    Stop-Process -Id $PID -Force
}

function Update-GuardScriptFromServer {
    param([switch]$Force)

    try {
        $local = "$env:ProgramData\Circuvent\Security\CircuventGuard.ps1"
        $uri = "$($script:AgentCfg.ServerUrl)/security/windows/CircuventGuard.ps1"
        $remote = Invoke-WebRequest -Uri $uri -UseBasicParsing -TimeoutSec 25
        if ($remote.Content -notmatch 'Version:\s*([\d.]+)') { return }
        try {
            $remoteVer = [version]$Matches[1]
            if ($remoteVer -lt [version]"2.6.0") { return }
        } catch {
            return
        }
        $current = if (Test-Path $local) { (Get-Content $local -Raw).Trim() } else { "" }
        if ($Force -or $remote.Content.Trim() -ne $current) {
            Set-Content -Path $local -Value $remote.Content -Encoding UTF8
            Write-GuardLog "CircuventGuard v$($Matches[1]) saved -- restarting to load update" "INFO"
            Restart-CircuventGuardProcess -Reason "self_update"
        }
    }
    catch {
        Write-GuardLog "Agent self-update check failed: $_" "WARN"
    }
}

# --------------------------------------------------------------------------------------------------
# SECTION 10: TELEMETRY HEARTBEAT & BITLOCKER RECOVERY KEY ESCROW & PATCH AUDITING
# --------------------------------------------------------------------------------------------------
# Heartbeat reports endpoint compliance matrix and escrowed recovery keys to the centralized portal console.
# --------------------------------------------------------------------------------------------------
function Send-Heartbeat {
    param([switch]$Quick)

    Import-AgentConfig

    if ($script:AgentCfg.ServerUrl -match 'devices\.circuvent\.com') {
        $script:AgentCfg.ServerUrl = $script:AgentCfg.ServerUrl -replace 'devices\.circuvent\.com', 'assets.circuvent.com'
        Save-AgentConfig
    }

    if (-not $script:AgentCfg.DeviceApiKey) {
        if ($script:AgentCfg.EnrollToken) {
            Invoke-AgentEnroll | Out-Null
        }
        if (-not $script:AgentCfg.DeviceApiKey) {
            Write-GuardLog "Heartbeat skipped -- no DeviceApiKey. USB incidents still report via /api/agent/incidents. Re-run repair installer as Administrator." "ERROR"
            return
        }
    }

    try {
        $encStatus = "unknown"
        $encType = "none"
        $recoveryKeyVal = $null
        $missingPatches = 0

        if (-not $Quick) {
            try {
                $bl = Get-BitLockerVolume -MountPoint "C:" -ErrorAction SilentlyContinue
                if ($bl -and ($bl.ProtectionStatus -eq "On" -or $bl.VolumeStatus -eq "FullyEncrypted")) {
                    $encStatus = "encrypted"
                    $encType = "bitlocker"
                    # Extract BitLocker recovery password key protector if available
                    foreach ($kp in $bl.KeyProtector) {
                        if ($kp.KeyProtectorType -eq "RecoveryPassword") {
                            $recoveryKeyVal = $kp.RecoveryPassword
                            break
                        }
                    }
                } else {
                    $encStatus = "unencrypted"
                }
            } catch {
                $encStatus = "unknown"
            }

            try {
                $us = New-Object -ComObject Microsoft.Update.Session
                $res = $us.CreateUpdateSearcher().Search("IsInstalled=0 and Type='Software'")
                if ($res.Updates) { $missingPatches = $res.Updates.Count }
            } catch {}
        }

        $os = Get-CimInstance Win32_OperatingSystem -ErrorAction SilentlyContinue

        $usbTelemetry = @(
            Get-UsbStorageCandidates | ForEach-Object {
                @{
                    vendor       = $_.Vendor
                    model        = $_.Model
                    pnpDeviceID  = $_.PnpDeviceID
                    sizeGB       = $_.SizeGB
                    driveLetters = $_.DriveLetters
                    detection    = $_.Detection
                }
            }
        )

        $payload = @{
            deviceHostname      = $env:COMPUTERNAME
            deviceSerial        = (Get-CimInstance Win32_BIOS).SerialNumber
            employeeEmail       = $script:AgentCfg.EmployeeEmail
            orgId               = $script:AgentCfg.TenantOrgId
            agentVersion        = $script:AgentVersion
            osFamily            = "windows"
            osVersion           = if ($os.Caption) { $os.Caption.Trim() } else { "Windows 11" }
            osBuild             = if ($os.BuildNumber) { $os.BuildNumber.ToString() } else { "22631" }
            usbBlocked          = $true
            firewallActive      = $true
            encryptionStatus    = $encStatus
            encryptionType      = $encType
            recoveryKey         = $recoveryKeyVal
            missingPatchesCount = $missingPatches
            connectedUsbStorage = $usbTelemetry
            syncOnly            = [bool]$Quick
            timestamp           = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
        } | ConvertTo-Json -Depth 6

        $headers = Get-CircuventAgentHeaders
        $response = Invoke-RestMethod -Uri "$($script:AgentCfg.ServerUrl)/api/agent/heartbeat" -Method Post -Body $payload -Headers $headers -TimeoutSec 20

        Set-Content -Path "$LogDir\last-heartbeat.txt" -Value (Get-Date).ToUniversalTime().ToString("o") -Encoding UTF8 -Force

        if ($response.usbGrants) {
            Save-UsbGrantsFromHeartbeat -Grants $response.usbGrants
        } else {
            Save-UsbGrantsFromHeartbeat -Grants @()
        }
        Sync-UsbStoragePolicy -Reason $(if ($Quick) { "command_poll" } else { "heartbeat" })

        $cmds = Normalize-CommandList -Raw $response.pendingCommands
        if ($cmds.Count -gt 0) {
            foreach ($cmd in $cmds) {
                Execute-RemoteCommand -Cmd $cmd
            }
        }

        Update-GuardScriptFromServer
    }
    catch {
        $status = $null
        if ($_.Exception.Response) {
            try { $status = [int]$_.Exception.Response.StatusCode } catch {}
        }
        if ($status -eq 401 -and $script:AgentCfg.EnrollToken) {
            Write-GuardLog "Heartbeat rejected (401) -- retrying enrollment" "WARN"
            if (Invoke-AgentEnroll) {
                Send-Heartbeat @PSBoundParameters
                return
            }
        }
        Write-GuardLog "Agent sync failed: $_" "WARN"
    }
}

# --- Initialization Banner ---
Write-GuardLog "========================================================"
Write-GuardLog "CircuventGuard Watchdog & Remote Agent Starting (v$($script:AgentVersion))..."
Write-GuardLog "Host: $env:COMPUTERNAME | User: $env:USERNAME | Org: $($script:AgentCfg.TenantOrgId)"
Write-GuardLog "Command poll: every $($script:CommandPollSeconds)s | Full telemetry: every $($script:FullHeartbeatSeconds)s"
Write-GuardLog "Policies: USB BLOCKED | FIREWALL ACTIVE | REMEDIATION ON"
Write-GuardLog "========================================================"

# --------------------------------------------------------------------------------------------------
# SECTION 11: ASYNCHRONOUS WMI DEVICE ARRIVAL LISTENERS (DLP HARDENING)
# --------------------------------------------------------------------------------------------------
# Register WMI events for removable, fixed USB, and USB physical disk insertion.
# DriveType 3 catches many USB SSD enclosures that do not set the removable bit.
# --------------------------------------------------------------------------------------------------
# --------------------------------------------------------------------------------------------------
# SECTION 11: ASYNCHRONOUS WMI HARDWARE & LOGICAL ARRIVAL LISTENERS (DLP HARDENING)
# --------------------------------------------------------------------------------------------------
# 1. Device Arrival Event (Fires immediately upon ANY USB plug-in, even when USBSTOR service is disabled)
$devChangeQuery = "SELECT * FROM Win32_DeviceChangeEvent WHERE EventType = 2"
$devChangeEventId = "CircuventDeviceArrivalEvent"
Unregister-Event -SourceIdentifier $devChangeEventId -ErrorAction SilentlyContinue

Register-WmiEvent -Query $devChangeQuery -SourceIdentifier $devChangeEventId -Action {
    Start-Sleep -Milliseconds 600
    try {
        Test-ConnectedUsbStorage | Out-Null
    } catch {}
}

# 2. Logical Disk Arrival Event (Fires when drive letters / file system volumes attempt to mount)
$wmiQuery = "SELECT * FROM __InstanceCreationEvent WITHIN 2 WHERE TargetInstance ISA 'Win32_LogicalDisk' AND (TargetInstance.DriveType = 2 OR TargetInstance.DriveType = 3 OR TargetInstance.DriveType = 5)"
$eventIdentifier = "CircuventUSBStorageEvent"
Unregister-Event -SourceIdentifier $eventIdentifier -ErrorAction SilentlyContinue

Register-WmiEvent -Query $wmiQuery -SourceIdentifier $eventIdentifier -Action {
    $grantActive = Test-UsbAccessGranted
    $disk = $Event.SourceEventArgs.NewEvent.TargetInstance
    $driveLetter = $disk.DeviceID
    $driveType = $disk.DriveType
    $volumeName = $disk.VolumeName
    $volumeSerial = $disk.VolumeSerialNumber
    $sizeGB = if ($disk.Size) { [Math]::Round(($disk.Size / 1GB), 2) } else { 0 }

    $pnpDevice = Get-CimInstance Win32_DiskDrive -ErrorAction SilentlyContinue | Where-Object { $_.InterfaceType -eq "USB" } | Select-Object -First 1
    $vendor = if ($pnpDevice -and $pnpDevice.Manufacturer) { $pnpDevice.Manufacturer.Trim() } else { "Generic USB Storage" }
    $model = if ($pnpDevice -and $pnpDevice.Model) { $pnpDevice.Model.Trim() } else { "External Storage Device" }
    $pnpId = if ($pnpDevice -and $pnpDevice.PNPDeviceID) { $pnpDevice.PNPDeviceID } else { "UNKNOWN_USB_PNP" }

    if ($grantActive) {
        Write-GuardLog "USB device volume on $driveLetter allowed under active IT grant ($vendor $model)" "INFO"
        return
    }

    $logFile = "$env:ProgramData\Circuvent\Security\CircuventGuard.log"
    $ts = (Get-Date).ToString("yyyy-MM-dd HH:mm:ss")
    Add-Content -Path $logFile -Value "[$ts] [WARN] ALERT: External storage detected on $driveLetter ($volumeName, ${sizeGB}GB, type $driveType)" -Encoding UTF8

    Notify-InteractiveUser -Message "External USB storage ($vendor $model on $driveLetter) is not permitted. The drive has been blocked. Contact IT for a temporary exception."

    Eject-RemovableVolume -DriveLetter $driveLetter

    $meta = @{
        driveLetter  = $driveLetter
        volumeName   = $volumeName
        volumeSerial = $volumeSerial
        sizeGB       = $sizeGB
        driveType    = $driveType
        vendor       = $vendor
        model        = $model
        pnpDeviceID  = $pnpId
        detection    = "Win32_LogicalDisk"
    }

    Invoke-UsbStorageViolation -Vendor $vendor -Model $model -PnpId $pnpId -Metadata $meta -Detection "Win32_LogicalDisk"
}

# --------------------------------------------------------------------------------------------------
# SECTION 12: PHYSICAL DISK HARDWARE ENUMERATION & LOW-LEVEL EJECTION LISTENER
# --------------------------------------------------------------------------------------------------
# USB physical disk arrival handler catches high-speed USB NVMe/SSDs before logical volumes mount.
# --------------------------------------------------------------------------------------------------
$usbDiskQuery = "SELECT * FROM __InstanceCreationEvent WITHIN 2 WHERE TargetInstance ISA 'Win32_DiskDrive' AND TargetInstance.InterfaceType = 'USB'"
$usbDiskEventId = "CircuventUSBDiskEvent"
Unregister-Event -SourceIdentifier $usbDiskEventId -ErrorAction SilentlyContinue

Register-WmiEvent -Query $usbDiskQuery -SourceIdentifier $usbDiskEventId -Action {
    $drive = $Event.SourceEventArgs.NewEvent.TargetInstance
    $vendor = if ($drive.Manufacturer) { $drive.Manufacturer.Trim() } else { "USB Storage" }
    $model = if ($drive.Model) { $drive.Model.Trim() } else { "External Disk" }
    $pnpId = if ($drive.PNPDeviceID) { $drive.PNPDeviceID } else { "UNKNOWN_USB_DISK" }
    $sizeGB = if ($drive.Size) { [Math]::Round(($drive.Size / 1GB), 2) } else { 0 }

    if (Test-UsbAccessGranted) {
        Write-GuardLog "USB disk arrival allowed under active IT grant: $vendor $model" "INFO"
        return
    }

    Write-GuardLog "USB disk hardware arrival blocked: $vendor $model" "WARN"
    Notify-InteractiveUser -Message "External USB storage ($vendor $model) is not permitted. The drive has been blocked. Contact IT for a temporary exception."

    Start-Sleep -Seconds 2
    $logical = Get-CimInstance Win32_LogicalDisk -ErrorAction SilentlyContinue | Where-Object { $_.DriveType -in 2,3,5 }
    foreach ($ld in $logical) {
        if ($ld.DeviceID) {
            Eject-RemovableVolume -DriveLetter $ld.DeviceID
        }
    }

    $meta = @{
        vendor      = $vendor
        model       = $model
        pnpDeviceID = $pnpId
        sizeGB      = $sizeGB
        interface   = "USB"
        detection   = "Win32_DiskDrive"
    }

    Invoke-UsbStorageViolation -Vendor $vendor -Model $model -PnpId $pnpId -Metadata $meta -Detection "Win32_DiskDrive"
}

# --------------------------------------------------------------------------------------------------
# SECTION 13: DAEMON STARTUP CHECK & CONTINUOUS SUPERVISOR LOOP
# --------------------------------------------------------------------------------------------------
# Maintains polling rhythm, re-asserts USB registry locks against tamper, and invokes scans.
# --------------------------------------------------------------------------------------------------
$lastFullHeartbeat = [DateTime]::MinValue
$lastCommandSync = [DateTime]::MinValue

Import-AgentConfig
Sync-UsbStoragePolicy -Reason "startup"
Sync-CloudEgressPolicy -Reason "startup"
Send-Heartbeat -Quick
$lastCommandSync = Get-Date

try {
    Test-ConnectedUsbStorage | Out-Null
}
catch {
    Write-GuardLog "Startup USB scan failed: $_" "WARN"
}

# Continuous supervisor loop executes continuously while the scheduled task is active
while ($true) {
    try {
        Import-AgentConfig
        $now = Get-Date

        # Poll IT remote command queue at high frequency (default 15 seconds)
        if (($now - $lastCommandSync).TotalSeconds -ge $script:CommandPollSeconds) {
            Send-Heartbeat -Quick
            $lastCommandSync = $now
        }

        # Dispatch deep telemetry and patch inventory at longer intervals (default 5 minutes)
        if (($now - $lastFullHeartbeat).TotalSeconds -ge $script:FullHeartbeatSeconds) {
            Send-Heartbeat
            $lastFullHeartbeat = $now
            $lastCommandSync = $now
        }

        # Validate registry tamper protection across the host operating system
        $usbstorStart = (Get-ItemProperty -Path "HKLM:\SYSTEM\CurrentControlSet\Services\USBSTOR" -Name "Start" -ErrorAction SilentlyContinue).Start
        if (Test-UsbAccessGranted) {
            if ($usbstorStart -ne 3) {
                Sync-UsbStoragePolicy -Reason "tamper_loop_grant"
            }
        } elseif ($usbstorStart -ne 4) {
            Write-GuardLog "TAMPER DETECTED: USBSTOR Start key was $usbstorStart. Restoring to 4." "ERROR"
            Sync-UsbStoragePolicy -Reason "tamper_loop_block"
            Send-IncidentTelemetry -IncidentType "security_tamper_attempt" -Severity "critical" -ActionTaken "remediated_registry" -Metadata @{
                tamperedKey = "USBSTOR\Start"
                tamperedValue = $usbstorStart
            }
        }
    }
    catch {
        Write-GuardLog "Main loop error (continuing): $_" "ERROR"
    }

    # Rest briefly before next supervision sweep
    Start-Sleep -Seconds 10

    try {
        Test-ConnectedUsbStorage
    }
    catch {
        Write-GuardLog "USB poll error: $_" "WARN"
    }
}