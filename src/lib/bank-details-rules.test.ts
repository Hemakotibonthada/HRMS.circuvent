// ═══════════════════════════════════════════════════════════════
// BANK & STATUTORY DETAILS — validation, ownership and masking
// ═══════════════════════════════════════════════════════════════
// Until the page and route this module backs existed, `employees.bank_details`
// was a jsonb column nothing wrote to, `lib/form-schemas.ts` defined a "Bank
// Details" section nothing imported, and `isValidIFSC` had been sitting
// unused since it was written. This file is what proves the rules that fill
// that gap actually hold — pure, so it tests without a database, the same
// discipline as employee-rules.test.ts and for the same reason: a rule
// enforced only in the browser is a suggestion, because anything with a
// session can post JSON straight at the route.

import { describe, expect, it } from "vitest";
import {
  ACCOUNT_TYPE_OPTIONS,
  canWriteBankDetails,
  toAuditSnapshot,
  toBankDetailsUpdate,
  toBankDetailsView,
  validateBankDetailsFields,
  type BankDetailsInput,
  type RawEmployeeBankDetails,
} from "./bank-details-rules";

/** A submission with nothing wrong with it, to vary one field at a time. */
function good(overrides: Partial<BankDetailsInput> = {}): BankDetailsInput {
  return {
    bankName: "HDFC Bank",
    accountHolderName: "Meenakshi Racha",
    accountNumber: "12345678901",
    confirmAccountNumber: "12345678901",
    ifsc: "HDFC0001234",
    accountType: "savings",
    panNumber: "ABCDE1234F",
    uanNumber: "100200300400",
    pfNumber: "TN/MAS/12345/678",
    esiNumber: "3112233445",
    ...overrides,
  };
}

const fields = (values: BankDetailsInput) => validateBankDetailsFields(values).map((i) => i.field);
const messages = (values: BankDetailsInput) => validateBankDetailsFields(values).map((i) => i.message);

describe("a valid submission", () => {
  it("passes with every field populated", () => {
    expect(validateBankDetailsFields(good())).toEqual([]);
  });

  it("passes with every optional statutory field blank", () => {
    // PAN, UAN, PF and ESI are collected once, often not on the same day as
    // the bank account — an employee who has not yet been allotted a UAN
    // should still be able to save the bank account they need paid into.
    expect(
      validateBankDetailsFields(good({ panNumber: "", uanNumber: "", pfNumber: "", esiNumber: "" }))
    ).toEqual([]);
  });
});

describe("IFSC", () => {
  it("accepts a well-formed code", () => {
    expect(fields(good())).not.toContain("ifsc");
  });

  it("accepts lowercase, the way a phone keyboard's autocapitalisation might not", () => {
    expect(fields(good({ ifsc: "hdfc0001234" }))).not.toContain("ifsc");
  });

  it("is exactly 11 characters", () => {
    expect(fields(good({ ifsc: "HDFC000123" }))).toContain("ifsc"); // 10
    expect(fields(good({ ifsc: "HDFC00012345" }))).toContain("ifsc"); // 12
  });

  it("requires the 5th character to be the digit zero", () => {
    // The RBI reserves the 5th character for future use and mandates it is
    // always "0" today. A code that is otherwise the right shape but has,
    // say, "1" in that position is not a typo away from valid — it names a
    // branch-coding scheme that does not exist, and should fail exactly the
    // same as a code with letters where digits belong.
    expect(fields(good({ ifsc: "HDFC1001234" }))).toContain("ifsc");
    expect(fields(good({ ifsc: "HDFC9001234" }))).toContain("ifsc");
  });

  it("refuses a code that does not start with four letters", () => {
    expect(fields(good({ ifsc: "12340001234" }))).toContain("ifsc");
  });

  it("is required", () => {
    expect(fields(good({ ifsc: "" }))).toContain("ifsc");
  });

  it("names the exact rule when it refuses one, not just that it failed", () => {
    const [message] = messages(good({ ifsc: "BADIFSC1234" }));
    expect(message).toMatch(/11 characters/);
    expect(message).toMatch(/5th character is always the digit 0/);
  });

  it("is rejected rather than stored: the same gate the route relies on", () => {
    // /api/employees/bank-details's PUT handler runs
    // validateBankDetailsFields first and returns 400 via issuesFailed
    // whenever it finds any issues — toBankDetailsUpdate and
    // NeonEmployeeRepository.updateBankDetails are never reached for this
    // submission. toBankDetailsUpdate itself performs no validation of its
    // own (see its docstring), so this check is the only thing standing
    // between an invalid IFSC and the bank_details column.
    const issues = validateBankDetailsFields(good({ ifsc: "NOTAVALIDIFSC" }));
    expect(issues.length).toBeGreaterThan(0);
    expect(issues.map((i) => i.field)).toContain("ifsc");
  });
});

