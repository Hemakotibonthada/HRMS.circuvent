# Circuvent Endpoint Security & Device Management — macOS

This toolkit configures company MacBooks and Mac workstations with Circuvent security baselines:

1. **FileVault 2 Disk Encryption**: Audits FileVault state and reports non-compliant unencrypted devices to HRMS SOC.
2. **Software & Application Audit**: Scans `/Applications` and `~/Applications` for blacklisted tools (torrents, unauthorized remote access).
3. **USB Mass Storage Block**: Intercepts external storage mounts and automatically unmounts them.
4. **Remote Remediation**: Supports instant screen lock (`lock_device`), process termination (`kill_process`), cache wipes, and on-demand scans directly from the HRMS Security Console.
5. **Continuous LaunchDaemon**: Keeps the agent running across reboots via `/Library/LaunchDaemons/com.circuvent.guard.plist`.

### Quick Installation:
```bash
sudo bash Install-CircuventPolicy.sh --server https://hrms.circuvent.com --email employee@circuvent.com --code CV-001
```
