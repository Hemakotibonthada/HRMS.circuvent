// ═══════════════════════════════════════════════════════════════
// SCIM 2.0 RULES — user and group provisioning
// ═══════════════════════════════════════════════════════════════
// Pure mapping and patch logic, so it tests without a database or an identity
// provider. RFC 7643 (schema) and RFC 7644 (protocol).
//
// SCIM is a specification other people's software talks to us in, which makes
// it different from an API we design. Okta, Entra ID and Google all send
// slightly different shapes, all claiming conformance. The mapping layer is
// therefore deliberately forgiving on input and strict on output: accept the
// variants that occur in practice, emit exactly what the spec says.
//
// The failure that matters most: a deprovisioning event that is silently
// ignored leaves a departed employee with a live account. Every unmapped
// operation is therefore an error, never a no-op.

export interface ScimName {
  givenName?: string;
  familyName?: string;
  formatted?: string;
}

export interface ScimEmail {
  value: string;
  type?: string;
  primary?: boolean;
}

export interface ScimUser {
  schemas: string[];
  id?: string;
  externalId?: string;
  userName: string;
  name?: ScimName;
  displayName?: string;
  emails?: ScimEmail[];
  active?: boolean;
  title?: string;
  /** Enterprise extension: department, manager, employee number. */
  "urn:ietf:params:scim:schemas:extension:enterprise:2.0:User"?: {
    employeeNumber?: string;
    department?: string;
    manager?: { value?: string; displayName?: string };
    costCenter?: string;
  };
  meta?: { resourceType: string; created?: string; lastModified?: string; location?: string };
}

export const USER_SCHEMA = "urn:ietf:params:scim:schemas:core:2.0:User";
export const ENTERPRISE_SCHEMA =
  "urn:ietf:params:scim:schemas:extension:enterprise:2.0:User";
export const GROUP_SCHEMA = "urn:ietf:params:scim:schemas:core:2.0:Group";
export const PATCH_SCHEMA = "urn:ietf:params:scim:api:messages:2.0:PatchOp";
export const LIST_SCHEMA = "urn:ietf:params:scim:api:messages:2.0:ListResponse";
export const ERROR_SCHEMA = "urn:ietf:params:scim:api:messages:2.0:Error";

/** The internal shape a SCIM user maps onto. */
export interface ProvisionedUser {
  externalId?: string;
  userName: string;
  email: string;
  firstName: string;
  lastName: string;
  displayName?: string;
  title?: string;
  department?: string;
  employeeNumber?: string;
  managerExternalId?: string;
  isActive: boolean;
}

export class ScimError extends Error {
  constructor(
    message: string,
    readonly status: number,
    /** RFC 7644 §3.12 detail type, where one applies. */
    readonly scimType?: string
  ) {
    super(message);
    this.name = "ScimError";
  }
}

/**
 * Picks the address to use from a SCIM emails array.
 *
 * Primary first, then work, then whatever came first. Providers disagree about
 * which of these they set — Entra often sends no `primary` at all — and
 * picking the wrong one creates a duplicate account under a personal address.
 */
export function primaryEmail(emails: ScimEmail[] | undefined): string | undefined {
  if (!emails || emails.length === 0) return undefined;

  const chosen =
    emails.find((e) => e.primary) ??
    emails.find((e) => e.type?.toLowerCase() === "work") ??
    emails[0];

  return chosen.value?.trim().toLowerCase() || undefined;
}

/**
 * Splits a formatted name when the provider sent no given/family parts.
 *
 * Not clever on purpose: the first token is the given name and the rest is the
 * family name. Guessing harder gets multi-part surnames wrong more often than
 * it gets compound given names right.
 */
export function splitName(formatted: string): { firstName: string; lastName: string } {
  const parts = formatted.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { firstName: "", lastName: "" };
  if (parts.length === 1) return { firstName: parts[0], lastName: "" };
  return { firstName: parts[0], lastName: parts.slice(1).join(" ") };
}

