// ═══════════════════════════════════════════════════════════════
// LEARNING RULES
// ═══════════════════════════════════════════════════════════════
// Enrolment eligibility, progress, grading, recertification and compliance
// status. Pure, so it tests without a database.
//
// The reason this is a module and not a handful of inline checks: mandatory
// training is a compliance obligation. A fire-safety certificate that lapsed
// three weeks ago and still shows green is not a cosmetic bug — it is the
// evidence someone will look for after an incident.

export interface CourseDefinition {
  id: string;
  passingScorePercent: number;
  maxAttempts?: number;
  /** Days after completion before it must be retaken. */
  recertifyAfterDays?: number;
  prerequisiteCourseIds: string[];
  isMandatory: boolean;
  mandatoryForRules?: MandatoryRules;
}

export interface ModuleDefinition {
  id: string;
  sequence: number;
  isOptional: boolean;
  durationMinutes?: number;
}

export interface EnrolmentState {
  courseId: string;
  employeeId: string;
  state: "assigned" | "in_progress" | "completed" | "failed" | "expired" | "waived";
  completedModuleIds: string[];
  scorePercent?: number;
  attempts: number;
  dueOn?: string;
  completedAt?: string;
  expiresOn?: string;
}

/**
 * Who a mandatory course applies to.
 *
 * An empty rule set means everyone. That is deliberate: the alternative — an
 * empty rule set matching nobody — makes "mandatory for all staff" the one
 * case you cannot express, and it is the most common one.
 */
export interface MandatoryRules {
  departmentIds?: string[];
  designations?: string[];
  locationIds?: string[];
  employmentTypes?: string[];
  /** Applies only to people who joined on or after this date. */
  joinedOnOrAfter?: string;
  /** Days from joining within which it must be completed. */
  completeWithinDays?: number;
}

export interface EmployeeProfile {
  id: string;
  departmentId?: string;
  designation?: string;
  locationId?: string;
  employmentType?: string;
  joinDate: string;
}

// ─── Eligibility ─────────────────────────────────────────────

export type EnrolVerdict =
  | { allowed: true }
  | { allowed: false; reason: string; missingPrerequisiteIds: string[] };

/**
 * Whether an employee may enrol.
 *
 * Prerequisites are checked against *completed* enrolments only. A course
 * someone is halfway through has not taught them anything they can be relied
 * on to know.
 */
export function canEnrol(
  course: CourseDefinition,
  employeeEnrolments: EnrolmentState[],
  today: string
): EnrolVerdict {
  const existing = employeeEnrolments.find(
    (e) => e.courseId === course.id && e.state !== "expired" && e.state !== "failed"
  );

  if (existing?.state === "completed") {
    // Completing a course again before it expires is wasted time, not a
    // safeguard.
    if (!existing.expiresOn || existing.expiresOn > today) {
      return {
        allowed: false,
        reason: existing.expiresOn
          ? `Already completed; valid until ${existing.expiresOn}`
          : "Already completed",
        missingPrerequisiteIds: [],
      };
    }
  } else if (existing) {
    return {
      allowed: false,
      reason: `Already enrolled and ${existing.state.replace("_", " ")}`,
      missingPrerequisiteIds: [],
    };
  }

  const completed = new Set(
    employeeEnrolments
      .filter((e) => e.state === "completed")
      .filter((e) => !e.expiresOn || e.expiresOn >= today)
      .map((e) => e.courseId)
  );

  const missing = course.prerequisiteCourseIds.filter((id) => !completed.has(id));
  if (missing.length > 0) {
    return {
      allowed: false,
      reason: `${missing.length} prerequisite${missing.length === 1 ? "" : "s"} not yet completed`,
      missingPrerequisiteIds: missing,
    };
  }

  return { allowed: true };
}

/** Whether a mandatory course applies to a given employee. */
export function isMandatoryFor(
  course: CourseDefinition,
  employee: EmployeeProfile
): boolean {
  if (!course.isMandatory) return false;

  const rules = course.mandatoryForRules;
  if (!rules) return true;

  if (rules.departmentIds?.length) {
    if (!employee.departmentId || !rules.departmentIds.includes(employee.departmentId)) {
      return false;
    }
  }
  if (rules.designations?.length) {
    if (!employee.designation || !rules.designations.includes(employee.designation)) {
      return false;
    }
  }
  if (rules.locationIds?.length) {
    if (!employee.locationId || !rules.locationIds.includes(employee.locationId)) {
      return false;
    }
  }
  if (rules.employmentTypes?.length) {
    if (!employee.employmentType || !rules.employmentTypes.includes(employee.employmentType)) {
      return false;
    }
  }
  if (rules.joinedOnOrAfter && employee.joinDate < rules.joinedOnOrAfter) {
    return false;
  }

  return true;
}

