// ═══════════════════════════════════════════════════════════════
// LEARNING REPOSITORY — Neon implementation (server-side only)
// ═══════════════════════════════════════════════════════════════
// Courses, enrolment, progress, grading and the compliance report. The rules
// live in src/lib/learning-rules.ts so they test without a database; this
// enforces them against real data.

import { and, asc, desc, eq, inArray, isNotNull, lte, sql } from "drizzle-orm";
import { withTenant, type TenantContext } from "@/db/client";
import { employees } from "@/db/schema/hrms";
import {
  certifications,
  courseEnrolments,
  courseModules,
  courses,
} from "@/db/schema/talent";
import {
  applyScore,
  calculateProgress,
  canEnrol,
  complianceStatus,
  dueDateFor,
  gradeAssessment,
  isMandatoryFor,
  missingMandatory,
  nextModule,
  type AssessmentAnswer,
  type AssessmentQuestion,
  type ComplianceStatus,
  type CourseDefinition,
  type EmployeeProfile,
  type EnrolmentState,
  type MandatoryRules,
  type ModuleDefinition,
} from "@/lib/learning-rules";
import { NotFoundError, RepositoryError } from "./types";

export interface CourseRecord {
  id: string;
  title: string;
  code: string;
  description?: string;
  category?: string;
  format: string;
  durationMinutes?: number;
  skills: string[];
  isMandatory: boolean;
  passingScorePercent: number;
  maxAttempts?: number;
  recertifyAfterDays?: number;
  providerName?: string;
  thumbnailUrl?: string;
  moduleCount?: number;
  /** Resolved per employee when listing the catalogue. */
  enrolmentState?: string;
  progressPercent?: number;
  /** Why the employee cannot enrol right now, if they cannot. */
  unavailableReason?: string;
  missingPrerequisiteIds?: string[];
}

export interface ModuleRecord {
  id: string;
  title: string;
  sequence: number;
  contentType: string;
  contentUrl?: string;
  contentBody?: string;
  durationMinutes?: number;
  isOptional: boolean;
  isCompleted: boolean;
  /** Questions only — never the answers. */
  assessment?: { id: string; prompt: string; options?: string[]; points?: number }[];
}

export interface EnrolmentRecord {
  id: string;
  courseId: string;
  courseTitle?: string;
  employeeId: string;
  state: string;
  progressPercent: number;
  scorePercent?: number;
  attempts: number;
  attemptsRemaining?: number | null;
  dueOn?: string;
  expiresOn?: string;
  completedAt?: string;
  compliance?: ComplianceStatus;
}

interface StoredQuestion extends AssessmentQuestion {
  prompt: string;
  options?: string[];
}

function toDefinition(row: typeof courses.$inferSelect): CourseDefinition {
  return {
    id: row.id,
    passingScorePercent: row.passingScorePercent ?? 70,
    maxAttempts: row.maxAttempts ?? undefined,
    recertifyAfterDays: row.recertifyAfterDays ?? undefined,
    prerequisiteCourseIds: (row.prerequisiteCourseIds as string[]) ?? [],
    isMandatory: row.isMandatory,
    mandatoryForRules: (row.mandatoryForRules as MandatoryRules) ?? undefined,
  };
}

function toEnrolmentState(row: typeof courseEnrolments.$inferSelect): EnrolmentState {
  return {
    courseId: row.courseId,
    employeeId: row.employeeId,
    state: row.state,
    completedModuleIds: (row.completedModuleIds as string[]) ?? [],
    scorePercent: row.scorePercent ?? undefined,
    attempts: row.attempts,
    dueOn: row.dueOn ?? undefined,
    completedAt: row.completedAt?.toISOString().slice(0, 10),
    expiresOn: row.expiresOn ?? undefined,
  };
}

function toModuleDefinition(row: typeof courseModules.$inferSelect): ModuleDefinition {
  return {
    id: row.id,
    sequence: row.sequence,
    isOptional: row.isOptional,
    durationMinutes: row.durationMinutes ?? undefined,
  };
}

export class NeonLearningRepository {
  constructor(private readonly ctx: TenantContext) {}