/** Maps an inbound SCIM user onto the internal shape. */
export function toProvisionedUser(user: ScimUser): ProvisionedUser {
  if (!user.userName?.trim()) {
    throw new ScimError("userName is required", 400, "invalidValue");
  }

  const email = primaryEmail(user.emails) ?? user.userName.trim().toLowerCase();
  if (!email.includes("@")) {
    throw new ScimError("A work email address is required", 400, "invalidValue");
  }

  let firstName = user.name?.givenName?.trim() ?? "";
  let lastName = user.name?.familyName?.trim() ?? "";

  if (!firstName && !lastName) {
    const source = user.name?.formatted ?? user.displayName ?? "";
    ({ firstName, lastName } = splitName(source));
  }

  if (!firstName) {
    // A directory entry with no usable name at all would create an employee
    // record nobody can find. Better to refuse the sync than to store "".
    throw new ScimError("A given name or display name is required", 400, "invalidValue");
  }

  const enterprise = user[ENTERPRISE_SCHEMA];

  return {
    externalId: user.externalId,
    userName: user.userName.trim(),
    email,
    firstName,
    lastName,
    displayName: user.displayName,
    title: user.title,
    department: enterprise?.department,
    employeeNumber: enterprise?.employeeNumber,
    managerExternalId: enterprise?.manager?.value,
    // Absent means active. Several providers omit the field on create and only
    // send it when deactivating; defaulting to inactive would provision every
    // new joiner disabled.
    isActive: user.active ?? true,
  };
}

/** Renders an internal user as a SCIM resource. */
export function toScimUser(
  user: ProvisionedUser & { id: string; createdAt?: string; updatedAt?: string },
  baseUrl: string
): ScimUser {
  const resource: ScimUser = {
    schemas: [USER_SCHEMA],
    id: user.id,
    externalId: user.externalId,
    userName: user.userName,
    name: {
      givenName: user.firstName,
      familyName: user.lastName,
      formatted: [user.firstName, user.lastName].filter(Boolean).join(" "),
    },
    displayName: user.displayName ?? [user.firstName, user.lastName].filter(Boolean).join(" "),
    emails: [{ value: user.email, type: "work", primary: true }],
    active: user.isActive,
    title: user.title,
    meta: {
      resourceType: "User",
      created: user.createdAt,
      lastModified: user.updatedAt,
      location: `${baseUrl}/Users/${user.id}`,
    },
  };

  // The enterprise extension is only declared when something populates it;
  // an empty extension object trips strict validators.
  if (user.department || user.employeeNumber || user.managerExternalId) {
    resource.schemas = [USER_SCHEMA, ENTERPRISE_SCHEMA];
    resource[ENTERPRISE_SCHEMA] = {
      department: user.department,
      employeeNumber: user.employeeNumber,
      manager: user.managerExternalId ? { value: user.managerExternalId } : undefined,
    };
  }

  return resource;
}

// ─── PATCH ───────────────────────────────────────────────────

export interface ScimPatchOperation {
  op: "add" | "remove" | "replace" | "Add" | "Remove" | "Replace";
  path?: string;
  value?: unknown;
}

export interface ScimPatch {
  schemas: string[];
  Operations: ScimPatchOperation[];
}

/**
 * Applies a SCIM PATCH to a provisioned user.
 *
 * Deactivation is the operation that matters. Providers express it at least
 * four different ways:
 *
 *   { op: "replace", path: "active", value: false }
 *   { op: "replace", path: "active", value: "False" }
 *   { op: "replace", value: { active: false } }
 *   { op: "Replace", path: "active", value: false }
 *
 * All four are accepted. An unrecognised operation throws rather than being
 * skipped: a silently ignored deprovisioning leaves a departed employee with a
 * live account, which is the single worst thing this code can do.
 */
