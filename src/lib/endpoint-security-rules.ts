// ═══════════════════════════════════════════════════════════════
// ENDPOINT SECURITY & COMPLIANCE ENGINE RULES
// ═══════════════════════════════════════════════════════════════

export interface SoftwareClassification {
  category: "development" | "productivity" | "remote_access" | "p2p_sharing" | "security" | "utility" | "communication";
  riskLevel: "safe" | "low" | "medium" | "high" | "critical";
  isBlacklisted: boolean;
}

export const BLACKLIST_RULES: Array<{
  pattern: RegExp;
  category: SoftwareClassification["category"];
  riskLevel: SoftwareClassification["riskLevel"];
  reason: string;
}> = [
  { pattern: /anydesk/i, category: "remote_access", riskLevel: "critical", reason: "Unauthorized Remote Control Tool" },
  { pattern: /teamviewer/i, category: "remote_access", riskLevel: "critical", reason: "Unauthorized Remote Desktop Software" },
  { pattern: /rustdesk/i, category: "remote_access", riskLevel: "critical", reason: "Unauthorized Open Source Remote Desktop" },
  { pattern: /logmein/i, category: "remote_access", riskLevel: "critical", reason: "Unauthorized Remote Control" },
  { pattern: /ammyy/i, category: "remote_access", riskLevel: "critical", reason: "Known Malicious Remote Admin Tool" },
  { pattern: /bittorrent|utorrent|qbittorrent|transmission|deluge|vuze/i, category: "p2p_sharing", riskLevel: "critical", reason: "P2P File Sharing Protocol" },
  { pattern: /wireshark/i, category: "security", riskLevel: "high", reason: "Network Packet Sniffing Utility" },
  { pattern: /nmap|zenmap/i, category: "security", riskLevel: "high", reason: "Network Port Scanner" },
  { pattern: /cheat\s*engine/i, category: "utility", riskLevel: "critical", reason: "Memory Modification / Tampering Tool" },
  { pattern: /hydra|metasploit|burp\s*suite|aircrack/i, category: "security", riskLevel: "critical", reason: "Penetration Testing / Exploitation Tool" },
];

export function classifySoftware(name: string, publisher?: string | null): SoftwareClassification {
  const normName = name.trim().toLowerCase();

  // Check blacklisted patterns
  for (const rule of BLACKLIST_RULES) {
    if (rule.pattern.test(normName)) {
      return {
        category: rule.category,
        riskLevel: rule.riskLevel,
        isBlacklisted: true,
      };
    }
  }

  // Developer tools
  if (/vscode|visual studio|pycharm|intellij|webstorm|git|docker|node|python|golang|rust|postman|tableplus|dbeaver/i.test(normName)) {
    return { category: "development", riskLevel: "safe", isBlacklisted: false };
  }

  // Communication & Productivity
  if (/slack|teams|zoom|discord|notion|figma|office|excel|word|outlook|chrome|firefox|safari|edge/i.test(normName)) {
    return { category: "productivity", riskLevel: "safe", isBlacklisted: false };
  }

  // Security
  if (/antivirus|crowdstrike|sentinelone|defender|bitdefender|circuvent/i.test(normName)) {
    return { category: "security", riskLevel: "safe", isBlacklisted: false };
  }

  return { category: "utility", riskLevel: "low", isBlacklisted: false };
}

export interface ComplianceCalculationInput {
  encryptionStatus?: "encrypted" | "unencrypted" | "encrypting" | "unknown" | string;
  missingPatchesCount?: number;
  blacklistedSoftwareCount?: number;
  firewallActive?: boolean;
  usbBlocked?: boolean;
}

export interface ComplianceCalculationResult {
  complianceScore: number;
  complianceStatus: "compliant" | "warning" | "critical_risk";
  penalties: {
    unencrypted: number;
    patches: number;
    blacklisted: number;
    firewall: number;
    usb: number;
  };
}

export function calculateComplianceScore(input: ComplianceCalculationInput): ComplianceCalculationResult {
  let score = 100;
  const penalties = {
    unencrypted: 0,
    patches: 0,
    blacklisted: 0,
    firewall: 0,
    usb: 0,
  };

  // 1. Disk Encryption (BitLocker/FileVault/LUKS)
  if (input.encryptionStatus === "unencrypted") {
    penalties.unencrypted = 40;
    score -= 40;
  } else if (input.encryptionStatus === "unknown") {
    penalties.unencrypted = 15;
    score -= 15;
  }

  // 2. Pending Missing Security Patches
  const patchCount = input.missingPatchesCount || 0;
  if (patchCount > 0) {
    const patchPenalty = Math.min(patchCount * 10, 30);
    penalties.patches = patchPenalty;
    score -= patchPenalty;
  }

  // 3. Blacklisted Software Flags
  const blCount = input.blacklistedSoftwareCount || 0;
  if (blCount > 0) {
    const blPenalty = Math.min(blCount * 25, 50);
    penalties.blacklisted = blPenalty;
    score -= blPenalty;
  }

  // 4. Firewall state
  if (input.firewallActive === false) {
    penalties.firewall = 15;
    score -= 15;
  }

  // 5. USB Lockdown state
  if (input.usbBlocked === false) {
    penalties.usb = 15;
    score -= 15;
  }

  const finalScore = Math.max(0, Math.min(100, score));
  let status: "compliant" | "warning" | "critical_risk" = "compliant";

  if (finalScore < 60) {
    status = "critical_risk";
  } else if (finalScore < 85) {
    status = "warning";
  }

  return {
    complianceScore: finalScore,
    complianceStatus: status,
    penalties,
  };
}
