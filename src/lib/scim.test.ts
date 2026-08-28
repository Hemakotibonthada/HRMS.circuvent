// @vitest-environment node
//
// SCIM is a spec other people's software talks to us in, and Okta, Entra and
// Google all send slightly different shapes while claiming conformance. These
// tests pin the variants that occur in practice — especially the four ways a
// deprovisioning arrives, because a silently ignored one leaves a departed
// employee with a live account.

import { describe, expect, it } from "vitest";
import {
  ENTERPRISE_SCHEMA,
  ScimError,
  USER_SCHEMA,
  applyPatch,
  errorResponse,
  listResponse,
  matchesFilter,
  parseFilter,
  primaryEmail,
  splitName,
  toBoolean,
  toProvisionedUser,
  toScimUser,
  type ProvisionedUser,
  type ScimUser,
} from "@/lib/scim";

function user(over: Partial<ScimUser> = {}): ScimUser {
  return {
    schemas: [USER_SCHEMA],
    userName: "asha@example.com",
    name: { givenName: "Asha", familyName: "Rao" },
    emails: [{ value: "asha@example.com", type: "work", primary: true }],
    ...over,
  };
}

function provisioned(over: Partial<ProvisionedUser> = {}): ProvisionedUser {
  return {
    userName: "asha@example.com",
    email: "asha@example.com",
    firstName: "Asha",
    lastName: "Rao",
    isActive: true,
    ...over,
  };
}

describe("primaryEmail", () => {
  it("prefers the primary address", () => {
    expect(
      primaryEmail([
        { value: "personal@gmail.com" },
        { value: "work@example.com", primary: true },
      ])
    ).toBe("work@example.com");
  });

  it("falls back to the work address when nothing is marked primary", () => {
    // Entra often sends no `primary` at all; picking the first would create a
    // duplicate account under a personal address.
    expect(
      primaryEmail([
        { value: "personal@gmail.com", type: "home" },
        { value: "work@example.com", type: "work" },
      ])
    ).toBe("work@example.com");
  });

  it("falls back to the first address as a last resort", () => {
    expect(primaryEmail([{ value: "only@example.com" }])).toBe("only@example.com");
  });

  it("lowercases and trims", () => {
    expect(primaryEmail([{ value: " Asha@Example.COM " }])).toBe("asha@example.com");
  });

  it("returns nothing for an empty list", () => {
    expect(primaryEmail([])).toBeUndefined();
    expect(primaryEmail(undefined)).toBeUndefined();
  });
});

describe("splitName", () => {
  it("splits on the first space", () => {
    expect(splitName("Asha Rao")).toEqual({ firstName: "Asha", lastName: "Rao" });
  });

  it("keeps a multi-part surname together", () => {
    // Guessing harder gets multi-part surnames wrong more often than it gets
    // compound given names right.
    expect(splitName("Maria van der Berg")).toEqual({
      firstName: "Maria",
      lastName: "van der Berg",
    });
  });

  it("handles a single name", () => {
    expect(splitName("Prince")).toEqual({ firstName: "Prince", lastName: "" });
  });

  it("handles an empty string", () => {
    expect(splitName("   ")).toEqual({ firstName: "", lastName: "" });
  });
});

