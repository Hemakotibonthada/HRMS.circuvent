// The salary file, and the reasons banks reject them.

import { describe, expect, it } from "vitest";
import {
  BANK_FORMATS,
  InvalidAdviceError,
  bankCodeOf,
  generateAdviceFile,
  isValidAccountNumber,
  isValidIfsc,
  modeFor,
  prepare,
  summarise,
  type AdviceRequest,
  type Beneficiary,
} from "@/lib/bank-advice";

function beneficiary(overrides: Partial<Beneficiary> = {}): Beneficiary {
  return {
    employeeId: "e1",
    employeeCode: "CV-001",
    name: "Priya Sharma",
    accountNumber: "50100123456789",
    ifsc: "HDFC0001234",
    amountMinor: 85_000_00n,
    ...overrides,
  };
}

function request(overrides: Partial<AdviceRequest> = {}): AdviceRequest {
  const beneficiaries = overrides.beneficiaries ?? [beneficiary()];
  return {
    debitAccountNumber: "00600310001234",
    debitIfsc: "HDFC0000060",
    valueDate: "2026-08-31",
    beneficiaries,
    expectedTotalMinor: beneficiaries.reduce((a, b) => a + b.amountMinor, 0n),
    ...overrides,
  };
}

describe("IFSC", () => {
  it("accepts a well-formed code", () => {
    expect(isValidIfsc("HDFC0001234")).toBe(true);
    expect(isValidIfsc("SBIN0000456")).toBe(true);
  });

  it("rejects a code without the reserved zero in the fifth position", () => {
    // The position that actually matters, and the one a length check misses.
    expect(isValidIfsc("HDFC1001234")).toBe(false);
  });

  it("rejects the wrong length", () => {
    expect(isValidIfsc("HDFC000123")).toBe(false);
    expect(isValidIfsc("HDFC00012345")).toBe(false);
  });

  it("rejects digits in the bank code", () => {
    expect(isValidIfsc("HD1C0001234")).toBe(false);
  });

  it("tolerates case and surrounding space", () => {
    expect(isValidIfsc(" hdfc0001234 ")).toBe(true);
  });

  it("reads the bank from the first four characters", () => {
    expect(bankCodeOf("hdfc0001234")).toBe("HDFC");
  });
});

describe("account numbers", () => {
  it("accepts the range Indian banks actually use", () => {
    expect(isValidAccountNumber("123456789")).toBe(true);
    expect(isValidAccountNumber("123456789012345678")).toBe(true);
  });

  it("rejects anything too short or too long to be real", () => {
    expect(isValidAccountNumber("12345678")).toBe(false);
    expect(isValidAccountNumber("1234567890123456789")).toBe(false);
  });

  it("rejects letters", () => {
    expect(isValidAccountNumber("5010012345678A")).toBe(false);
  });
});

describe("choosing the rail", () => {
  it("uses an internal transfer within the same bank", () => {
    expect(modeFor(50_000_00n, true)).toBe("INTERNAL");
    expect(modeFor(5_00_000_00n, true)).toBe("INTERNAL");
  });

  it("uses RTGS at and above its floor", () => {
    expect(modeFor(2_00_000_00n, false)).toBe("RTGS");
    expect(modeFor(9_00_000_00n, false)).toBe("RTGS");
  });

  it("uses NEFT below the RTGS floor, because RTGS would bounce", () => {
    expect(modeFor(1_99_999_00n, false)).toBe("NEFT");
    expect(modeFor(15_000_00n, false)).toBe("NEFT");
  });

  it("marks a same-bank row as such", () => {
    const result = prepare(request({ beneficiaries: [beneficiary({ ifsc: "HDFC0009999" })] }));
    expect(result.rows[0].sameBank).toBe(true);
    expect(result.rows[0].mode).toBe("INTERNAL");
  });

  it("treats a different bank as external", () => {
    const result = prepare(request({ beneficiaries: [beneficiary({ ifsc: "ICIC0001234" })] }));
    expect(result.rows[0].sameBank).toBe(false);
    expect(result.rows[0].mode).toBe("NEFT");
  });
});

describe("validation", () => {
  it("passes a clean batch", () => {
    const result = prepare(request());
    expect(result.valid).toBe(true);
    expect(result.problems).toEqual([]);
  });

  it("names the employee whose IFSC is wrong", () => {
    const result = prepare(
      request({ beneficiaries: [beneficiary({ employeeCode: "CV-007", ifsc: "HDFC1001234" })] })
    );
    expect(result.valid).toBe(false);
    expect(result.problems[0].employeeCode).toBe("CV-007");
    expect(result.problems[0].field).toBe("ifsc");
  });

  it("reports every bad row at once, not the first", () => {
    const result = prepare(
      request({
        beneficiaries: [
          beneficiary({ employeeCode: "CV-001", ifsc: "BAD" }),
          beneficiary({ employeeCode: "CV-002", accountNumber: "abc" }),
          beneficiary({ employeeCode: "CV-003", name: "  " }),
        ],
      })
    );
    expect(result.problems.length).toBeGreaterThanOrEqual(3);
  });

  it("refuses a nil payment rather than sending an empty transfer", () => {
    const result = prepare(request({ beneficiaries: [beneficiary({ amountMinor: 0n })] }));
    expect(result.problems.some((p) => p.field === "amount")).toBe(true);
  });

  it("flags two employees sharing one account", () => {
    const result = prepare(
      request({
        beneficiaries: [
          beneficiary({ employeeCode: "CV-001" }),
          beneficiary({ employeeCode: "CV-002" }),
        ],
      })
    );
    expect(result.problems.some((p) => /also used by CV-001/.test(p.message))).toBe(true);
  });

  it("checks the company's own IFSC too", () => {
    const result = prepare(request({ debitIfsc: "NOTANIFSC" }));
    expect(result.problems.some((p) => p.field === "debitIfsc")).toBe(true);
  });
});