/** The due date for a mandatory course, from the employee's join date. */
export function dueDateFor(
  course: CourseDefinition,
  employee: EmployeeProfile,
  assignedOn: string
): string | undefined {
  const days = course.mandatoryForRules?.completeWithinDays;
  if (!days) return undefined;

  // Measured from joining, not from assignment: a course assigned late does
  // not extend a new starter's induction deadline. But it cannot fall before
  // the day it was assigned, or it would arrive already overdue.
  const fromJoin = addDays(employee.joinDate, days);
  return fromJoin > assignedOn ? fromJoin : assignedOn;
}

// ─── Progress ────────────────────────────────────────────────

/**
 * Progress through a course, as a percentage.
 *
 * Only mandatory modules count towards the total. An optional module that
 * nobody takes would otherwise cap every learner below 100% and leave a course
 * that can never be finished.
 *
 * Weighted by duration when durations are known, because a two-minute intro
 * and a ninety-minute assessment are not equal halves of a course.
 */
export function calculateProgress(
  modules: ModuleDefinition[],
  completedModuleIds: string[]
): number {
  const required = modules.filter((m) => !m.isOptional);
  if (required.length === 0) return 100;

  const done = new Set(completedModuleIds);
  const weighted = required.every((m) => (m.durationMinutes ?? 0) > 0);

  if (!weighted) {
    const finished = required.filter((m) => done.has(m.id)).length;
    return Math.round((finished / required.length) * 100);
  }

  const total = required.reduce((sum, m) => sum + (m.durationMinutes ?? 0), 0);
  const complete = required
    .filter((m) => done.has(m.id))
    .reduce((sum, m) => sum + (m.durationMinutes ?? 0), 0);

  return Math.round((complete / total) * 100);
}

/** The next module a learner should take. */
export function nextModule(
  modules: ModuleDefinition[],
  completedModuleIds: string[]
): ModuleDefinition | null {
  const done = new Set(completedModuleIds);
  // Optional modules are offered in sequence but never block: skipping one
  // must not strand the learner.
  return (
    [...modules]
      .sort((a, b) => a.sequence - b.sequence)
      .find((m) => !done.has(m.id)) ?? null
  );
}

// ─── Grading ─────────────────────────────────────────────────

export interface GradeResult {
  scorePercent: number;
  passed: boolean;
  attemptsUsed: number;
  attemptsRemaining: number | null;
  state: EnrolmentState["state"];
  /** Written for the learner. */
  message: string;
}

export interface AssessmentAnswer {
  questionId: string;
  answer: string | string[];
}

export interface AssessmentQuestion {
  id: string;
  correctAnswer: string | string[];
  /** Defaults to 1 when unset, so an unweighted quiz still grades. */
  points?: number;
}

/** Grades an assessment submission. */
export function gradeAssessment(
  questions: AssessmentQuestion[],
  answers: AssessmentAnswer[]
): number {
  if (questions.length === 0) return 100;

  const byId = new Map(answers.map((a) => [a.questionId, a.answer]));
  const totalPoints = questions.reduce((sum, q) => sum + (q.points ?? 1), 0);

  const earned = questions.reduce((sum, q) => {
    const given = byId.get(q.id);
    if (given === undefined) return sum;
    return matches(q.correctAnswer, given) ? sum + (q.points ?? 1) : sum;
  }, 0);

  return Math.round((earned / totalPoints) * 100);
}

function matches(expected: string | string[], given: string | string[]): boolean {
  if (Array.isArray(expected) !== Array.isArray(given)) return false;

  if (Array.isArray(expected) && Array.isArray(given)) {
    // Order-insensitive: "select all that apply" is a set, and marking someone
    // wrong for clicking the boxes in a different order is a bug.
    if (expected.length !== given.length) return false;
    const sortedExpected = [...expected].map(normalise).sort();
    const sortedGiven = [...given].map(normalise).sort();
    return sortedExpected.every((v, i) => v === sortedGiven[i]);
  }

  return normalise(expected as string) === normalise(given as string);
}

function normalise(value: string): string {
  return value.trim().toLowerCase();
}

/**
 * Applies a score to an enrolment.
 *
 * The attempt is counted whether the learner passes or fails: a system where
 * only failures cost an attempt lets someone pass, see the answers and retake
 * for a better mark.
 */
export function applyScore(
  course: CourseDefinition,
  enrolment: EnrolmentState,
  scorePercent: number,
  completedOn: string
): GradeResult & { expiresOn?: string; completedAt?: string } {
  if (scorePercent < 0 || scorePercent > 100 || !Number.isFinite(scorePercent)) {
    throw new Error("A score must be between 0 and 100");
  }
  if (enrolment.state === "completed") {
    throw new Error("This course is already completed");
  }
  if (enrolment.state === "waived") {
    throw new Error("This course has been waived");
  }

  const attemptsUsed = enrolment.attempts + 1;
  const remaining =
    course.maxAttempts === undefined ? null : Math.max(0, course.maxAttempts - attemptsUsed);

  if (course.maxAttempts !== undefined && enrolment.attempts >= course.maxAttempts) {
    throw new Error("No attempts remaining");
  }

  const passed = scorePercent >= course.passingScorePercent;

  if (passed) {
    return {
      scorePercent,
      passed: true,
      attemptsUsed,
      attemptsRemaining: remaining,
      state: "completed",
      completedAt: completedOn,
      // Measured from completion, not from enrolment: someone who took six
      // months to finish has not used up half their certification period.
      expiresOn: course.recertifyAfterDays
        ? addDays(completedOn, course.recertifyAfterDays)
        : undefined,
      message: `Passed with ${scorePercent}%`,
    };
  }

  const exhausted = remaining === 0;
  return {
    scorePercent,
    passed: false,
    attemptsUsed,
    attemptsRemaining: remaining,
    state: exhausted ? "failed" : "in_progress",
    message: exhausted
      ? `Scored ${scorePercent}%, below the ${course.passingScorePercent}% pass mark, with no attempts remaining`
      : `Scored ${scorePercent}%, below the ${course.passingScorePercent}% pass mark`,
  };
}

