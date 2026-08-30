/**
 * Install artefact URLs for Circuvent endpoint security agents.
 * Installers are served from devices.circuvent.com; HRMS mints enroll tokens.
 */

export function devicesPortalUrl(): string {
  const fromEnv =
    process.env.NEXT_PUBLIC_DEVICES_URL?.trim() ||
    process.env.DEVICES_URL?.trim();
  if (fromEnv) return fromEnv.replace(/\/+$/, "");
  return "https://devices.circuvent.com";
}

export interface DeviceInstallLinks {
  devicesPortal: string;
  windowsLauncherUrl: string;
  windowsInstallerUrl: string;
  windowsBootstrapUrl: string;
  windowsPowerShell: string;
  macOsCommand: string;
  linuxCommand: string;
}

export function deviceInstallLinks(token: string): DeviceInstallLinks {
  const base = devicesPortalUrl();
  const encoded = encodeURIComponent(token);

  return {
    devicesPortal: base,
    windowsLauncherUrl: `${base}/api/install/windows/launcher?token=${encoded}`,
    windowsInstallerUrl: `${base}/api/install/windows?token=${encoded}`,
    windowsBootstrapUrl: `${base}/api/install/windows/bootstrap?token=${encoded}`,
    windowsPowerShell: [
      `$p = "$env:TEMP\\CircuventBootstrap.ps1"`,
      `Invoke-WebRequest -Uri '${base}/api/install/windows/bootstrap?token=${token}' -OutFile $p -UseBasicParsing`,
      `Unblock-File $p -ErrorAction SilentlyContinue`,
      `powershell.exe -NoProfile -ExecutionPolicy Bypass -File $p`,
    ].join("\n"),
    macOsCommand: `curl -fsSL '${base}/security/macos/Install-CircuventPolicy.sh' | sudo bash -s -- --server '${base}' --token '${token}'`,
    linuxCommand: `curl -fsSL '${base}/security/linux/Install-CircuventPolicy.sh' | sudo bash -s -- --server '${base}' --token '${token}'`,
  };
}
