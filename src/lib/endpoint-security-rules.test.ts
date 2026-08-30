import { describe, it, expect } from "vitest";
import {
  classifySoftware,
  calculateComplianceScore,
  BLACKLIST_RULES,
} from "./endpoint-security-rules";

describe("Endpoint Security & Compliance Rules", () => {
  describe("classifySoftware", () => {
    it("flags AnyDesk as blacklisted remote access tool with critical risk", () => {
      const result = classifySoftware("AnyDesk");
      expect(result.isBlacklisted).toBe(true);
      expect(result.category).toBe("remote_access");
      expect(result.riskLevel).toBe("critical");
    });

    it("flags TeamViewer as blacklisted remote access tool", () => {
      const result = classifySoftware("TeamViewer 15");
      expect(result.isBlacklisted).toBe(true);
      expect(result.category).toBe("remote_access");
    });

    it("flags uTorrent / BitTorrent as blacklisted P2P sharing", () => {
      const result = classifySoftware("uTorrent Web");
      expect(result.isBlacklisted).toBe(true);
      expect(result.category).toBe("p2p_sharing");
      expect(result.riskLevel).toBe("critical");
    });

    it("flags Wireshark as high-risk security tool", () => {
      const result = classifySoftware("Wireshark 4.0");
      expect(result.isBlacklisted).toBe(true);
      expect(result.category).toBe("security");
      expect(result.riskLevel).toBe("high");
    });

    it("classifies VS Code and Docker as safe development tools", () => {
      const vscode = classifySoftware("Visual Studio Code");
      expect(vscode.isBlacklisted).toBe(false);
      expect(vscode.category).toBe("development");
      expect(vscode.riskLevel).toBe("safe");

      const docker = classifySoftware("Docker Desktop");
      expect(docker.isBlacklisted).toBe(false);
      expect(docker.category).toBe("development");
    });

    it("classifies Slack and Figma as safe productivity software", () => {
      const slack = classifySoftware("Slack");
      expect(slack.isBlacklisted).toBe(false);
      expect(slack.category).toBe("productivity");
      expect(slack.riskLevel).toBe("safe");
    });
  });

  describe("calculateComplianceScore", () => {
    it("awards 100% compliant score for fully encrypted, patched, and guarded endpoint", () => {
      const res = calculateComplianceScore({
        encryptionStatus: "encrypted",
        missingPatchesCount: 0,
        blacklistedSoftwareCount: 0,
        firewallActive: true,
        usbBlocked: true,
      });

      expect(res.complianceScore).toBe(100);
      expect(res.complianceStatus).toBe("compliant");
      expect(res.penalties.unencrypted).toBe(0);
    });

    it("deducts 40 points for unencrypted disk (BitLocker/FileVault/LUKS missing)", () => {
      const res = calculateComplianceScore({
        encryptionStatus: "unencrypted",
        missingPatchesCount: 0,
        blacklistedSoftwareCount: 0,
        firewallActive: true,
        usbBlocked: true,
      });

      expect(res.complianceScore).toBe(60);
      expect(res.complianceStatus).toBe("warning");
      expect(res.penalties.unencrypted).toBe(40);
    });

    it("penalizes pending missing patches up to 30 points", () => {
      const res = calculateComplianceScore({
        encryptionStatus: "encrypted",
        missingPatchesCount: 4, // 4 * 10 = 40 => capped at 30
        blacklistedSoftwareCount: 0,
        firewallActive: true,
        usbBlocked: true,
      });

      expect(res.complianceScore).toBe(70);
      expect(res.penalties.patches).toBe(30);
      expect(res.complianceStatus).toBe("warning");
    });

    it("severely penalizes blacklisted software and drops into critical risk", () => {
      const res = calculateComplianceScore({
        encryptionStatus: "unencrypted", // -40
        missingPatchesCount: 2, // -20
        blacklistedSoftwareCount: 2, // -50
        firewallActive: false, // -15
        usbBlocked: false, // -15
      });

      // Total deductions: 40 + 20 + 50 + 15 + 15 = 140 => floored at 0
      expect(res.complianceScore).toBe(0);
      expect(res.complianceStatus).toBe("critical_risk");
    });
  });
});