  /**
   * The catalogue, with each course's enrolment state resolved for one person.
   *
   * Resolved server-side so a course someone cannot start does not appear as a
   * choice they can make and then have rejected — and so the reason is
   * specific rather than a generic refusal.
   */
  async catalogue(employeeId: string, today: string): Promise<CourseRecord[]> {
    return withTenant(this.ctx, async (tx) => {
      const rows = await tx
        .select()
        .from(courses)
        .where(eq(courses.isPublished, true))
        .orderBy(desc(courses.isMandatory), asc(courses.title));

      const enrolments = await tx
        .select()
        .from(courseEnrolments)
        .where(eq(courseEnrolments.employeeId, employeeId));

      const states = enrolments.map(toEnrolmentState);

      const counts = await tx
        .select({ courseId: courseModules.courseId, count: sql<number>`count(*)::int` })
        .from(courseModules)
        .groupBy(courseModules.courseId);

      const countByCourse = new Map(counts.map((c) => [c.courseId, c.count]));

      return rows.map((row) => {
        const definition = toDefinition(row);
        const mine = enrolments.find((e) => e.courseId === row.id);
        const verdict = canEnrol(definition, states, today);

        return {
          id: row.id,
          title: row.title,
          code: row.code,
          description: row.description ?? undefined,
          category: row.category ?? undefined,
          format: row.format,
          durationMinutes: row.durationMinutes ?? undefined,
          skills: (row.skills as string[]) ?? [],
          isMandatory: row.isMandatory,
          passingScorePercent: row.passingScorePercent ?? 70,
          maxAttempts: row.maxAttempts ?? undefined,
          recertifyAfterDays: row.recertifyAfterDays ?? undefined,
          providerName: row.providerName ?? undefined,
          thumbnailUrl: row.thumbnailUrl ?? undefined,
          moduleCount: countByCourse.get(row.id) ?? 0,
          enrolmentState: mine?.state,
          progressPercent: mine?.progressPercent,
          unavailableReason: verdict.allowed ? undefined : verdict.reason,
          missingPrerequisiteIds: verdict.allowed ? undefined : verdict.missingPrerequisiteIds,
        };
      });
    });
  }

  /**
   * A course with its modules, for the learner taking it.
   *
   * Assessment answers are stripped before the response is built. Sending the
   * correct answers to the browser and grading there would make every
   * assessment decorative.
   */
  async courseForLearner(
    courseId: string,
    employeeId: string
  ): Promise<{ course: CourseRecord; modules: ModuleRecord[]; enrolment?: EnrolmentRecord }> {
    return withTenant(this.ctx, async (tx) => {
      const [row] = await tx.select().from(courses).where(eq(courses.id, courseId)).limit(1);
      if (!row) throw new NotFoundError("Course", courseId);

      const modules = await tx
        .select()
        .from(courseModules)
        .where(eq(courseModules.courseId, courseId))
        .orderBy(asc(courseModules.sequence));

      const [enrolment] = await tx
        .select()
        .from(courseEnrolments)
        .where(
          and(
            eq(courseEnrolments.courseId, courseId),
            eq(courseEnrolments.employeeId, employeeId)
          )
        )
        .orderBy(desc(courseEnrolments.createdAt))
        .limit(1);

      const completed = new Set((enrolment?.completedModuleIds as string[]) ?? []);

      return {
        course: {
          id: row.id,
          title: row.title,
          code: row.code,
          description: row.description ?? undefined,
          category: row.category ?? undefined,
          format: row.format,
          durationMinutes: row.durationMinutes ?? undefined,
          skills: (row.skills as string[]) ?? [],
          isMandatory: row.isMandatory,
          passingScorePercent: row.passingScorePercent ?? 70,
          maxAttempts: row.maxAttempts ?? undefined,
          recertifyAfterDays: row.recertifyAfterDays ?? undefined,
          providerName: row.providerName ?? undefined,
          thumbnailUrl: row.thumbnailUrl ?? undefined,
          moduleCount: modules.length,
        },
        modules: modules.map((m) => ({
          id: m.id,
          title: m.title,
          sequence: m.sequence,
          contentType: m.contentType,
          contentUrl: m.contentUrl ?? undefined,
          contentBody: m.contentBody ?? undefined,
          durationMinutes: m.durationMinutes ?? undefined,
          isOptional: m.isOptional,
          isCompleted: completed.has(m.id),
          assessment: stripAnswers(m.assessment as StoredQuestion[] | null),
        })),
        enrolment: enrolment
          ? {
              id: enrolment.id,
              courseId: enrolment.courseId,
              employeeId: enrolment.employeeId,
              state: enrolment.state,
              progressPercent: enrolment.progressPercent,
              scorePercent: enrolment.scorePercent ?? undefined,
              attempts: enrolment.attempts,
              attemptsRemaining:
                row.maxAttempts === null
                  ? null
                  : Math.max(0, (row.maxAttempts ?? 0) - enrolment.attempts),
              dueOn: enrolment.dueOn ?? undefined,
              expiresOn: enrolment.expiresOn ?? undefined,
              completedAt: enrolment.completedAt?.toISOString(),
            }
          : undefined,
      };
    });
  }

