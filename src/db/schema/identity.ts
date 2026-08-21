// ═══════════════════════════════════════════════════════════════
// IDENTITY SCHEMA — shared across every Circuvent app
// ═══════════════════════════════════════════════════════════════
// Replaces Firebase Auth plus the three-way user fan-out in
// src/lib/cross-app-sync.ts. Previously creating an employee wrote the same
// person into three separate Firestore databases (hrms-circuvent, cv-365 and
// the default Mail database) and relied on those copies never drifting apart.
//
// Here every app reads one row. HRMS, CV-365, ATS, Mail, Office and the
// website all resolve a user from `identity.users`, and per-app authorization
// comes from `identity.user_roles`.

import {
  boolean,
  index,
  inet,
  integer,
  jsonb,
  pgSchema,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const identity = pgSchema("identity");

// ─── Enums ───────────────────────────────────────────────────

/** Apps in the Circuvent ecosystem — mirrors ECOSYSTEM in src/lib/ecosystem.ts. */
export const appEnum = identity.enum("app", [
  "hrms",
  "cv365",
  "ats",
  "mail",
  "office",
  "website",
]);

/** Roles mirror the Role union in src/lib/rbac.ts. */
export const roleEnum = identity.enum("role", [
  "owner",
  "admin",
  "hr",
  "manager",
  "employee",
  "viewer",
]);

export const userStatusEnum = identity.enum("user_status", [
  "active",
  "invited",
  "suspended",
  "deactivated",
]);

export const subscriptionPlanEnum = identity.enum("subscription_plan", [
  "starter",
  "professional",
  "enterprise",
]);

export const subscriptionStatusEnum = identity.enum("subscription_status", [
  "active",
  "trial",
  "past_due",
  "cancelled",
  "expired",
]);

// ─── Organizations (tenants) ─────────────────────────────────

export const organizations = identity.table(
  "organizations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    logoUrl: text("logo_url"),
    industry: text("industry"),
    size: text("size"),
    website: text("website"),
    address: text("address"),
    city: text("city"),
    country: text("country").default("India"),
    timezone: text("timezone").notNull().default("Asia/Kolkata"),
    currency: text("currency").notNull().default("INR"),
    locale: text("locale").notNull().default("en-IN"),
    fiscalYearStartMonth: integer("fiscal_year_start_month").notNull().default(4),
    ownerId: uuid("owner_id"),
    plan: subscriptionPlanEnum("plan").notNull().default("starter"),
    /** Per-tenant feature flags, keyed by flag name. */
    features: jsonb("features").notNull().default(sql`'{}'::jsonb`),
    settings: jsonb("settings").notNull().default(sql`'{}'::jsonb`),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [uniqueIndex("organizations_slug_key").on(t.slug)]
);

// ─── Users ───────────────────────────────────────────────────

export const users = identity.table(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    emailVerifiedAt: timestamp("email_verified_at", { withTimezone: true }),
    /** Argon2id. Null for SSO-only users, who must authenticate via their IdP. */
    passwordHash: text("password_hash"),
    /**
     * Firebase Auth password hashes cannot be re-verified outside Firebase, so
     * imported users carry their old UID and are forced through a reset on
     * first sign-in. See docs/PLATFORM-ARCHITECTURE.md §3.
     */
    legacyFirebaseUid: text("legacy_firebase_uid"),
    mustResetPassword: boolean("must_reset_password").notNull().default(false),
    displayName: text("display_name").notNull(),
    avatarUrl: text("avatar_url"),
    phone: text("phone"),
    status: userStatusEnum("status").notNull().default("active"),
    /**
     * The identity provider's stable identifier for this user.
     *
     * Set by SCIM provisioning. Kept separate from the email because a
     * directory can change someone's address, and matching on email would
     * then create a second account rather than updating the first.
     */
    externalId: text("external_id"),
    /**
     * TOTP secret, encrypted at rest with `lib/crypto/field-encryption`.
     * Null until MFA is enrolled.
     */
    mfaSecret: text("mfa_secret"),
    /**
     * When enrolment was confirmed. Null while a secret exists but has never
     * been proved with a live code — sign-in does not enforce MFA in that
     * state, or abandoning enrolment would lock the account out.
     */
    mfaEnabledAt: timestamp("mfa_enabled_at", { withTimezone: true }),
    /** Argon2id hashes of single-use MFA recovery codes. */
    mfaBackupCodes: jsonb("mfa_backup_codes").notNull().default(sql`'[]'::jsonb`),
    failedLoginAttempts: integer("failed_login_attempts").notNull().default(0),
    lockedUntil: timestamp("locked_until", { withTimezone: true }),
    lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
    locale: text("locale"),
    timezone: text("timezone"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [
    // Email is the cross-app join key, so it must be globally unique rather
    // than unique per organization.
    uniqueIndex("users_email_key").on(t.email),
    uniqueIndex("users_legacy_firebase_uid_key").on(t.legacyFirebaseUid),
    index("users_org_id_idx").on(t.orgId),
    index("users_org_status_idx").on(t.orgId, t.status),
  ]
);

// ─── Per-app roles ───────────────────────────────────────────

/**
 * A user holds one role per app, so an HR admin in HRMS can still be an
 * ordinary member in CV-365.
 */
export const userRoles = identity.table(
  "user_roles",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    app: appEnum("app").notNull(),
    role: roleEnum("role").notNull(),
    /** Extra grants beyond the role, using Permission strings from rbac.ts. */
    extraPermissions: jsonb("extra_permissions").notNull().default(sql`'[]'::jsonb`),
    grantedBy: uuid("granted_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("user_roles_user_app_key").on(t.userId, t.app),
    index("user_roles_org_app_idx").on(t.orgId, t.app),
  ]
);

// ─── Sessions ────────────────────────────────────────────────

/**
 * Access tokens are short-lived JWTs verified at the edge without a database
 * round-trip. Only the long-lived refresh token is stored here — hashed, so a
 * database leak cannot be replayed — and it rotates on every use.
 */
export const sessions = identity.table(
  "sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    refreshTokenHash: text("refresh_token_hash").notNull(),
    /** Set when this session is superseded, to detect token replay. */
    rotatedToId: uuid("rotated_to_id"),
    app: appEnum("app"),
    ipAddress: inet("ip_address"),
    userAgent: text("user_agent"),
    deviceName: text("device_name"),
    /** Expo push token, so mobile sign-out also detaches notifications. */
    pushToken: text("push_token"),
    mfaVerifiedAt: timestamp("mfa_verified_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("sessions_refresh_token_hash_key").on(t.refreshTokenHash),
    index("sessions_user_idx").on(t.userId),
    index("sessions_expires_at_idx").on(t.expiresAt),
  ]
);

// ─── Short-lived tokens (verification, reset, invite) ────────

export const tokenPurposeEnum = identity.enum("token_purpose", [
  "email_verification",
  "password_reset",
  "invitation",
  "magic_link",
]);

export const authTokens = identity.table(
  "auth_tokens",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }),
    orgId: uuid("org_id").references(() => organizations.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    purpose: tokenPurposeEnum("purpose").notNull(),
    tokenHash: text("token_hash").notNull(),
    metadata: jsonb("metadata").notNull().default(sql`'{}'::jsonb`),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("auth_tokens_token_hash_key").on(t.tokenHash),
    index("auth_tokens_email_purpose_idx").on(t.email, t.purpose),
  ]
);