// ─── Compliance ──────────────────────────────────────────────

export type ComplianceState =
  | "compliant"
  | "expiring_soon"
  | "overdue"
  | "expired"
  | "not_started"
  | "in_progress"
  | "waived"
  | "failed";

export interface ComplianceStatus {
  courseId: string;
  employeeId: string;
  state: ComplianceState;
  /** Negative when already past. */
  daysRemaining: number | null;
  /** Plain language, for the report a compliance officer reads. */
  detail: string;
}

/**
 * Compliance status for one enrolment.
 *
 * `expiringSoonDays` exists so a lapse is visible before it happens.
 * Discovering an expired safety certification on the day it expires leaves no
 * time to do anything about it.
 */
export function complianceStatus(
  enrolment: EnrolmentState,
  today: string,
  expiringSoonDays = 30
): ComplianceStatus {
  const base = { courseId: enrolment.courseId, employeeId: enrolment.employeeId };

  if (enrolment.state === "waived") {
    return { ...base, state: "waived", daysRemaining: null, detail: "Waived" };
  }
  if (enrolment.state === "failed") {
    return {
      ...base,
      state: "failed",
      daysRemaining: null,
      detail: "Failed with no attempts remaining",
    };
  }

  if (enrolment.state === "completed") {
    if (!enrolment.expiresOn) {
      return { ...base, state: "compliant", daysRemaining: null, detail: "Completed" };
    }

    const days = daysBetween(today, enrolment.expiresOn);
    if (days < 0) {
      return {
        ...base,
        state: "expired",
        daysRemaining: days,
        detail: `Expired ${Math.abs(days)} day${Math.abs(days) === 1 ? "" : "s"} ago`,
      };
    }
    if (days <= expiringSoonDays) {
      return {
        ...base,
        state: "expiring_soon",
        daysRemaining: days,
        detail: `Expires in ${days} day${days === 1 ? "" : "s"}`,
      };
    }
    return {
      ...base,
      state: "compliant",
      daysRemaining: days,
      detail: `Valid until ${enrolment.expiresOn}`,
    };
  }

  // Not yet complete.
  if (enrolment.dueOn) {
    const days = daysBetween(today, enrolment.dueOn);
    if (days < 0) {
      return {
        ...base,
        state: "overdue",
        daysRemaining: days,
        detail: `Overdue by ${Math.abs(days)} day${Math.abs(days) === 1 ? "" : "s"}`,
      };
    }
    return {
      ...base,
      state: enrolment.state === "in_progress" ? "in_progress" : "not_started",
      daysRemaining: days,
      detail: `Due in ${days} day${days === 1 ? "" : "s"}`,
    };
  }

  return {
    ...base,
    state: enrolment.state === "in_progress" ? "in_progress" : "not_started",
    daysRemaining: null,
    detail: enrolment.state === "in_progress" ? "In progress" : "Not started",
  };
}

/**
 * Which mandatory courses an employee is missing.
 *
 * An expired completion counts as missing: a certificate that has lapsed
 * provides no assurance, and treating it as done is how a lapse goes unnoticed
 * for a year.
 */
export function missingMandatory(
  courses: CourseDefinition[],
  employee: EmployeeProfile,
  enrolments: EnrolmentState[],
  today: string
): CourseDefinition[] {
  return courses.filter((course) => {
    if (!isMandatoryFor(course, employee)) return false;

    const enrolment = enrolments.find(
      (e) => e.courseId === course.id && e.employeeId === employee.id
    );
    if (!enrolment) return true;
    if (enrolment.state === "waived") return false;
    if (enrolment.state !== "completed") return false;

    return Boolean(enrolment.expiresOn && enrolment.expiresOn < today);
  });
}

// ─── Dates ───────────────────────────────────────────────────

export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) throw new Error("Dates must be YYYY-MM-DD");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Whole days from `from` to `to`; negative when `to` is in the past. */
export function daysBetween(from: string, to: string): number {
  const a = new Date(`${from}T00:00:00Z`).getTime();
  const b = new Date(`${to}T00:00:00Z`).getTime();
  if (Number.isNaN(a) || Number.isNaN(b)) throw new Error("Dates must be YYYY-MM-DD");
  return Math.round((b - a) / 86_400_000);
}