  /** Enrols an employee, refusing when prerequisites are unmet. */
  async enrol(
    courseId: string,
    employeeId: string,
    today: string,
    assignedById?: string
  ): Promise<EnrolmentRecord> {
    return withTenant(this.ctx, async (tx) => {
      const [row] = await tx.select().from(courses).where(eq(courses.id, courseId)).limit(1);
      if (!row) throw new NotFoundError("Course", courseId);
      if (!row.isPublished) {
        throw new RepositoryError("This course is not yet published", 409);
      }

      const existing = await tx
        .select()
        .from(courseEnrolments)
        .where(eq(courseEnrolments.employeeId, employeeId));

      const definition = toDefinition(row);
      const verdict = canEnrol(definition, existing.map(toEnrolmentState), today);
      if (!verdict.allowed) {
        throw new RepositoryError(verdict.reason, 409);
      }

      const [employee] = await tx
        .select({
          id: employees.id,
          departmentId: employees.departmentId,
          designation: employees.designation,
          locationId: employees.locationId,
          employmentType: employees.employmentType,
          joinDate: employees.joinDate,
        })
        .from(employees)
        .where(eq(employees.id, employeeId))
        .limit(1);

      if (!employee) throw new NotFoundError("Employee", employeeId);

      const dueOn = dueDateFor(definition, toProfile(employee), today);

      const [created] = await tx
        .insert(courseEnrolments)
        .values({
          orgId: this.ctx.orgId,
          courseId,
          employeeId,
          assignedById,
          dueOn,
        })
        .returning();

      return {
        id: created.id,
        courseId,
        courseTitle: row.title,
        employeeId,
        state: created.state,
        progressPercent: 0,
        attempts: 0,
        dueOn: created.dueOn ?? undefined,
      };
    });
  }

  /**
   * Marks a module complete and recomputes progress.
   *
   * Progress is derived from the stored module ids rather than incremented.
   * A counter would drift the moment a course gained or lost a module, and
   * would double-count a learner who revisited a module.
   */
  async completeModule(
    enrolmentId: string,
    moduleId: string,
    employeeId: string,
    minutesSpent = 0
  ): Promise<EnrolmentRecord & { readyForAssessment: boolean }> {
    return withTenant(this.ctx, async (tx) => {
      const [enrolment] = await tx
        .select()
        .from(courseEnrolments)
        .where(eq(courseEnrolments.id, enrolmentId))
        .for("update")
        .limit(1);

      if (!enrolment) throw new NotFoundError("Enrolment", enrolmentId);
      if (enrolment.employeeId !== employeeId) {
        throw new RepositoryError("This is not your enrolment", 403);
      }
      if (enrolment.state === "completed" || enrolment.state === "waived") {
        throw new RepositoryError(`This course is already ${enrolment.state}`, 409);
      }

      const modules = await tx
        .select()
        .from(courseModules)
        .where(eq(courseModules.courseId, enrolment.courseId));

      if (!modules.some((m) => m.id === moduleId)) {
        throw new RepositoryError("That module is not part of this course", 400);
      }

      const done = new Set((enrolment.completedModuleIds as string[]) ?? []);
      done.add(moduleId);

      const completedIds = [...done];
      const progress = calculateProgress(modules.map(toModuleDefinition), completedIds);

      const [updated] = await tx
        .update(courseEnrolments)
        .set({
          completedModuleIds: completedIds,
          progressPercent: progress,
          state: "in_progress",
          startedAt: enrolment.startedAt ?? new Date(),
          timeSpentMinutes: enrolment.timeSpentMinutes + Math.max(0, minutesSpent),
          updatedAt: new Date(),
        })
        .where(eq(courseEnrolments.id, enrolmentId))
        .returning();

      const remaining = nextModule(modules.map(toModuleDefinition), completedIds);

      return {
        id: updated.id,
        courseId: updated.courseId,
        employeeId: updated.employeeId,
        state: updated.state,
        progressPercent: updated.progressPercent,
        attempts: updated.attempts,
        dueOn: updated.dueOn ?? undefined,
        // Surfaced so the client knows whether to offer the assessment.
        readyForAssessment: remaining === null,
      };
    });
  }