describe("PAN", () => {
  it("accepts a well-formed PAN", () => {
    expect(fields(good({ panNumber: "ABCDE1234F" }))).not.toContain("panNumber");
  });

  it("accepts lowercase", () => {
    expect(fields(good({ panNumber: "abcde1234f" }))).not.toContain("panNumber");
  });

  it("is 5 letters, 4 digits, then 1 letter — nothing else shaped like it", () => {
    expect(fields(good({ panNumber: "ABCD1234F" }))).toContain("panNumber"); // 4 letters, not 5
    expect(fields(good({ panNumber: "ABCDE123F" }))).toContain("panNumber"); // 3 digits, not 4
    expect(fields(good({ panNumber: "ABCDE12345" }))).toContain("panNumber"); // ends in a digit
    expect(fields(good({ panNumber: "ABCDE1234FF" }))).toContain("panNumber"); // 11 characters
  });

  it("is optional", () => {
    expect(fields(good({ panNumber: "" }))).not.toContain("panNumber");
  });

  it("names the exact rule when it refuses one", () => {
    const [message] = messages(good({ panNumber: "NOTAPAN123" }));
    expect(message).toMatch(/5 letters, 4 digits, 1 letter/);
  });
});

describe("the account number", () => {
  it("must be 9 to 18 digits", () => {
    expect(
      fields(good({ accountNumber: "12345678", confirmAccountNumber: "12345678" }))
    ).toContain("accountNumber"); // 8
    expect(
      fields(good({ accountNumber: "1".repeat(19), confirmAccountNumber: "1".repeat(19) }))
    ).toContain("accountNumber"); // 19
    expect(
      fields(good({ accountNumber: "1".repeat(9), confirmAccountNumber: "1".repeat(9) }))
    ).not.toContain("accountNumber");
    expect(
      fields(good({ accountNumber: "1".repeat(18), confirmAccountNumber: "1".repeat(18) }))
    ).not.toContain("accountNumber");
  });

  it("is required", () => {
    expect(fields(good({ accountNumber: "", confirmAccountNumber: "" }))).toContain(
      "accountNumber"
    );
  });

  it("must match its confirmation", () => {
    // The one rule this whole module exists for: a single mistyped digit
    // here sends somebody's salary to an account that is not theirs, and no
    // bank bounces a transfer just because the account holder's name does
    // not match what HRMS has on file.
    const issues = validateBankDetailsFields(
      good({ accountNumber: "12345678901", confirmAccountNumber: "12345678902" })
    );
    expect(issues.map((i) => i.field)).toContain("confirmAccountNumber");
  });

  it("does not also demand a confirmation for a box that was never filled in", () => {
    // One missing-field error, not two, for the same empty box.
    const issues = validateBankDetailsFields(good({ accountNumber: "", confirmAccountNumber: "" }));
    expect(issues.map((i) => i.field)).not.toContain("confirmAccountNumber");
  });

  it("catches a confirmation left as the old value while the number itself changed", () => {
    const issues = validateBankDetailsFields(
      good({ accountNumber: "99999999999", confirmAccountNumber: "12345678901" })
    );
    expect(issues.map((i) => i.field)).toContain("confirmAccountNumber");
  });
});

describe("account type", () => {
  it("accepts every option the dropdown offers", () => {
    for (const option of ACCOUNT_TYPE_OPTIONS) {
      expect(fields(good({ accountType: option.value })), option.value).not.toContain(
        "accountType"
      );
    }
  });

  it("is case-insensitive", () => {
    expect(fields(good({ accountType: "SAVINGS" }))).not.toContain("accountType");
  });

  it("is required", () => {
    expect(fields(good({ accountType: "" }))).toContain("accountType");
  });

  it("refuses anything else and names the real choices", () => {
    const [message] = messages(good({ accountType: "joint" }));
    expect(message).toMatch(/"joint" is not an account type/);
    expect(message).toMatch(/Savings/);
    expect(message).toMatch(/Current/);
  });
});

