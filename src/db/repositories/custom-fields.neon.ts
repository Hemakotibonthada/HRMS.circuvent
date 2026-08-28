// ═══════════════════════════════════════════════════════════════
// CUSTOM FIELDS REPOSITORY — Neon implementation (server-side only)
// ═══════════════════════════════════════════════════════════════
// Definitions, values, and the guards that keep a configuration change from
// becoming a data-loss event. The validation rules live in
// src/lib/custom-fields.ts so they test without a database.

import { and, asc, count, eq, inArray, ne, sql } from "drizzle-orm";
import { withTenant, type TenantContext } from "@/db/client";
import {
  customFieldAudit,
  customFieldDefinitions,
  customFieldValues,
} from "@/db/schema/platform";
import {
  auditRecord,
  canChangeType,
  isValueStillValid,
  piiKeys,
  toIndexText,
  validateRecord,
  type FieldDataType,
  type FieldDefinition,
  type FieldError,
  type FieldValue,
} from "@/lib/custom-fields";
import { NotFoundError, RepositoryError } from "./types";

export interface DefinitionRecord extends FieldDefinition {
  helpText?: string;
  section?: string;
  displayOrder: number;
  visibleToRoles: string[];
  editableByRoles: string[];
}

/** Refusal carrying the per-field errors the form needs to display. */
export class FieldValidationError extends RepositoryError {
  constructor(readonly errors: FieldError[]) {
    super(
      errors.length === 1
        ? errors[0].message
        : `${errors.length} fields could not be saved`,
      422
    );
    this.name = "FieldValidationError";
  }
}

function toDefinition(row: typeof customFieldDefinitions.$inferSelect): DefinitionRecord {
  return {
    id: row.id,
    entityType: row.entityType,
    key: row.key,
    label: row.label,
    helpText: row.helpText ?? undefined,
    dataType: row.dataType as FieldDataType,
    isRequired: row.isRequired,
    requiredWhen: row.requiredWhen ?? undefined,
    options: (row.options as DefinitionRecord["options"]) ?? [],
    validation: (row.validation as DefinitionRecord["validation"]) ?? {},
    isUnique: row.isUnique,
    isPii: row.isPii,
    isActive: row.isActive,
    section: row.section ?? undefined,
    displayOrder: row.displayOrder,
    visibleToRoles: (row.visibleToRoles as string[]) ?? [],
    editableByRoles: (row.editableByRoles as string[]) ?? [],
  };
}

export class NeonCustomFieldsRepository {
  constructor(private readonly ctx: TenantContext) {}

  /**
   * Definitions for an entity, filtered to what this role may see.
   *
   * Filtered server-side. Returning a hidden field and relying on the client
   * not to render it means the value is one network tab away — which for a
   * field marked PII is a disclosure, not a UI bug.
   */
  async definitionsFor(
    entityType: string,
    role: string,
    includeInactive = false
  ): Promise<DefinitionRecord[]> {
    return withTenant(this.ctx, async (tx) => {
      const rows = await tx
        .select()
        .from(customFieldDefinitions)
        .where(
          and(
            eq(customFieldDefinitions.entityType, entityType),
            includeInactive ? undefined : eq(customFieldDefinitions.isActive, true)
          )
        )
        .orderBy(asc(customFieldDefinitions.displayOrder), asc(customFieldDefinitions.label));

      return rows
        .map(toDefinition)
        .filter((d) => d.visibleToRoles.length === 0 || d.visibleToRoles.includes(role));
    });
  }