describe("reconciling against the register", () => {
  it("agrees when the rows add up", () => {
    const result = prepare(request());
    expect(result.reconciles).toBe(true);
  });

  it("refuses a file that does not match what payroll approved", () => {
    const result = prepare(request({ expectedTotalMinor: 99_00_000_00n }));
    expect(result.reconciles).toBe(false);
    expect(result.valid).toBe(false);
    expect(result.problems.some((p) => p.field === "total")).toBe(true);
  });

  it("states both figures and the difference", () => {
    const result = prepare(request({ expectedTotalMinor: 80_000_00n }));
    const problem = result.problems.find((p) => p.field === "total")!;
    expect(problem.message).toContain("85000");
    expect(problem.message).toContain("80000");
    expect(problem.message).toContain("5000");
  });
});

describe("the file itself", () => {
  it("writes a header and one row per beneficiary", () => {
    const csv = generateAdviceFile(request(), "generic");
    const lines = csv.trim().split("\r\n");
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain("Account Number");
    expect(lines[1]).toContain("50100123456789");
  });

  it("refuses to write a file with a bad row", () => {
    expect(() =>
      generateAdviceFile(request({ beneficiaries: [beneficiary({ ifsc: "BAD" })] }), "generic")
    ).toThrow(InvalidAdviceError);
  });

  it("carries the problems on the error, so the caller can show them", () => {
    try {
      generateAdviceFile(request({ beneficiaries: [beneficiary({ ifsc: "BAD" })] }), "generic");
      expect.unreachable("should have refused");
    } catch (error) {
      expect(error).toBeInstanceOf(InvalidAdviceError);
      expect((error as InvalidAdviceError).problems.length).toBeGreaterThan(0);
    }
  });

  it("writes amounts in rupees and paise, not in minor units", () => {
    const csv = generateAdviceFile(request(), "generic");
    expect(csv).toContain("85000.00");
    expect(csv).not.toContain("8500000");
  });

  it("quotes a name containing a comma so the row does not split", () => {
    const csv = generateAdviceFile(
      request({ beneficiaries: [beneficiary({ name: "Sharma, Priya" })] }),
      "generic"
    );
    expect(csv).toContain('"Sharma, Priya"');
    expect(csv.trim().split("\r\n")).toHaveLength(2);
  });

  it("escapes a quotation mark rather than breaking the field", () => {
    const csv = generateAdviceFile(
      request({ beneficiaries: [beneficiary({ name: 'Priya "PS" Sharma' })] }),
      "generic"
    );
    expect(csv).toContain('"Priya ""PS"" Sharma"');
  });

  it("numbers the rows for a format that asks for a sequence", () => {
    const csv = generateAdviceFile(
      request({
        beneficiaries: [
          beneficiary({ employeeCode: "CV-001", accountNumber: "50100123456781" }),
          beneficiary({ employeeCode: "CV-002", accountNumber: "50100123456782" }),
        ],
      }),
      "sbi"
    );
    const lines = csv.trim().split("\r\n");
    expect(lines[1].startsWith("1,")).toBe(true);
    expect(lines[2].startsWith("2,")).toBe(true);
  });

  it("rejects a format nobody has defined", () => {
    expect(() => generateAdviceFile(request(), "nonesuch")).toThrow(/Unknown bank format/);
  });

  it("offers a layout for each bank it claims to support", () => {
    for (const [code, format] of Object.entries(BANK_FORMATS)) {
      expect(format.code).toBe(code);
      expect(format.headers.length).toBeGreaterThan(3);
    }
  });
});

describe("what is about to leave the account", () => {
  it("counts and totals the batch", () => {
    const result = prepare(
      request({
        beneficiaries: [
          beneficiary({ employeeCode: "CV-001", accountNumber: "50100123456781" }),
          beneficiary({ employeeCode: "CV-002", accountNumber: "50100123456782", amountMinor: 3_00_000_00n }),
        ],
      })
    );
    const summary = summarise(result.rows);
    expect(summary.count).toBe(2);
    expect(summary.totalMinor).toBe(3_85_000_00n);
  });

  it("groups by the rail each row will travel on", () => {
    const result = prepare(
      request({
        beneficiaries: [
          beneficiary({ employeeCode: "CV-001", accountNumber: "50100123456781", ifsc: "ICIC0001234" }),
          beneficiary({
            employeeCode: "CV-002",
            accountNumber: "50100123456782",
            ifsc: "ICIC0001234",
            amountMinor: 3_00_000_00n,
          }),
        ],
      })
    );
    const summary = summarise(result.rows);
    const modes = summary.byMode.map((m) => m.mode).sort();
    expect(modes).toEqual(["NEFT", "RTGS"]);
  });
});