describe("toProvisionedUser", () => {
  it("maps a well-formed user", () => {
    expect(toProvisionedUser(user())).toMatchObject({
      userName: "asha@example.com",
      email: "asha@example.com",
      firstName: "Asha",
      lastName: "Rao",
      isActive: true,
    });
  });

  it("treats a missing active flag as active", () => {
    // Several providers omit the field on create and only send it when
    // deactivating; defaulting to inactive would provision every joiner
    // disabled.
    expect(toProvisionedUser(user()).isActive).toBe(true);
  });

  it("honours an explicit inactive flag", () => {
    expect(toProvisionedUser(user({ active: false })).isActive).toBe(false);
  });

  it("derives a name from formatted when no parts are sent", () => {
    const derived = toProvisionedUser(
      user({ name: { formatted: "Asha Rao" } })
    );
    expect(derived).toMatchObject({ firstName: "Asha", lastName: "Rao" });
  });

  it("derives a name from displayName as a last resort", () => {
    const derived = toProvisionedUser(user({ name: undefined, displayName: "Asha Rao" }));
    expect(derived.firstName).toBe("Asha");
  });

  it("refuses a directory entry with no usable name", () => {
    // It would create an employee record nobody can find.
    expect(() => toProvisionedUser(user({ name: undefined, displayName: undefined }))).toThrow(
      ScimError
    );
  });

  it("refuses a user with no userName", () => {
    expect(() => toProvisionedUser(user({ userName: "" }))).toThrow(/userName is required/);
  });

  it("falls back to userName when no emails are sent", () => {
    const derived = toProvisionedUser(user({ emails: undefined }));
    expect(derived.email).toBe("asha@example.com");
  });

  it("refuses when neither emails nor userName is an address", () => {
    expect(() => toProvisionedUser(user({ emails: undefined, userName: "asha" }))).toThrow(
      /work email/
    );
  });

  it("reads the enterprise extension", () => {
    const derived = toProvisionedUser(
      user({
        [ENTERPRISE_SCHEMA]: {
          department: "Engineering",
          employeeNumber: "CIR-0001",
          manager: { value: "mgr-1" },
        },
      })
    );

    expect(derived).toMatchObject({
      department: "Engineering",
      employeeNumber: "CIR-0001",
      managerExternalId: "mgr-1",
    });
  });
});

describe("toScimUser", () => {
  it("renders a core user", () => {
    const resource = toScimUser({ ...provisioned(), id: "u1" }, "https://x.test/scim/v2");

    expect(resource.schemas).toEqual([USER_SCHEMA]);
    expect(resource.emails).toEqual([
      { value: "asha@example.com", type: "work", primary: true },
    ]);
    expect(resource.meta?.location).toBe("https://x.test/scim/v2/Users/u1");
  });

  it("declares the enterprise schema only when something populates it", () => {
    // An empty extension object trips strict validators.
    const plain = toScimUser({ ...provisioned(), id: "u1" }, "https://x.test");
    expect(plain[ENTERPRISE_SCHEMA]).toBeUndefined();

    const extended = toScimUser(
      { ...provisioned({ department: "Engineering" }), id: "u1" },
      "https://x.test"
    );
    expect(extended.schemas).toContain(ENTERPRISE_SCHEMA);
    expect(extended[ENTERPRISE_SCHEMA]?.department).toBe("Engineering");
  });

  it("builds a formatted name", () => {
    const resource = toScimUser({ ...provisioned(), id: "u1" }, "https://x.test");
    expect(resource.name?.formatted).toBe("Asha Rao");
  });
});

describe("applyPatch — deactivation", () => {
  // The operation that matters most. Providers express it at least four ways,
  // and a silently ignored one leaves a departed employee with a live account.

  it("handles a boolean false with a path", () => {
    const result = applyPatch(provisioned(), {
      schemas: [],
      Operations: [{ op: "replace", path: "active", value: false }],
    });
    expect(result.isActive).toBe(false);
  });

  it("handles the string 'False', which Boolean() would read as true", () => {
    const result = applyPatch(provisioned(), {
      schemas: [],
      Operations: [{ op: "replace", path: "active", value: "False" }],
    });
    expect(result.isActive).toBe(false);
  });

  it("handles a pathless operation carrying an object", () => {
    const result = applyPatch(provisioned(), {
      schemas: [],
      Operations: [{ op: "replace", value: { active: false } }],
    });
    expect(result.isActive).toBe(false);
  });

  it("handles a capitalised op, which the spec permits", () => {
    const result = applyPatch(provisioned(), {
      schemas: [],
      Operations: [{ op: "Replace", path: "active", value: false }],
    });
    expect(result.isActive).toBe(false);
  });

  it("treats removing active as deactivation", () => {
    const result = applyPatch(provisioned(), {
      schemas: [],
      Operations: [{ op: "remove", path: "active" }],
    });
    expect(result.isActive).toBe(false);
  });

  it("reactivates on true", () => {
    const result = applyPatch(provisioned({ isActive: false }), {
      schemas: [],
      Operations: [{ op: "replace", path: "active", value: true }],
    });
    expect(result.isActive).toBe(true);
  });
});