  async createDefinition(input: {
    entityType: string;
    key: string;
    label: string;
    dataType: FieldDataType;
    isRequired?: boolean;
    helpText?: string;
    options?: { value: string; label: string; isActive?: boolean }[];
    validation?: DefinitionRecord["validation"];
    requiredWhen?: DefinitionRecord["requiredWhen"];
    isUnique?: boolean;
    isPii?: boolean;
    visibleToRoles?: string[];
    editableByRoles?: string[];
    section?: string;
    displayOrder?: number;
    createdById?: string;
  }): Promise<DefinitionRecord> {
    if (!/^[a-z][a-z0-9_]{0,48}$/.test(input.key)) {
      throw new RepositoryError(
        "A field key must be lowercase letters, numbers and underscores, starting with a letter",
        400
      );
    }
    if (
      (input.dataType === "select" || input.dataType === "multiselect") &&
      (input.options ?? []).length === 0
    ) {
      throw new RepositoryError("A choice field needs at least one option", 400);
    }

    const duplicateValues = (input.options ?? []).map((o) => o.value);
    if (new Set(duplicateValues).size !== duplicateValues.length) {
      // Two options with the same value make one of them permanently
      // unselectable, and which one depends on iteration order.
      throw new RepositoryError("Two options share the same value", 400);
    }

    return withTenant(this.ctx, async (tx) => {
      const [created] = await tx
        .insert(customFieldDefinitions)
        .values({
          orgId: this.ctx.orgId,
          entityType: input.entityType,
          key: input.key,
          label: input.label,
          helpText: input.helpText,
          dataType: input.dataType,
          isRequired: input.isRequired ?? false,
          requiredWhen: input.requiredWhen,
          options: input.options ?? [],
          validation: input.validation ?? {},
          isUnique: input.isUnique ?? false,
          isPii: input.isPii ?? false,
          visibleToRoles: input.visibleToRoles ?? [],
          editableByRoles: input.editableByRoles ?? [],
          section: input.section,
          displayOrder: input.displayOrder ?? 0,
          createdById: input.createdById,
        })
        .returning();

      await tx.insert(customFieldAudit).values({
        orgId: this.ctx.orgId,
        definitionId: created.id,
        action: "created",
        after: created,
        changedById: input.createdById,
      });

      return toDefinition(created);
    });
  }

  /**
   * Updates a definition.
   *
   * A type change is refused once values exist, and retiring an option is
   * distinguished from deleting it. Both guards exist because the alternative
   * is silent, irreversible corruption of data that was correct when entered.
   */
  async updateDefinition(
    id: string,
    changes: Partial<{
      label: string;
      helpText: string;
      dataType: FieldDataType;
      isRequired: boolean;
      options: { value: string; label: string; isActive?: boolean }[];
      validation: DefinitionRecord["validation"];
      requiredWhen: DefinitionRecord["requiredWhen"];
      isUnique: boolean;
      isPii: boolean;
      visibleToRoles: string[];
      editableByRoles: string[];
      section: string;
      displayOrder: number;
      isActive: boolean;
    }>,
    changedById?: string
  ): Promise<DefinitionRecord> {
    return withTenant(this.ctx, async (tx) => {
      const [existing] = await tx
        .select()
        .from(customFieldDefinitions)
        .where(eq(customFieldDefinitions.id, id))
        .for("update")
        .limit(1);

      if (!existing) throw new NotFoundError("Field definition", id);

      const [{ used }] = await tx
        .select({ used: count() })
        .from(customFieldValues)
        .where(
          and(
            eq(customFieldValues.definitionId, id),
            sql`${customFieldValues.value} is not null`
          )
        );

      if (changes.dataType && changes.dataType !== existing.dataType) {
        const verdict = canChangeType(
          existing.dataType as FieldDataType,
          changes.dataType,
          used
        );
        if (!verdict.allowed) throw new RepositoryError(verdict.reason, 409);
      }

      if (changes.options) {
        const removed = (existing.options as DefinitionRecord["options"] ?? [])
          .map((o) => o.value)
          .filter((value) => !changes.options!.some((o) => o.value === value));

        if (removed.length > 0) {
          const [{ inUse }] = await tx
            .select({ inUse: count() })
            .from(customFieldValues)
            .where(
              and(
                eq(customFieldValues.definitionId, id),
                inArray(customFieldValues.valueText, removed)
              )
            );

          if (inUse > 0) {
            // Deleting an option in use makes existing records unreadable.
            // Retiring it (isActive: false) stops new selections while leaving
            // history intact, which is what the caller almost always meant.
            throw new RepositoryError(
              `${inUse} record${inUse === 1 ? "" : "s"} still use an option you are removing. Set isActive to false on it instead of deleting it.`,
              409
            );
          }
        }
      }

      if (changes.isUnique && !existing.isUnique) {
        const duplicates = await tx
          .select({ valueText: customFieldValues.valueText, n: count() })
          .from(customFieldValues)
          .where(
            and(
              eq(customFieldValues.definitionId, id),
              sql`${customFieldValues.valueText} is not null`
            )
          )
          .groupBy(customFieldValues.valueText)
          .having(sql`count(*) > 1`);

        if (duplicates.length > 0) {
          throw new RepositoryError(
            `Cannot require uniqueness: ${duplicates.length} value${duplicates.length === 1 ? " is" : "s are"} already duplicated`,
            409
          );
        }
      }

      const [updated] = await tx
        .update(customFieldDefinitions)
        .set({ ...changes, updatedAt: new Date() })
        .where(eq(customFieldDefinitions.id, id))
        .returning();

      await tx.insert(customFieldAudit).values({
        orgId: this.ctx.orgId,
        definitionId: id,
        action: "updated",
        before: existing,
        after: updated,
        changedById,
      });

      return toDefinition(updated);
    });
  }

