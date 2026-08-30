# Circuvent Endpoint Security & Device Management — Linux

This toolkit configures Ubuntu/Debian/RHEL/CentOS/Fedora workstations with Circuvent security baselines:

1. **Kernel udev USB Storage Blocking**: Automatically de-authorizes USB Mass Storage (Interface Class 08) upon connection.
2. **LUKS Full Disk Encryption Audit**: Inspects block devices for dm-crypt / LUKS encryption partitions.
3. **Software & Package Audit**: Scans dpkg/rpm packages for blacklisted tools.
4. **Remote Remediation**: Supports session lock (`lock_device`), process kill, cache wipe, and on-demand rescan via HRMS.
5. **Systemd Service**: Runs continuously in background via `circuvent-guard.service`.

### Quick Installation:
```bash
sudo bash Install-CircuventPolicy.sh --server https://hrms.circuvent.com --email employee@circuvent.com --code CV-001
```