export function applyPatch(
  current: ProvisionedUser,
  patch: ScimPatch
): ProvisionedUser {
  if (!Array.isArray(patch.Operations) || patch.Operations.length === 0) {
    throw new ScimError("A PATCH must contain at least one operation", 400, "invalidValue");
  }

  let next = { ...current };

  for (const raw of patch.Operations) {
    const op = String(raw.op ?? "").toLowerCase();
    if (!["add", "remove", "replace"].includes(op)) {
      throw new ScimError(`Unsupported operation "${raw.op}"`, 400, "invalidSyntax");
    }

    // A pathless op carries an object of attributes to merge.
    if (!raw.path) {
      if (typeof raw.value !== "object" || raw.value === null) {
        throw new ScimError("A PATCH without a path needs an object value", 400, "invalidValue");
      }
      for (const [key, value] of Object.entries(raw.value as Record<string, unknown>)) {
        next = applyAttribute(next, key, value, op);
      }
      continue;
    }

    next = applyAttribute(next, raw.path, raw.value, op);
  }

  return next;
}

function applyAttribute(
  user: ProvisionedUser,
  path: string,
  value: unknown,
  op: string
): ProvisionedUser {
  // Providers send "active", "userName", and enterprise paths with the full
  // URN prefix. Normalising the prefix away keeps one branch per attribute.
  const attribute = path
    .replace(`${ENTERPRISE_SCHEMA}:`, "")
    .replace(`${USER_SCHEMA}:`, "")
    .trim();

  const removing = op === "remove";

  switch (attribute.toLowerCase()) {
    case "active":
      return { ...user, isActive: removing ? false : toBoolean(value) };

    case "username":
      return { ...user, userName: requireString(value, "userName") };

    case "displayname":
      return { ...user, displayName: removing ? undefined : asString(value) };

    case "title":
      return { ...user, title: removing ? undefined : asString(value) };

    case "externalid":
      return { ...user, externalId: removing ? undefined : asString(value) };

    case "name.givenname":
      return { ...user, firstName: requireString(value, "name.givenName") };

    case "name.familyname":
      return { ...user, lastName: removing ? "" : asString(value) ?? "" };

    case "department":
      return { ...user, department: removing ? undefined : asString(value) };

    case "employeenumber":
      return { ...user, employeeNumber: removing ? undefined : asString(value) };

    case "manager":
    case "manager.value":
      return {
        ...user,
        managerExternalId: removing ? undefined : asString(readManager(value)),
      };

    case "emails":
    case 'emails[type eq "work"]':
    case 'emails[primary eq true]': {
      const email = readEmail(value);
      if (!email) throw new ScimError("No usable email in the patch", 400, "invalidValue");
      return { ...user, email };
    }

    case "emails[type eq \"work\"].value":
      return { ...user, email: requireString(value, "email").toLowerCase() };

    default:
      // Not silently ignored. An unmapped path is a mapping we have not
      // written yet, and pretending it succeeded means the directory believes
      // a change was applied that was not.
      throw new ScimError(
        `Attribute "${path}" is not supported`,
        400,
        "invalidPath"
      );
  }
}

function readManager(value: unknown): unknown {
  if (value && typeof value === "object" && "value" in value) {
    return (value as { value: unknown }).value;
  }
  if (Array.isArray(value) && value.length > 0) return readManager(value[0]);
  return value;
}

function readEmail(value: unknown): string | undefined {
  if (typeof value === "string") return value.trim().toLowerCase();
  if (Array.isArray(value)) return primaryEmail(value as ScimEmail[]);
  if (value && typeof value === "object" && "value" in value) {
    return String((value as { value: unknown }).value).trim().toLowerCase();
  }
  return undefined;
}

/**
 * Coerces a SCIM boolean.
 *
 * The string "False" is sent by more than one provider, and JavaScript's
 * Boolean("False") is true — which would reactivate the account it was meant
 * to disable.
 */