  /** Values for one entity, keyed by field key. */
  async valuesFor(
    entityType: string,
    entityId: string,
    role: string
  ): Promise<Record<string, FieldValue>> {
    const definitions = await this.definitionsFor(entityType, role, true);
    const byId = new Map(definitions.map((d) => [d.id, d]));

    return withTenant(this.ctx, async (tx) => {
      const rows = await tx
        .select()
        .from(customFieldValues)
        .where(
          and(
            eq(customFieldValues.entityType, entityType),
            eq(customFieldValues.entityId, entityId)
          )
        );

      const out: Record<string, FieldValue> = {};
      for (const row of rows) {
        // A value whose definition this role cannot see is omitted entirely.
        const definition = byId.get(row.definitionId);
        if (!definition) continue;
        out[definition.key] = row.value as FieldValue;
      }
      return out;
    });
  }

  /**
   * Saves values for one entity.
   *
   * Partial by default, so a field made required last month does not block an
   * unrelated edit to a record created before it existed. Use `audit` to find
   * the historic gaps instead.
   */
  async saveValues(
    entityType: string,
    entityId: string,
    submitted: Record<string, unknown>,
    options: { role: string; userId?: string; partial?: boolean } 
  ): Promise<Record<string, FieldValue>> {
    const definitions = await this.definitionsFor(entityType, options.role);

    const writable = definitions.filter(
      (d) => d.editableByRoles.length === 0 || d.editableByRoles.includes(options.role)
    );

    const forbidden = Object.keys(submitted).filter(
      (key) =>
        definitions.some((d) => d.key === key) && !writable.some((d) => d.key === key)
    );

    if (forbidden.length > 0) {
      throw new RepositoryError(
        `You cannot edit: ${forbidden.join(", ")}`,
        403
      );
    }

    const outcome = validateRecord(writable, submitted, { partial: options.partial ?? true });
    if (!outcome.valid) throw new FieldValidationError(outcome.errors);

    return withTenant(this.ctx, async (tx) => {
      const byKey = new Map(writable.map((d) => [d.key, d]));
      const conflicts: FieldError[] = [];

      for (const [key, value] of Object.entries(outcome.values)) {
        const definition = byKey.get(key);
        if (!definition) continue;

        const valueText = toIndexText(value);

        if (definition.isUnique && valueText !== null) {
          const [clash] = await tx
            .select({ id: customFieldValues.id })
            .from(customFieldValues)
            .where(
              and(
                eq(customFieldValues.definitionId, definition.id),
                eq(customFieldValues.valueText, valueText),
                ne(customFieldValues.entityId, entityId)
              )
            )
            .limit(1);

          if (clash) {
            conflicts.push({
              key,
              label: definition.label,
              message: `${definition.label} must be unique, and that value is already used`,
            });
            continue;
          }
        }

        await tx
          .insert(customFieldValues)
          .values({
            orgId: this.ctx.orgId,
            definitionId: definition.id,
            entityType,
            entityId,
            value,
            valueText,
            updatedById: options.userId,
          })
          .onConflictDoUpdate({
            target: [customFieldValues.entityId, customFieldValues.definitionId],
            set: { value, valueText, updatedById: options.userId, updatedAt: new Date() },
          });
      }

      // Raised after the loop so every conflict is reported at once rather
      // than one save attempt at a time.
      if (conflicts.length > 0) throw new FieldValidationError(conflicts);

      const rows = await tx
        .select()
        .from(customFieldValues)
        .where(
          and(
            eq(customFieldValues.entityType, entityType),
            eq(customFieldValues.entityId, entityId)
          )
        );

      const byId = new Map(definitions.map((d) => [d.id, d]));
      const out: Record<string, FieldValue> = {};
      for (const row of rows) {
        const definition = byId.get(row.definitionId);
        if (definition) out[definition.key] = row.value as FieldValue;
      }
      return out;
    });
  }

