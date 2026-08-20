// ═══════════════════════════════════════════════════════════════
// OUTBOX SWEEP — re-driving what did not get through the first time
// ═══════════════════════════════════════════════════════════════
//
// HRMS hands things to other systems, or to its own object storage, on a
// schedule it does not control: an employee's record to Paystub so they can
// be paid, their group memberships to auth.circuvent.com so they can open
// anything, and — once a document is fully signed — its archived PDF to R2.
// All three are written as durable intent inside the transaction that made
// them true and delivered afterwards, so none of the three can fail the
// request that created the intent just because somebody else's system, or
// R2 itself, is unreachable at that moment.
//
// That trade only holds if something comes back for the failures. Before the
// first two outboxes had this, nothing did: they recorded an attempt count
// and a next attempt time on every failure, and the only code that re-read
// them ran when an employee happened to be created or edited. A push that
// failed on a network blip therefore waited for an unrelated edit to the same
// employee — and for a leaver, that edit never comes. The PDF storage outbox
// is built the same way from the start, precisely so it never has that gap.
//
// So the recovery is deliberately not clever. It enumerates the tenants, asks
// each outbox for what is due, and lets each drain record its own outcome.

import { isNull } from "drizzle-orm";

import { withTenant } from "@/db/client";
import { organizations } from "@/db/schema/identity";
import { drainDueGroupJoins, type DrainResult } from "@/lib/directory-group-outbox";
import { drainDuePaystubSyncs, type PaystubDrainResult } from "@/lib/paystub-sync-outbox";
import { drainDueDocumentPdfStorage, type DocumentPdfDrainResult } from "@/lib/document-pdf-outbox";

export interface OrgSweepResult {
  orgId: string;
  paystub: PaystubDrainResult;
  groupJoins: DrainResult;
  documentPdfs: DocumentPdfDrainResult;
}

export interface SweepResult {
  organisations: number;
  orgs: OrgSweepResult[];
  totals: {
    paystubSynced: number;
    paystubFailed: number;
    paystubRetired: number;
    groupsJoined: number;
    groupsFailed: number;
    documentPdfsStored: number;
    documentPdfsFailed: number;
  };
  /** One entry per tenant that could not be swept at all, naming which. */
  problems: string[];
}

/**
 * Every tenant with data to sweep.
 *
 * Read with the superuser escape because a scheduled sweep has no session and
 * therefore no tenant — the organisation is the *result* of this lookup, which
 * is the same reason `api-v1-context.ts` and `session.ts` use it. Nothing else
 * here runs that way: each drain is given one organisation and stays inside
 * row-level security.
 */
async function activeOrganisationIds(): Promise<string[]> {
  const rows = await withTenant({ orgId: "", superuser: true }, async (tx) =>
    tx.select({ id: organizations.id }).from(organizations).where(isNull(organizations.deletedAt))
  );
  return rows.map((row) => row.id);
}

/**
 * Drains all three outboxes for every tenant.
 *
 * One tenant's failure is recorded and the rest still run. A sweep that stops
 * at the first bad organisation would leave the others un-swept for a day
 * without saying so, and the organisation that broke it would be the only one
 * anybody heard about.
 *
 * The four collaborators are injectable for the same reason
 * `deliverPaystubEmployeeSync` takes its `push`: the behaviour worth proving
 * here is that one tenant throwing does not cost the others their sweep, and
 * that is not provable against a real database and two live HTTP endpoints.
 */
export async function sweepOutboxes(
  limitPerOrg = 50,
  deps: {
    listOrgs?: () => Promise<string[]>;
    drainPaystub?: (ctx: { orgId: string }, limit: number) => Promise<PaystubDrainResult>;
    drainGroups?: (ctx: { orgId: string }, limit: number) => Promise<DrainResult>;
    drainDocumentPdfs?: (ctx: { orgId: string }, limit: number) => Promise<DocumentPdfDrainResult>;
  } = {}
): Promise<SweepResult> {
  const listOrgs = deps.listOrgs ?? activeOrganisationIds;
  const drainPaystub = deps.drainPaystub ?? drainDuePaystubSyncs;
  const drainGroups = deps.drainGroups ?? drainDueGroupJoins;
  const drainDocumentPdfs = deps.drainDocumentPdfs ?? drainDueDocumentPdfStorage;

  const result: SweepResult = {
    organisations: 0,
    orgs: [],
    totals: {
      paystubSynced: 0,
      paystubFailed: 0,
      paystubRetired: 0,
      groupsJoined: 0,
      groupsFailed: 0,
      documentPdfsStored: 0,
      documentPdfsFailed: 0,
    },
    problems: [],
  };

  let orgIds: string[];
  try {
    orgIds = await listOrgs();
  } catch (error) {
    result.problems.push(
      `Could not list organisations: ${error instanceof Error ? error.message : String(error)}`
    );
    return result;
  }

  result.organisations = orgIds.length;

  for (const orgId of orgIds) {
    const ctx = { orgId };
    try {
      // Sequential, and per organisation. These make outbound calls to
      // Paystub, the identity provider and R2; running every tenant at once
      // would turn a daily tidy-up into a burst against all three.
      const paystub = await drainPaystub(ctx, limitPerOrg);
      const groupJoins = await drainGroups(ctx, limitPerOrg);
      const documentPdfs = await drainDocumentPdfs(ctx, limitPerOrg);

      result.orgs.push({ orgId, paystub, groupJoins, documentPdfs });
      result.totals.paystubSynced += paystub.synced;
      result.totals.paystubFailed += paystub.failed;
      result.totals.paystubRetired += paystub.retired;
      result.totals.groupsJoined += groupJoins.joined;
      result.totals.groupsFailed += groupJoins.failed;
      result.totals.documentPdfsStored += documentPdfs.succeeded;
      result.totals.documentPdfsFailed += documentPdfs.failed;
    } catch (error) {
      result.problems.push(`${orgId}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  return result;
}
