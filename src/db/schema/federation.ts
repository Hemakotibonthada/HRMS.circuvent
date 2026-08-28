// ═══════════════════════════════════════════════════════════════
// FEDERATION SCHEMA — SSO connections and SCIM provisioning
// ═══════════════════════════════════════════════════════════════

import {
  boolean,
  index,
  integer,
  jsonb,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { identity, organizations, users } from "./identity";

export const ssoProtocolEnum = identity.enum("sso_protocol", ["oidc", "saml"]);

export const ssoConnections = identity.table(
  "sso_connections",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),

    name: text("name").notNull(),
    protocol: ssoProtocolEnum("protocol").notNull().default("oidc"),
    /** Email domains routed to this provider. */
    domains: jsonb("domains").$type<string[]>().notNull().default(sql`'[]'::jsonb`),

    issuer: text("issuer").notNull(),
    clientId: text("client_id").notNull(),
    /** Encrypted at rest by the application before it is written. */
    clientSecret: text("client_secret").notNull(),
    authorizationEndpoint: text("authorization_endpoint").notNull(),
    tokenEndpoint: text("token_endpoint").notNull(),
    jwksUri: text("jwks_uri").notNull(),
    scopes: jsonb("scopes").$type<string[]>().notNull().default(sql`'[]'::jsonb`),

    claimMapping: jsonb("claim_mapping")
      .$type<Record<string, string>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    /** Provider group → internal role. */
    groupRoleMap: jsonb("group_role_map")
      .$type<Record<string, string>>()
      .notNull()
      .default(sql`'{}'::jsonb`),

    /** Creates an account on first successful sign-in. */
    allowJitProvisioning: boolean("allow_jit_provisioning").notNull().default(false),
    defaultRole: text("default_role").notNull().default("employee"),
    /**
     * Blocks password sign-in for these domains.
     *
     * The point of enforcing SSO is that the identity provider is the single
     * place an account is disabled. A password login left open beside it means
     * a departed employee still has a way in after the directory has cut them
     * off.
     */
    enforceForDomains: boolean("enforce_for_domains").notNull().default(false),

    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("sso_connections_org_active_idx").on(t.orgId, t.isActive)]
);

/**
 * In-flight sign-in attempts.
 *
 * Server-side rather than in a cookie: the PKCE verifier and the nonce must
 * not be readable by anything that can read the browser's storage, and a
 * cookie large enough to hold them is one more thing to get the flags right
 * on. Rows are short-lived and swept by expiry.
 */
export const ssoAuthStates = identity.table(
  "sso_auth_states",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    connectionId: uuid("connection_id")
      .notNull()
      .references(() => ssoConnections.id, { onDelete: "cascade" }),

    state: text("state").notNull(),
    nonce: text("nonce").notNull(),
    codeVerifier: text("code_verifier").notNull(),
    redirectUri: text("redirect_uri").notNull(),
    /** Where to send the user after a successful sign-in. */
    returnTo: text("return_to"),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("sso_auth_states_state_key").on(t.state),
    index("sso_auth_states_expiry_idx").on(t.expiresAt),
  ]
);

/** Links a local user to an external identity. */
export const ssoIdentities = identity.table(
  "sso_identities",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    connectionId: uuid("connection_id")
      .notNull()
      .references(() => ssoConnections.id, { onDelete: "cascade" }),

    /** The provider's stable identifier. Not the email, which changes. */
    subject: text("subject").notNull(),
    emailAtLink: text("email_at_link").notNull(),
    lastSignInAt: timestamp("last_sign_in_at", { withTimezone: true }),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("sso_identities_connection_subject_key").on(t.connectionId, t.subject),
    index("sso_identities_user_idx").on(t.userId),
  ]
);

/**
 * Bearer tokens the identity provider uses to call the SCIM endpoints.
 *
 * Stored hashed. A leaked database must not hand over working provisioning
 * credentials, which can create and disable accounts.
 */
export const scimTokens = identity.table(
  "scim_tokens",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),

    name: text("name").notNull(),
    tokenHash: text("token_hash").notNull(),
    /** Shown in the UI so a token can be identified without revealing it. */
    tokenPrefix: text("token_prefix").notNull(),

    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdById: uuid("created_by_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("scim_tokens_hash_key").on(t.tokenHash),
    index("scim_tokens_org_idx").on(t.orgId),
  ]
);

/**
 * Every provisioning operation received.
 *
 * Kept because the question after an incident is always "when did the
 * directory tell us to disable this account, and what did we do about it?" —
 * and neither side's logs alone answer it.
 */
export const scimSyncLog = identity.table(
  "scim_sync_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    tokenId: uuid("token_id").references(() => scimTokens.id, { onDelete: "set null" }),

    operation: text("operation").notNull(),
    resourceType: text("resource_type").notNull().default("User"),
    externalId: text("external_id"),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),

    /** The request body, for reproducing what the provider actually sent. */
    payload: jsonb("payload"),
    statusCode: integer("status_code").notNull(),
    errorDetail: text("error_detail"),

    receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("scim_sync_log_org_received_idx").on(t.orgId, t.receivedAt),
    index("scim_sync_log_external_idx").on(t.orgId, t.externalId),
  ]
);