describe("applyPatch — other attributes", () => {
  it("updates a name part", () => {
    const result = applyPatch(provisioned(), {
      schemas: [],
      Operations: [{ op: "replace", path: "name.givenName", value: "Asha Devi" }],
    });
    expect(result.firstName).toBe("Asha Devi");
  });

  it("updates an email from an array value", () => {
    const result = applyPatch(provisioned(), {
      schemas: [],
      Operations: [
        { op: "replace", path: "emails", value: [{ value: "new@example.com", primary: true }] },
      ],
    });
    expect(result.email).toBe("new@example.com");
  });

  it("updates an email from a filtered path", () => {
    const result = applyPatch(provisioned(), {
      schemas: [],
      Operations: [
        { op: "replace", path: 'emails[type eq "work"].value', value: "New@Example.com" },
      ],
    });
    expect(result.email).toBe("new@example.com");
  });

  it("strips the enterprise URN prefix from a path", () => {
    const result = applyPatch(provisioned(), {
      schemas: [],
      Operations: [
        { op: "replace", path: `${ENTERPRISE_SCHEMA}:department`, value: "Finance" },
      ],
    });
    expect(result.department).toBe("Finance");
  });

  it("reads a manager sent as an object", () => {
    const result = applyPatch(provisioned(), {
      schemas: [],
      Operations: [{ op: "replace", path: "manager", value: { value: "mgr-9" } }],
    });
    expect(result.managerExternalId).toBe("mgr-9");
  });

  it("clears an optional attribute on remove", () => {
    const result = applyPatch(provisioned({ title: "Engineer" }), {
      schemas: [],
      Operations: [{ op: "remove", path: "title" }],
    });
    expect(result.title).toBeUndefined();
  });

  it("applies several operations in order", () => {
    const result = applyPatch(provisioned(), {
      schemas: [],
      Operations: [
        { op: "replace", path: "title", value: "Engineer" },
        { op: "replace", path: "active", value: false },
      ],
    });
    expect(result).toMatchObject({ title: "Engineer", isActive: false });
  });

  it("does not mutate the input", () => {
    const original = provisioned();
    applyPatch(original, {
      schemas: [],
      Operations: [{ op: "replace", path: "active", value: false }],
    });
    expect(original.isActive).toBe(true);
  });
});

describe("applyPatch — refusals", () => {
  it("throws on an unmapped attribute rather than pretending to succeed", () => {
    // An unmapped path means the directory believes a change was applied that
    // was not. Silence here is how a deprovisioning gets lost.
    expect(() =>
      applyPatch(provisioned(), {
        schemas: [],
        Operations: [{ op: "replace", path: "nickname", value: "Ash" }],
      })
    ).toThrow(/not supported/);
  });

  it("throws on an unknown operation", () => {
    expect(() =>
      applyPatch(provisioned(), {
        schemas: [],
        Operations: [{ op: "merge" as never, path: "active", value: false }],
      })
    ).toThrow(/Unsupported operation/);
  });

  it("throws on an empty operations list", () => {
    expect(() => applyPatch(provisioned(), { schemas: [], Operations: [] })).toThrow(
      /at least one operation/
    );
  });

  it("throws on a pathless operation with a scalar value", () => {
    expect(() =>
      applyPatch(provisioned(), { schemas: [], Operations: [{ op: "replace", value: "x" }] })
    ).toThrow(/needs an object value/);
  });

  it("refuses to blank a required attribute", () => {
    expect(() =>
      applyPatch(provisioned(), {
        schemas: [],
        Operations: [{ op: "replace", path: "userName", value: "" }],
      })
    ).toThrow(/cannot be empty/);
  });
});

describe("toBoolean", () => {
  it("accepts real booleans", () => {
    expect(toBoolean(true)).toBe(true);
    expect(toBoolean(false)).toBe(false);
  });

  it("accepts string forms in any case", () => {
    expect(toBoolean("True")).toBe(true);
    expect(toBoolean("FALSE")).toBe(false);
  });

  it("refuses anything else rather than guessing", () => {
    expect(() => toBoolean("yes")).toThrow(ScimError);
    expect(() => toBoolean(1)).toThrow(ScimError);
    expect(() => toBoolean(null)).toThrow(ScimError);
  });
});

