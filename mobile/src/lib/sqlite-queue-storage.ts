// ═══════════════════════════════════════════════════════════════
// SQLITE QUEUE STORAGE — expo-sqlite adapter
// ═══════════════════════════════════════════════════════════════
// Implements QueueStorage from src/lib/mobile/offline-queue.ts.
//
// SQLite rather than AsyncStorage because of what is in the queue: a clock-in
// someone made in a lift with no signal is a record of hours worked, and the
// app may be killed at any moment between the user tapping and the network
// returning. AsyncStorage on Android writes through to a single file with no
// atomicity guarantee across a crash; a half-written JSON blob loses the
// entire queue, not one entry. SQLite gives a real transaction.
//
// The QueueStorage contract is deliberately coarse — read everything, write
// everything — because the queue logic reasons about the whole set when it
// orders streams and enforces the size cap. That is fine at this scale: the
// queue is capped at 500 rows of small JSON. It is honest to note the cost is
// O(n) per mutation and that a per-row interface would be better if the cap
// ever rose by an order of magnitude.

import * as SQLite from "expo-sqlite";
import type { QueuedOperation, QueueStorage } from "./contracts";

const DATABASE = "circuvent-hrms.db";

/**
 * Rows are stored individually rather than as one JSON blob.
 *
 * A single-row blob would make every write rewrite the whole queue and, worse,
 * make a corrupt row unrecoverable. Per-row storage means one bad entry can be
 * dropped while the rest survive — which matters because the rest are other
 * people's hours.
 */
const SCHEMA = `
  PRAGMA journal_mode = WAL;
  CREATE TABLE IF NOT EXISTS queued_operations (
    id TEXT PRIMARY KEY NOT NULL,
    kind TEXT NOT NULL,
    payload TEXT NOT NULL,
    occurred_at TEXT NOT NULL,
    status TEXT NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    last_attempt_at TEXT,
    last_error TEXT,
    stream_key TEXT,
    -- Insertion order. occurred_at is client-supplied and a user can change
    -- their device clock, so ordering by it would let a wrong clock reorder
    -- the queue and send a clock-out before its clock-in.
    sequence INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS queued_operations_sequence_idx
    ON queued_operations (sequence);
`;

interface Row {
  id: string;
  kind: string;
  payload: string;
  occurred_at: string;
  status: string;
  attempts: number;
  last_attempt_at: string | null;
  last_error: string | null;
  stream_key: string | null;
}

export class SqliteQueueStorage implements QueueStorage {
  private database: SQLite.SQLiteDatabase | null = null;
  private opening: Promise<SQLite.SQLiteDatabase> | null = null;

  /**
   * Opens once, even under concurrent callers.
   *
   * The sync loop and a user action can both hit the queue at the same moment.
   * Two `openDatabaseAsync` calls racing produce two handles to one file and,
   * with WAL, two writers that can deadlock each other.
   */
  private async open(): Promise<SQLite.SQLiteDatabase> {
    if (this.database) return this.database;
    if (this.opening) return this.opening;

    this.opening = (async () => {
      const db = await SQLite.openDatabaseAsync(DATABASE);
      await db.execAsync(SCHEMA);
      this.database = db;
      return db;
    })();

    try {
      return await this.opening;
    } finally {
      this.opening = null;
    }
  }

  async read(): Promise<QueuedOperation[]> {
    const db = await this.open();
    const rows = await db.getAllAsync<Row>(
      `SELECT id, kind, payload, occurred_at, status, attempts,
              last_attempt_at, last_error, stream_key
       FROM queued_operations
       ORDER BY sequence ASC`
    );

    const operations: QueuedOperation[] = [];
    const corrupt: string[] = [];

    for (const row of rows) {
      let payload: Record<string, unknown>;
      try {
        payload = JSON.parse(row.payload) as Record<string, unknown>;
      } catch {
        // One unparseable row must not take the queue down with it. Dropping
        // it loses that action; throwing loses every action behind it too.
        corrupt.push(row.id);
        continue;
      }

      operations.push({
        id: row.id,
        kind: row.kind as QueuedOperation["kind"],
        payload,
        occurredAt: row.occurred_at,
        status: row.status as QueuedOperation["status"],
        attempts: row.attempts,
        lastAttemptAt: row.last_attempt_at ?? undefined,
        lastError: row.last_error ?? undefined,
        streamKey: row.stream_key ?? undefined,
      });
    }

    if (corrupt.length > 0) {
      console.warn(`Discarding ${corrupt.length} unreadable queued operation(s)`);
      const placeholders = corrupt.map(() => "?").join(", ");
      await db.runAsync(
        `DELETE FROM queued_operations WHERE id IN (${placeholders})`,
        corrupt
      );
    }

    return operations;
  }

  async write(operations: QueuedOperation[]): Promise<void> {
    const db = await this.open();

    // One transaction. A crash partway through must leave the previous queue
    // intact rather than a partial one — losing three of eight pending
    // clock-ins is harder to notice, and harder to recover from, than losing
    // none of them.
    await db.withExclusiveTransactionAsync(async (tx) => {
      await tx.runAsync("DELETE FROM queued_operations");

      for (const [index, operation] of operations.entries()) {
        await tx.runAsync(
          `INSERT INTO queued_operations
             (id, kind, payload, occurred_at, status, attempts,
              last_attempt_at, last_error, stream_key, sequence)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            operation.id,
            operation.kind,
            JSON.stringify(operation.payload),
            operation.occurredAt,
            operation.status,
            operation.attempts,
            operation.lastAttemptAt ?? null,
            operation.lastError ?? null,
            operation.streamKey ?? null,
            index,
          ]
        );
      }
    });
  }

  /** Used when signing out: another user's queue must not inherit this one. */
  async clear(): Promise<void> {
    const db = await this.open();
    await db.runAsync("DELETE FROM queued_operations");
  }

  async close(): Promise<void> {
    if (!this.database) return;
    await this.database.closeAsync();
    this.database = null;
  }
}
