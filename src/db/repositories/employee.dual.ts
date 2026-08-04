// ═══════════════════════════════════════════════════════════════
// EMPLOYEE REPOSITORY — dual-write migration wrapper
// ═══════════════════════════════════════════════════════════════
// Used while DATA_BACKEND=dual. Writes go to both stores; reads come from the
// primary (Firestore) only.
//
// The asymmetry is deliberate. The point of this phase is to let Neon
// accumulate real production data so it can be diffed against the source of
// truth, without letting any read depend on it yet. Serving reads from a store
// nobody has validated would defeat the exercise.
//
// Failure policy: the primary write decides the outcome. A secondary failure
// is recorded and reported, never surfaced to the user — a Neon outage during
// migration must not stop people being hired.

import type {
  EmployeeCreate,
  EmployeeRecord,
  EmployeeRepository,
  EmployeeUpdate,
  ListQuery,
  Page,
  Unsubscribe,
} from "./types";

export interface DivergenceEvent {
  operation: "create" | "update" | "remove";
  entityId: string;
  error: string;
  at: string;
}

/** Bounded so a sustained secondary outage cannot exhaust memory. */
const MAX_DIVERGENCES = 200;

export class DualWriteEmployeeRepository implements EmployeeRepository {
  private readonly divergences: DivergenceEvent[] = [];

  constructor(
    private readonly primary: EmployeeRepository,
    private readonly secondary: EmployeeRepository
  ) {}

  private record(operation: DivergenceEvent["operation"], entityId: string, error: unknown) {
    const event: DivergenceEvent = {
      operation,
      entityId,
      error: error instanceof Error ? error.message : String(error),
      at: new Date().toISOString(),
    };
    this.divergences.push(event);
    if (this.divergences.length > MAX_DIVERGENCES) this.divergences.shift();
    console.error(
      `[dual-write] ${operation} diverged for employee ${entityId}: ${event.error}`
    );
  }

  /** Read by the reconciliation dashboard to show migration health. */
  getDivergences(): readonly DivergenceEvent[] {
    return this.divergences;
  }

  // ─── Reads: primary only ───────────────────────────────────

  list(q?: ListQuery): Promise<Page<EmployeeRecord>> {
    return this.primary.list(q);
  }

  getById(id: string): Promise<EmployeeRecord | null> {
    return this.primary.getById(id);
  }

  subscribe(onChange: (items: EmployeeRecord[]) => void, q?: ListQuery): Unsubscribe {
    return this.primary.subscribe(onChange, q);
  }

  listDirectReports(managerId: string): Promise<EmployeeRecord[]> {
    return this.primary.listDirectReports(managerId);
  }

  countByStatus(): Promise<Record<string, number>> {
    return this.primary.countByStatus();
  }

  // ─── Writes: both, primary authoritative ───────────────────

  async create(data: EmployeeCreate): Promise<EmployeeRecord> {
    const created = await this.primary.create(data);

    try {
      // The primary's generated id is passed through as the employee code so
      // the two stores can be matched up during reconciliation.
      await this.secondary.create({ ...data, employeeCode: created.employeeCode });
    } catch (error) {
      this.record("create", created.id, error);
    }

    return created;
  }

  async update(id: string, data: EmployeeUpdate): Promise<EmployeeRecord> {
    const updated = await this.primary.update(id, data);

    try {
      await this.secondary.update(id, data);
    } catch (error) {
      this.record("update", id, error);
    }

    return updated;
  }

  async remove(id: string): Promise<void> {
    await this.primary.remove(id);

    try {
      await this.secondary.remove(id);
    } catch (error) {
      this.record("remove", id, error);
    }
  }
}