  /**
   * Grades a submission and applies the result.
   *
   * Grading happens here, not in the browser. The answers never leave the
   * server, so an assessment cannot be passed by reading the page source.
   */
  async submitAssessment(
    enrolmentId: string,
    moduleId: string,
    employeeId: string,
    answers: AssessmentAnswer[],
    today: string
  ): Promise<EnrolmentRecord & { passed: boolean; message: string }> {
    return withTenant(this.ctx, async (tx) => {
      const [enrolment] = await tx
        .select()
        .from(courseEnrolments)
        .where(eq(courseEnrolments.id, enrolmentId))
        .for("update")
        .limit(1);

      if (!enrolment) throw new NotFoundError("Enrolment", enrolmentId);
      if (enrolment.employeeId !== employeeId) {
        throw new RepositoryError("This is not your enrolment", 403);
      }

      const [course] = await tx
        .select()
        .from(courses)
        .where(eq(courses.id, enrolment.courseId))
        .limit(1);
      if (!course) throw new NotFoundError("Course", enrolment.courseId);

      const [module] = await tx
        .select()
        .from(courseModules)
        .where(eq(courseModules.id, moduleId))
        .limit(1);

      if (!module || module.courseId !== enrolment.courseId) {
        throw new RepositoryError("That module is not part of this course", 400);
      }

      const questions = (module.assessment as StoredQuestion[] | null) ?? [];
      if (questions.length === 0) {
        throw new RepositoryError("This module has no assessment", 400);
      }

      const score = gradeAssessment(questions, answers);

      let result;
      try {
        result = applyScore(toDefinition(course), toEnrolmentState(enrolment), score, today);
      } catch (e) {
        throw new RepositoryError((e as Error).message, 409);
      }

      const completedIds = new Set((enrolment.completedModuleIds as string[]) ?? []);
      if (result.passed) completedIds.add(moduleId);

      const modules = await tx
        .select()
        .from(courseModules)
        .where(eq(courseModules.courseId, enrolment.courseId));

      const progress = calculateProgress(modules.map(toModuleDefinition), [...completedIds]);

      const [updated] = await tx
        .update(courseEnrolments)
        .set({
          state: result.state,
          scorePercent: score,
          attempts: result.attemptsUsed,
          completedModuleIds: [...completedIds],
          progressPercent: result.passed ? progress : enrolment.progressPercent,
          completedAt: result.completedAt ? new Date(`${result.completedAt}T00:00:00Z`) : null,
          expiresOn: result.expiresOn ?? null,
          updatedAt: new Date(),
        })
        .where(eq(courseEnrolments.id, enrolmentId))
        .returning();

      // An in-platform pass produces a certification record, so the compliance
      // report has one place to look rather than two.
      if (result.passed) {
        await tx.insert(certifications).values({
          orgId: this.ctx.orgId,
          employeeId,
          name: course.title,
          issuingBody: course.providerName ?? "Internal",
          courseEnrolmentId: enrolmentId,
          issuedOn: result.completedAt ?? today,
          expiresOn: result.expiresOn ?? null,
          isVerified: true,
        });
      }

      return {
        id: updated.id,
        courseId: updated.courseId,
        employeeId: updated.employeeId,
        state: updated.state,
        progressPercent: updated.progressPercent,
        scorePercent: score,
        attempts: updated.attempts,
        attemptsRemaining: result.attemptsRemaining,
        expiresOn: updated.expiresOn ?? undefined,
        completedAt: updated.completedAt?.toISOString(),
        passed: result.passed,
        message: result.message,
      };
    });
  }