describe("parseFilter", () => {
  it("returns null for no filter", () => {
    expect(parseFilter(null)).toBeNull();
    expect(parseFilter("  ")).toBeNull();
  });

  it("parses an equality filter", () => {
    expect(parseFilter('userName eq "asha@example.com"')).toEqual({
      attribute: "userName",
      operator: "eq",
      value: "asha@example.com",
    });
  });

  it("parses the other supported operators", () => {
    expect(parseFilter('displayName co "Rao"')?.operator).toBe("co");
    expect(parseFilter('userName sw "a"')?.operator).toBe("sw");
    expect(parseFilter('userName ew "com"')?.operator).toBe("ew");
  });

  it("parses a presence filter", () => {
    expect(parseFilter("externalId pr")).toEqual({ attribute: "externalId", operator: "pr" });
  });

  it("parses a URN-prefixed attribute", () => {
    expect(parseFilter(`${ENTERPRISE_SCHEMA}:department eq "Engineering"`)?.value).toBe(
      "Engineering"
    );
  });

  it("refuses a compound filter with 501 rather than half-implementing it", () => {
    // Half a filter parser returns confidently wrong results, which is worse
    // than an honest refusal.
    let thrown: unknown;
    try {
      parseFilter('userName eq "a" and active eq true');
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(ScimError);
    expect((thrown as ScimError).status).toBe(501);
  });
});

describe("matchesFilter", () => {
  const subject = provisioned({ displayName: "Asha Rao", externalId: "ext-1" });

  it("matches everything when there is no filter", () => {
    expect(matchesFilter(subject, null)).toBe(true);
  });

  it("compares case-insensitively, as the spec requires", () => {
    expect(
      matchesFilter(subject, { attribute: "userName", operator: "eq", value: "ASHA@EXAMPLE.COM" })
    ).toBe(true);
  });

  it("supports contains, starts-with and ends-with", () => {
    expect(matchesFilter(subject, { attribute: "displayName", operator: "co", value: "sha" })).toBe(
      true
    );
    expect(matchesFilter(subject, { attribute: "userName", operator: "sw", value: "asha" })).toBe(
      true
    );
    expect(matchesFilter(subject, { attribute: "userName", operator: "ew", value: ".com" })).toBe(
      true
    );
  });

  it("supports presence", () => {
    expect(matchesFilter(subject, { attribute: "externalId", operator: "pr" })).toBe(true);
    expect(
      matchesFilter(provisioned(), { attribute: "externalId", operator: "pr" })
    ).toBe(false);
  });

  it("matches on the email attribute path providers actually send", () => {
    expect(
      matchesFilter(subject, {
        attribute: "emails.value",
        operator: "eq",
        value: "asha@example.com",
      })
    ).toBe(true);
  });

  it("does not match an unknown attribute", () => {
    expect(matchesFilter(subject, { attribute: "nickname", operator: "eq", value: "x" })).toBe(
      false
    );
  });
});

describe("listResponse", () => {
  it("uses 1-based paging, since 0 makes clients page forever", () => {
    const response = listResponse([{ id: "1" }], 0, 10, 1);
    expect(response.startIndex).toBe(1);
  });

  it("reports the page size and the total separately", () => {
    const response = listResponse([{ id: "1" }, { id: "2" }], 1, 10, 57);
    expect(response.itemsPerPage).toBe(2);
    expect(response.totalResults).toBe(57);
  });

  it("handles an empty page", () => {
    const response = listResponse([], 1, 10, 0);
    expect(response.Resources).toEqual([]);
    expect(response.totalResults).toBe(0);
  });
});

describe("errorResponse", () => {
  it("emits the status as a string, as the spec requires", () => {
    const body = errorResponse(new ScimError("Nope", 409, "uniqueness"));
    expect(body.status).toBe("409");
    expect(body.scimType).toBe("uniqueness");
  });

  it("omits scimType when there is none", () => {
    expect(errorResponse(new ScimError("Nope", 500))).not.toHaveProperty("scimType");
  });
});
