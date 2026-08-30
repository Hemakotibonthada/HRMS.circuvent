# Circuvent Endpoint Security & DLP for Windows Laptops

Enterprise-grade device security, USB removable storage blocking, and Data Loss Prevention (DLP) for company-issued Windows laptops.

---

## Capabilities & Enforcements

1. **Hardware-Level Storage Lockdown**:
   - Disables `USBSTOR` driver startup.
   - Enforces `RemovableStorageDevices\Deny_All = 1` across all removable disks, external SSDs/HDDs, SD cards, and CD/DVD drives.
   - Blocks MTP/PTP Smartphone transfer protocols (`WpdBusEnum`) to prevent data exfiltration onto phones via USB charging cables.
   - Human Interface Devices (keyboards, mice, headsets, webcams) remain fully functional.

2. **Windows Advanced Firewall & SMTP Protection**:
   - Outbound mail traffic on ports 25, 465, and 587 is locked down to **`mx.circuvent.com`** only.
   - Prevents background exfiltration scripts or unapproved mail clients from pushing company data to personal mail relays.

3. **Automatic HRMS Asset Management Registration**:
   - Automatically gathers hardware telemetry: BIOS Serial Number, Manufacturer (Dell/Lenovo/HP/Apple), Model, CPU, RAM (GB), Storage (GB), and Hostname.
   - Creates or updates the laptop record in **HRMS Asset Management** (`/assets`) under "Laptops & Notebooks".
   - Automatically links and assigns the asset directly to the specified Employee profile (`assignedToId`, `state = assigned`).
   - Generates an official asset tag (e.g. `CIR-AST-<SERIAL>`) and records an audit event in `asset_events`.

4. **Real-Time Watchdog (`CircuventGuard`)**:
   - Runs as a persistent background service under `NT AUTHORITY\SYSTEM`.
   - Subscribes to WMI `Win32_LogicalDisk` and `Win32_VolumeChangeEvent` to detect any external storage arrival within 2 seconds.
   - Instantly forces dismount (`mountvol /D` + Shell Eject) and displays an alert toast to the employee.
   - Dispatches incident telemetry to `https://hrms.circuvent.com/api/security/incidents`.
   - Fires automated high-priority email alerts to the Employee and Reporting Manager / IT Security lead.

---

## Deployment Methods

### Method 1: Standalone / IT Provisioning Key (PowerShell Administrator)
Run the automated installer on the laptop:

```powershell
Set-ExecutionPolicy Bypass -Scope Process -Force
.\Install-CircuventPolicy.ps1 -ServerUrl "https://hrms.circuvent.com" -EmployeeEmail "employee@circuvent.com" -EmployeeCode "CV-001"
```

### Method 2: Microsoft Intune / Endpoint Manager
1. In Microsoft Intune Admin Center, navigate to **Devices** > **Scripts** > **Add** > **Windows 10 and later**.
2. Upload `Install-CircuventPolicy.ps1`.
3. Configure Settings:
   - Run this script using the logged-on credentials: **No** (Runs under `SYSTEM`).
   - Enforce script signature check: **No**.
   - Run script in 64-bit PowerShell: **Yes**.
4. Assign to the **"Circuvent Corporate Laptops"** device group.

### Method 3: Active Directory Group Policy (GPO)
1. Copy `policies/usb-storage-block.reg` to the domain SYSVOL share.
2. In Group Policy Management, configure:
   - `Computer Configuration` > `Policies` > `Administrative Templates` > `System` > `Removable Storage Access` > **All Removable Storage classes: Deny all access = Enabled**.
   - `Computer Configuration` > `Policies` > `Windows Settings` > `Scripts (Startup/Shutdown)` > Add `Install-CircuventPolicy.ps1`.