// ─── Enterprise SSO ──────────────────────────────────────────
//
// The connection, identity-link, auth-state, SCIM token and SCIM log tables
// live in ./federation.ts, in this same `identity` schema.
//
// They were originally sketched here as two placeholder tables that nothing
// read. Those are gone rather than left alongside the real ones: two homes for
// one concept is how a field ends up written to one and read from the other,
// which is exactly the defect the referral module shipped with.

// ─── API keys for the public API ─────────────────────────────

export const apiKeys = identity.table(
  "api_keys",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    /** Non-secret leading segment, shown in the UI so keys are identifiable. */
    keyPrefix: text("key_prefix").notNull(),
    keyHash: text("key_hash").notNull(),
    scopes: jsonb("scopes").notNull().default(sql`'[]'::jsonb`),
    rateLimitPerMinute: integer("rate_limit_per_minute").notNull().default(600),
    createdBy: uuid("created_by"),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("api_keys_key_hash_key").on(t.keyHash),
    index("api_keys_org_idx").on(t.orgId),
  ]
);

// ─── Subscriptions / billing ─────────────────────────────────

export const subscriptions = identity.table(
  "subscriptions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    plan: subscriptionPlanEnum("plan").notNull().default("starter"),
    status: subscriptionStatusEnum("status").notNull().default("trial"),
    maxEmployees: integer("max_employees").notNull().default(25),
    currentEmployees: integer("current_employees").notNull().default(0),
    pricePerEmployee: integer("price_per_employee").notNull().default(0),
    currency: text("currency").notNull().default("INR"),
    billingCycle: text("billing_cycle").notNull().default("monthly"),
    trialEndsAt: timestamp("trial_ends_at", { withTimezone: true }),
    currentPeriodStart: timestamp("current_period_start", { withTimezone: true }),
    currentPeriodEnd: timestamp("current_period_end", { withTimezone: true }),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    externalCustomerId: text("external_customer_id"),
    externalSubscriptionId: text("external_subscription_id"),
    /**
     * Recurring billing, when the tenant chose it over the one-off flow.
     *
     * Deliberately not `externalSubscriptionId`, which despite its name holds
     * the last payment id and is the webhook's idempotency key — see
     * migration 0046.
     */
    razorpaySubscriptionId: text("razorpay_subscription_id"),
    razorpayPlanId: text("razorpay_plan_id"),
    /** Seats Razorpay is currently billing for, so a change can be detected. */
    billedQuantity: integer("billed_quantity"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("subscriptions_org_key").on(t.orgId)]
);