describe("UAN, PF and ESI", () => {
  it("requires UAN to be exactly 12 digits, EPFO's fixed format", () => {
    expect(fields(good({ uanNumber: "1234567890" }))).toContain("uanNumber"); // 10
    expect(fields(good({ uanNumber: "1234567890123" }))).toContain("uanNumber"); // 13
    expect(fields(good({ uanNumber: "123456789012" }))).not.toContain("uanNumber"); // 12
  });

  it("does not force a format on PF or ESI numbers, whose formats have changed more than once", () => {
    for (const pf of ["TN/MAS/12345/678", "1234567890123", "PF-NEW-FORMAT-2024"]) {
      expect(fields(good({ pfNumber: pf })), pf).not.toContain("pfNumber");
    }
  });

  it("still refuses an implausibly long value in either", () => {
    expect(fields(good({ pfNumber: "x".repeat(40) }))).toContain("pfNumber");
    expect(fields(good({ esiNumber: "x".repeat(40) }))).toContain("esiNumber");
  });
});

describe("reporting", () => {
  it("returns every problem at once, not just the first", () => {
    const issues = validateBankDetailsFields({
      bankName: "",
      accountHolderName: "",
      accountNumber: "123",
      confirmAccountNumber: "456",
      ifsc: "NOTAREALCODE",
      accountType: "joint",
      panNumber: "notapan",
      uanNumber: "123",
    });
    // bankName, accountHolderName, accountNumber, confirmAccountNumber, ifsc,
    // accountType, panNumber, uanNumber — eight distinct problems in one
    // submission, and a form that reveals one fault per round trip would
    // cost this employee eight of them to fix.
    expect(issues.map((i) => i.field).sort()).toEqual(
      [
        "accountNumber",
        "accountType",
        "bankName",
        "accountHolderName",
        "confirmAccountNumber",
        "ifsc",
        "panNumber",
        "uanNumber",
      ].sort()
    );
  });

  it("says nothing vague", () => {
    for (const message of messages(good({ ifsc: "X", panNumber: "Y", accountType: "z" }))) {
      expect(message).not.toBe("Validation failed");
      expect(message.length).toBeGreaterThan(15);
    }
  });
});

describe("toBankDetailsUpdate", () => {
  it("upper-cases IFSC and PAN so case alone never creates two different-looking values in storage", () => {
    const update = toBankDetailsUpdate(good({ ifsc: "hdfc0001234", panNumber: "abcde1234f" }));
    expect(update.bankDetails.ifsc).toBe("HDFC0001234");
    expect(update.panNumber).toBe("ABCDE1234F");
  });

  it("turns a blank optional field into null, not an empty string", () => {
    // encryptNullable/decryptNullable in lib/crypto/field-encryption.ts
    // already treat "" as absent, so null is the form every downstream
    // reader expects, not a second way of saying the same thing.
    const update = toBankDetailsUpdate(good({ uanNumber: "", pfNumber: "", esiNumber: "" }));
    expect(update.uanNumber).toBeNull();
    expect(update.pfNumber).toBeNull();
    expect(update.esiNumber).toBeNull();
  });

  it("lower-cases the account type to match ACCOUNT_TYPE_OPTIONS' values", () => {
    const update = toBankDetailsUpdate(good({ accountType: "SAVINGS" }));
    expect(update.bankDetails.accountType).toBe("savings");
  });

  it("never carries confirmAccountNumber into what gets persisted", () => {
    const update = toBankDetailsUpdate(good());
    expect(update).not.toHaveProperty("confirmAccountNumber");
    expect(update.bankDetails).not.toHaveProperty("confirmAccountNumber");
  });
});