  /** Required fields an existing record has never filled in. */
  async audit(entityType: string, entityId: string, role: string): Promise<FieldError[]> {
    const definitions = await this.definitionsFor(entityType, role);
    const values = await this.valuesFor(entityType, entityId, role);
    return auditRecord(definitions, values);
  }

  /**
   * Values whose option was deleted from the definition.
   *
   * A retired option stays readable; a deleted one leaves a value referring to
   * nothing. This finds those so they can be corrected rather than discovered
   * by a report that quietly excludes them.
   */
  async orphanedValues(
    entityType: string
  ): Promise<{ entityId: string; key: string; value: FieldValue }[]> {
    return withTenant(this.ctx, async (tx) => {
      const definitions = await tx
        .select()
        .from(customFieldDefinitions)
        .where(eq(customFieldDefinitions.entityType, entityType));

      const choiceFields = definitions
        .map(toDefinition)
        .filter((d) => d.dataType === "select" || d.dataType === "multiselect");

      if (choiceFields.length === 0) return [];

      const rows = await tx
        .select()
        .from(customFieldValues)
        .where(
          inArray(
            customFieldValues.definitionId,
            choiceFields.map((d) => d.id)
          )
        );

      const byId = new Map(choiceFields.map((d) => [d.id, d]));

      return rows
        .filter((row) => {
          const definition = byId.get(row.definitionId);
          return definition && !isValueStillValid(definition, row.value as FieldValue);
        })
        .map((row) => ({
          entityId: row.entityId,
          key: byId.get(row.definitionId)!.key,
          value: row.value as FieldValue,
        }));
    });
  }

  /**
   * Custom-field personal data for one entity, for export or erasure.
   *
   * Custom fields are where a passport number ends up when the vendor did not
   * ship a passport field. A subject-access request that only walks the fixed
   * schema misses exactly that.
   */
  async personalData(
    entityType: string,
    entityId: string
  ): Promise<Record<string, FieldValue>> {
    return withTenant(this.ctx, async (tx) => {
      const definitions = (
        await tx
          .select()
          .from(customFieldDefinitions)
          .where(
            and(
              eq(customFieldDefinitions.entityType, entityType),
              eq(customFieldDefinitions.isPii, true)
            )
          )
      ).map(toDefinition);

      if (definitions.length === 0) return {};

      const rows = await tx
        .select()
        .from(customFieldValues)
        .where(
          and(
            eq(customFieldValues.entityId, entityId),
            inArray(
              customFieldValues.definitionId,
              definitions.map((d) => d.id)
            )
          )
        );

      const byId = new Map(definitions.map((d) => [d.id, d]));
      const out: Record<string, FieldValue> = {};
      for (const row of rows) {
        const definition = byId.get(row.definitionId);
        if (definition) out[definition.key] = row.value as FieldValue;
      }
      return out;
    });
  }

  /** Erases custom-field personal data for one entity. */
  async erasePersonalData(entityType: string, entityId: string): Promise<{ erased: number }> {
    return withTenant(this.ctx, async (tx) => {
      const definitions = await tx
        .select({ id: customFieldDefinitions.id })
        .from(customFieldDefinitions)
        .where(
          and(
            eq(customFieldDefinitions.entityType, entityType),
            eq(customFieldDefinitions.isPii, true)
          )
        );

      if (definitions.length === 0) return { erased: 0 };

      const erased = await tx
        .update(customFieldValues)
        .set({ value: null, valueText: null, updatedAt: new Date() })
        .where(
          and(
            eq(customFieldValues.entityId, entityId),
            inArray(
              customFieldValues.definitionId,
              definitions.map((d) => d.id)
            )
          )
        )
        .returning({ id: customFieldValues.id });

      return { erased: erased.length };
    });
  }

  /** Keys holding personal data, for the governance report. */
  async piiFieldKeys(entityType: string): Promise<string[]> {
    const definitions = await withTenant(this.ctx, async (tx) =>
      tx
        .select()
        .from(customFieldDefinitions)
        .where(eq(customFieldDefinitions.entityType, entityType))
    );
    return piiKeys(definitions.map(toDefinition));
  }
}