// ─── Audit log ───────────────────────────────────────────────

/**
 * Append-only and hash-chained: each row commits to the previous row's hash, so
 * deleting or editing history breaks the chain and is detectable. Writes are
 * enforced insert-only by a trigger in the migration.
 */
export const auditLog = identity.table(
  "audit_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    actorId: uuid("actor_id"),
    actorEmail: text("actor_email"),
    app: appEnum("app").notNull(),
    action: text("action").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id"),
    before: jsonb("before"),
    after: jsonb("after"),
    ipAddress: inet("ip_address"),
    userAgent: text("user_agent"),
    requestId: text("request_id"),
    previousHash: text("previous_hash"),
    hash: text("hash").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("audit_log_org_created_idx").on(t.orgId, t.createdAt),
    index("audit_log_entity_idx").on(t.entityType, t.entityId),
    index("audit_log_actor_idx").on(t.actorId),
  ]
);

// ─── Inferred types ──────────────────────────────────────────

export type Organization = typeof organizations.$inferSelect;
export type NewOrganization = typeof organizations.$inferInsert;
export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type UserRoleRow = typeof userRoles.$inferSelect;
export type Session = typeof sessions.$inferSelect;
export type AuditLogEntry = typeof auditLog.$inferSelect;
export type ApiKey = typeof apiKeys.$inferSelect;
export type Subscription = typeof subscriptions.$inferSelect;


/**
 * Passkeys.
 *
 * One row per credential, not per user: a person legitimately registers a
 * passkey on their phone, their laptop and a hardware key, and losing one
 * must not lock them out of the others.
 *
 * `publicKey` is not a secret — the whole design is that the private half
 * never leaves the authenticator, so a leaked table yields nothing that can
 * sign anything. `signCount` is the only mutable field and exists solely for
 * cloning detection.
 */
export const webauthnCredentials = identity.table(
  "webauthn_credentials",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    /** Base64url credential id, as the authenticator issued it. */
    credentialId: text("credential_id").notNull(),
    /** Base64url COSE public key. */
    publicKey: text("public_key").notNull(),
    /** Cloning detection only. Synced authenticators legitimately hold at 0. */
    signCount: integer("sign_count").notNull().default(0),
    transports: jsonb("transports").notNull().default(sql`'[]'::jsonb`),
    /** What the user calls this key, so they can revoke the right one. */
    label: text("label"),
    backedUp: boolean("backed_up").notNull().default(false),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // A credential id must resolve to exactly one account, globally: sign-in
    // presents an id with no email, so a duplicate would be ambiguous.
    uniqueIndex("webauthn_credentials_credential_id_key").on(t.credentialId),
    index("webauthn_credentials_user_idx").on(t.userId),
  ]
);