describe("canWriteBankDetails", () => {
  it("lets an employee write their own", () => {
    expect(canWriteBankDetails("employee-1", "employee-1")).toBe(true);
  });

  it("refuses to let one employee write another's", () => {
    // The one rule this whole feature cannot get wrong: reading a
    // colleague's salary account is a privacy problem, but writing one is
    // how a salary ends up paid into the wrong person's account.
    expect(canWriteBankDetails("employee-1", "employee-2")).toBe(false);
  });

  it("has no privileged exception at all, unlike reading", () => {
    // canViewOthersBankDetails in rbac.ts grants HR/admin/owner read access
    // to someone else's account; this function takes no role and grants
    // nobody but the account holder write access — there is no argument
    // that makes it return true for someone else's employeeId.
    expect(canWriteBankDetails("hr-user-1", "employee-2")).toBe(false);
    expect(canWriteBankDetails("owner-user-1", "employee-2")).toBe(false);
  });
});

describe("toBankDetailsView", () => {
  const raw: RawEmployeeBankDetails = {
    bankDetails: {
      bankName: "HDFC Bank",
      accountHolderName: "Meenakshi Racha",
      accountNumber: "1234567890",
      ifsc: "HDFC0001234",
      accountType: "savings",
    },
    statutoryIds: {
      panNumber: "ABCDE1234F",
      uanNumber: "100200300400",
      pfNumber: "TN/MAS/12345/678",
      esiNumber: "3112233445",
    },
  };

  it("masks the account number to its last four digits", () => {
    const view = toBankDetailsView(raw);
    expect(view.bankDetails?.accountNumber).toBe("••••••7890");
    expect(view.bankDetails?.accountNumber).not.toContain("123456");
  });

  it("leaves everything else — including PAN — in full for the account holder's own read", () => {
    // A signed-in employee reading their own statutory numbers back is not
    // the risk toBankDetailsView exists for; a shoulder-surfed account
    // number that could be retyped into a transfer elsewhere is.
    const view = toBankDetailsView(raw);
    expect(view.bankDetails?.bankName).toBe("HDFC Bank");
    expect(view.bankDetails?.ifsc).toBe("HDFC0001234");
    expect(view.statutoryIds.panNumber).toBe("ABCDE1234F");
    expect(view.statutoryIds.uanNumber).toBe("100200300400");
  });

  it("passes a null bankDetails through rather than throwing", () => {
    // An employee who has never saved bank details at all gets a null, not a
    // crash trying to mask a field that is not there.
    const view = toBankDetailsView({ ...raw, bankDetails: null });
    expect(view.bankDetails).toBeNull();
  });
});

describe("toAuditSnapshot", () => {
  const raw: RawEmployeeBankDetails = {
    bankDetails: {
      bankName: "HDFC Bank",
      accountHolderName: "Meenakshi Racha",
      accountNumber: "1234567890",
      ifsc: "HDFC0001234",
      accountType: "savings",
    },
    statutoryIds: {
      panNumber: "ABCDE1234F",
      uanNumber: "100200300400",
      pfNumber: "TN/MAS/12345/678",
      esiNumber: "3112233445",
    },
  };

  it("masks both the account number and the PAN before either reaches the audit log", () => {
    // identity.audit_log was never built to hold ciphertext and cannot be
    // rotated or re-encrypted the way the encrypted panNumber column can, so
    // an investigator should be able to see "this is the same account, only
    // the IFSC changed" without the log becoming a second place a stolen
    // credential — or a colleague with audit.view — could read either from.
    const snapshot = toAuditSnapshot(raw);
    const bankDetails = snapshot.bankDetails as Record<string, unknown>;
    const statutoryIds = snapshot.statutoryIds as Record<string, unknown>;
    expect(bankDetails.accountNumber).toBe("••••••7890");
    expect(statutoryIds.panNumber).toBe("••••••234F");
  });

  it("leaves UAN, PF and ESI in full, since they are reference numbers rather than secrets", () => {
    const snapshot = toAuditSnapshot(raw);
    const statutoryIds = snapshot.statutoryIds as Record<string, unknown>;
    expect(statutoryIds.uanNumber).toBe("100200300400");
    expect(statutoryIds.pfNumber).toBe("TN/MAS/12345/678");
    expect(statutoryIds.esiNumber).toBe("3112233445");
  });

  it("handles a null bankDetails and a null panNumber without throwing", () => {
    const snapshot = toAuditSnapshot({
      bankDetails: null,
      statutoryIds: { panNumber: null, uanNumber: null, pfNumber: null, esiNumber: null },
    });
    expect(snapshot.bankDetails).toBeNull();
    expect((snapshot.statutoryIds as Record<string, unknown>).panNumber).toBeNull();
  });
});