  /** One employee's learning, with compliance resolved. */
  async myLearning(employeeId: string, today: string): Promise<EnrolmentRecord[]> {
    return withTenant(this.ctx, async (tx) => {
      const rows = await tx
        .select({ e: courseEnrolments, courseTitle: courses.title })
        .from(courseEnrolments)
        .leftJoin(courses, eq(courses.id, courseEnrolments.courseId))
        .where(eq(courseEnrolments.employeeId, employeeId))
        .orderBy(desc(courseEnrolments.updatedAt));

      return rows.map((r) => ({
        id: r.e.id,
        courseId: r.e.courseId,
        courseTitle: r.courseTitle ?? undefined,
        employeeId: r.e.employeeId,
        state: r.e.state,
        progressPercent: r.e.progressPercent,
        scorePercent: r.e.scorePercent ?? undefined,
        attempts: r.e.attempts,
        dueOn: r.e.dueOn ?? undefined,
        expiresOn: r.e.expiresOn ?? undefined,
        completedAt: r.e.completedAt?.toISOString(),
        compliance: complianceStatus(toEnrolmentState(r.e), today),
      }));
    });
  }

  /**
   * Org-wide mandatory-training compliance.
   *
   * Includes people with no enrolment at all. A report built only from
   * enrolment rows shows 100% compliance the day a mandatory course is created
   * and nobody has been assigned it — the most misleading number the system
   * could produce.
   */
  async complianceReport(today: string): Promise<{
    summary: { compliant: number; overdue: number; expiring: number; expired: number; missing: number };
    rows: {
      employeeId: string;
      employeeName: string;
      courseId: string;
      courseTitle: string;
      state: string;
      detail: string;
      daysRemaining: number | null;
    }[];
  }> {
    return withTenant(this.ctx, async (tx) => {
      const mandatory = await tx
        .select()
        .from(courses)
        .where(and(eq(courses.isMandatory, true), eq(courses.isPublished, true)));

      if (mandatory.length === 0) {
        return {
          summary: { compliant: 0, overdue: 0, expiring: 0, expired: 0, missing: 0 },
          rows: [],
        };
      }

      const staff = await tx
        .select({
          id: employees.id,
          firstName: employees.firstName,
          lastName: employees.lastName,
          departmentId: employees.departmentId,
          designation: employees.designation,
          locationId: employees.locationId,
          employmentType: employees.employmentType,
          joinDate: employees.joinDate,
        })
        .from(employees)
        .where(eq(employees.status, "active"));

      const enrolmentRows = await tx
        .select()
        .from(courseEnrolments)
        .where(
          inArray(
            courseEnrolments.courseId,
            mandatory.map((c) => c.id)
          )
        );

      const definitions = mandatory.map(toDefinition);
      const titleById = new Map(mandatory.map((c) => [c.id, c.title]));
      const states = enrolmentRows.map(toEnrolmentState);

      const rows: Awaited<ReturnType<NeonLearningRepository["complianceReport"]>>["rows"] = [];
      const summary = { compliant: 0, overdue: 0, expiring: 0, expired: 0, missing: 0 };

      for (const person of staff) {
        const profile = toProfile(person);
        const name = `${person.firstName} ${person.lastName}`;

        for (const definition of definitions) {
          if (!isMandatoryFor(definition, profile)) continue;

          // The most recent enrolment governs: recertification means someone
          // legitimately has more than one, and an old expired row must not
          // mask a current valid completion.
          const mine = states
            .filter((s) => s.employeeId === person.id && s.courseId === definition.id)
            .sort((a, b) => (a.completedAt ?? "").localeCompare(b.completedAt ?? ""))
            .at(-1);

          if (!mine) {
            summary.missing++;
            rows.push({
              employeeId: person.id,
              employeeName: name,
              courseId: definition.id,
              courseTitle: titleById.get(definition.id) ?? "",
              state: "not_assigned",
              detail: "Never assigned",
              daysRemaining: null,
            });
            continue;
          }

          const status = complianceStatus(mine, today);
          if (status.state === "compliant") summary.compliant++;
          else if (status.state === "overdue") summary.overdue++;
          else if (status.state === "expiring_soon") summary.expiring++;
          else if (status.state === "expired") summary.expired++;

          rows.push({
            employeeId: person.id,
            employeeName: name,
            courseId: definition.id,
            courseTitle: titleById.get(definition.id) ?? "",
            state: status.state,
            detail: status.detail,
            daysRemaining: status.daysRemaining,
          });
        }
      }

      // Worst first: a compliance report read top-down should start with what
      // needs acting on today.
      const severity: Record<string, number> = {
        expired: 0,
        overdue: 1,
        not_assigned: 2,
        expiring_soon: 3,
        in_progress: 4,
        not_started: 5,
        failed: 6,
        compliant: 7,
        waived: 8,
      };
      rows.sort((a, b) => (severity[a.state] ?? 9) - (severity[b.state] ?? 9));

      return { summary, rows };
    });
  }