export function toBoolean(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const text = value.trim().toLowerCase();
    if (text === "true") return true;
    if (text === "false") return false;
  }
  throw new ScimError(`Expected a boolean, got ${JSON.stringify(value)}`, 400, "invalidValue");
}

function asString(value: unknown): string | undefined {
  if (value === null || value === undefined) return undefined;
  const text = String(value).trim();
  return text === "" ? undefined : text;
}

function requireString(value: unknown, field: string): string {
  const text = asString(value);
  if (!text) throw new ScimError(`${field} cannot be empty`, 400, "invalidValue");
  return text;
}

// ─── Filtering ───────────────────────────────────────────────

export interface ScimFilter {
  attribute: string;
  operator: "eq" | "co" | "sw" | "ew" | "pr";
  value?: string;
}

/**
 * Parses the narrow slice of SCIM filter syntax provisioning actually uses.
 *
 * Full filter grammar is a language of its own with parentheses and boolean
 * operators. Every provisioning client in practice sends one of
 * `userName eq "x"`, `externalId eq "x"` or `emails.value eq "x"`, so this
 * accepts those and refuses the rest with a 501 rather than half-implementing
 * a parser and quietly returning wrong results.
 */
export function parseFilter(filter: string | null | undefined): ScimFilter | null {
  if (!filter?.trim()) return null;

  const match = filter
    .trim()
    .match(/^([a-zA-Z0-9_.:]+)\s+(eq|co|sw|ew)\s+"(.*)"$/i);

  if (match) {
    return {
      attribute: match[1],
      operator: match[2].toLowerCase() as ScimFilter["operator"],
      value: match[3],
    };
  }

  const present = filter.trim().match(/^([a-zA-Z0-9_.:]+)\s+pr$/i);
  if (present) return { attribute: present[1], operator: "pr" };

  throw new ScimError(
    `Filter "${filter}" is not supported`,
    501,
    "invalidFilter"
  );
}

/** Whether a user matches a parsed filter. */
export function matchesFilter(user: ProvisionedUser, filter: ScimFilter | null): boolean {
  if (!filter) return true;

  const field = filter.attribute.toLowerCase().replace(`${ENTERPRISE_SCHEMA}:`, "");
  const actual = readField(user, field);

  if (filter.operator === "pr") return actual !== undefined && actual !== "";
  if (actual === undefined) return false;

  // SCIM string comparison is case-insensitive by default (RFC 7644 §3.4.2.2).
  const a = actual.toLowerCase();
  const b = (filter.value ?? "").toLowerCase();

  switch (filter.operator) {
    case "eq":
      return a === b;
    case "co":
      return a.includes(b);
    case "sw":
      return a.startsWith(b);
    case "ew":
      return a.endsWith(b);
  }
}

function readField(user: ProvisionedUser, field: string): string | undefined {
  switch (field) {
    case "username":
      return user.userName;
    case "externalid":
      return user.externalId;
    case "emails.value":
    case "emails":
      return user.email;
    case "displayname":
      return user.displayName;
    case "name.givenname":
      return user.firstName;
    case "name.familyname":
      return user.lastName;
    case "department":
      return user.department;
    case "active":
      return String(user.isActive);
    default:
      return undefined;
  }
}

// ─── Responses ───────────────────────────────────────────────

export function listResponse<T>(
  resources: T[],
  startIndex: number,
  count: number,
  totalResults: number
) {
  return {
    schemas: [LIST_SCHEMA],
    totalResults,
    // 1-based, per the spec. Emitting 0 makes clients page forever.
    startIndex: Math.max(1, startIndex),
    itemsPerPage: resources.length,
    Resources: resources,
  };
}

export function errorResponse(error: ScimError) {
  return {
    schemas: [ERROR_SCHEMA],
    detail: error.message,
    status: String(error.status),
    ...(error.scimType ? { scimType: error.scimType } : {}),
  };
}