  /**
   * Assigns every mandatory course an employee is missing.
   *
   * Idempotent: run on a schedule and on every joiner without creating
   * duplicates.
   */
  async assignMandatory(
    employeeId: string,
    today: string,
    assignedById?: string
  ): Promise<{ assigned: string[] }> {
    return withTenant(this.ctx, async (tx) => {
      const [employee] = await tx
        .select({
          id: employees.id,
          departmentId: employees.departmentId,
          designation: employees.designation,
          locationId: employees.locationId,
          employmentType: employees.employmentType,
          joinDate: employees.joinDate,
        })
        .from(employees)
        .where(eq(employees.id, employeeId))
        .limit(1);

      if (!employee) throw new NotFoundError("Employee", employeeId);

      const mandatory = await tx
        .select()
        .from(courses)
        .where(and(eq(courses.isMandatory, true), eq(courses.isPublished, true)));

      const existing = await tx
        .select()
        .from(courseEnrolments)
        .where(eq(courseEnrolments.employeeId, employeeId));

      const profile = toProfile(employee);
      const missing = missingMandatory(
        mandatory.map(toDefinition),
        profile,
        existing.map(toEnrolmentState),
        today
      );

      if (missing.length === 0) return { assigned: [] };

      await tx.insert(courseEnrolments).values(
        missing.map((definition) => ({
          orgId: this.ctx.orgId,
          courseId: definition.id,
          employeeId,
          assignedById,
          dueOn: dueDateFor(definition, profile, today),
        }))
      );

      return { assigned: missing.map((c) => c.id) };
    });
  }

  /** Certifications expiring within the window, for the renewal reminder. */
  async expiringCertifications(
    today: string,
    withinDays = 60
  ): Promise<
    { id: string; employeeId: string; employeeName: string; name: string; expiresOn: string; daysRemaining: number }[]
  > {
    const horizon = new Date(`${today}T00:00:00Z`);
    horizon.setUTCDate(horizon.getUTCDate() + withinDays);
    const cutoff = horizon.toISOString().slice(0, 10);

    return withTenant(this.ctx, async (tx) => {
      const rows = await tx
        .select({
          c: certifications,
          firstName: employees.firstName,
          lastName: employees.lastName,
        })
        .from(certifications)
        .innerJoin(employees, eq(employees.id, certifications.employeeId))
        .where(
          and(
            isNotNull(certifications.expiresOn),
            lte(certifications.expiresOn, cutoff),
            eq(employees.status, "active")
          )
        )
        .orderBy(asc(certifications.expiresOn));

      return rows.map((r) => ({
        id: r.c.id,
        employeeId: r.c.employeeId,
        employeeName: `${r.firstName} ${r.lastName}`,
        name: r.c.name,
        expiresOn: r.c.expiresOn!,
        daysRemaining: Math.round(
          (new Date(`${r.c.expiresOn!}T00:00:00Z`).getTime() -
            new Date(`${today}T00:00:00Z`).getTime()) /
            86_400_000
        ),
      }));
    });
  }
}

function toProfile(row: {
  id: string;
  departmentId: string | null;
  designation: string | null;
  locationId: string | null;
  employmentType: string | null;
  joinDate: string;
}): EmployeeProfile {
  return {
    id: row.id,
    departmentId: row.departmentId ?? undefined,
    designation: row.designation ?? undefined,
    locationId: row.locationId ?? undefined,
    employmentType: row.employmentType ?? undefined,
    joinDate: row.joinDate,
  };
}

/**
 * Removes correct answers before an assessment leaves the server.
 *
 * Sending them to the browser and grading there would make every assessment
 * decorative — the answers would be one "view source" away.
 */
function stripAnswers(
  questions: StoredQuestion[] | null
): { id: string; prompt: string; options?: string[]; points?: number }[] | undefined {
  if (!questions || questions.length === 0) return undefined;
  return questions.map((q) => ({
    id: q.id,
    prompt: q.prompt,
    options: q.options,
    points: q.points,
  }));
}
