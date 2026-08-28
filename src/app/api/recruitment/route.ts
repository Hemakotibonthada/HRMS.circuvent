// ═══════════════════════════════════════════════════════════════
// GET/POST/PATCH /api/recruitment
// ═══════════════════════════════════════════════════════════════
// This route was a fake, in the same way `/api/expenses` was. `GET` returned
// `data: []` and a pipeline of hardcoded zeroes. `POST` reported "Job posted
// successfully", "Candidate added" and "Interview scheduled" — all 201, none
// of them writing anything. `PATCH` moved a candidate to a new stage and
// persisted nothing.
//
// A recruiter posted a role and it did not exist. A candidate was added and
// vanished. An interview was "scheduled" and nobody was told.
//
// Everything needed was already built: `hrms.job_postings`, `candidates`,
// `applications` and `interviews`, plus `NeonAtsRepository` with duplicate
// detection, stage rules, scorecards, offers and funnel reporting. This route
// now delegates to it rather than pretending.
//
// The `type` switch is kept because the dashboard sends it. It is a thin
// dispatch over the repository, not a second implementation.

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { NeonAtsRepository } from "@/db/repositories/ats.neon";
import { NotFoundError, RepositoryError } from "@/db/repositories/types";
import { authErrorResponse } from "@/lib/server-auth";
import { requireApiContext } from "@/lib/api-context";

const READ_ROLES = ["owner", "admin", "hr", "manager", "employee"] as const;
const WRITE_ROLES = ["owner", "admin", "hr"] as const;

function fail(error: unknown) {
  if (error instanceof NotFoundError) {
    return NextResponse.json({ error: error.message }, { status: 404 });
  }
  if (error instanceof RepositoryError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }
  console.error("Recruitment API failure:", error);
  return NextResponse.json({ error: "Internal server error" }, { status: 500 });
}

export async function GET(request: NextRequest) {
  let ctx;
  try {
    ctx = await requireApiContext(request, [...READ_ROLES]);
  } catch (e) {
    const { body, status } = authErrorResponse(e);
    return NextResponse.json(body, { status });
  }

  const { searchParams } = new URL(request.url);
  const type = searchParams.get("type") ?? "jobs";
  const status = searchParams.get("status") ?? undefined;
  const jobId = searchParams.get("jobId") ?? undefined;
  const limit = Number(searchParams.get("limit") ?? searchParams.get("pageSize") ?? 50);

  try {
    const repo = new NeonAtsRepository(ctx);

    if (type === "pipeline") {
      // Real counts, from real applications. These were eight hardcoded zeroes
      // — a funnel chart that always showed an empty pipeline, on a page whose
      // whole purpose is to show the pipeline.
      const [funnel, timeToHire, sources] = await Promise.all([
        repo.funnelFor(jobId),
        repo.timeToHireFor(jobId),
        repo.sourceReport(),
      ]);

      return NextResponse.json({ data: { stages: funnel, metrics: { timeToHire, sources } } });
    }

    if (type === "candidates") {
      const page = await repo.listApplications({
        jobId,
        status,
        pageSize: Number.isFinite(limit) ? limit : 50,
      });
      return NextResponse.json({ data: page.items, items: page.items, pagination: page });
    }

    if (type === "interviews") {
      const items = await repo.listInterviews({
        applicationId: searchParams.get("applicationId") ?? undefined,
        status,
        from: searchParams.get("from") ?? undefined,
        to: searchParams.get("to") ?? undefined,
      });
      return NextResponse.json({ data: items, items });
    }

    const page = await repo.listJobs({
      status,
      pageSize: Number.isFinite(limit) ? limit : 50,
    });
    return NextResponse.json({ data: page.items, items: page.items, pagination: page });
  } catch (error) {
    return fail(error);
  }
}

const jobSchema = z.object({
  type: z.literal("job"),
  title: z.string().trim().min(1, "A job needs a title").max(200),
  departmentId: z.string().uuid().optional(),
  locationId: z.string().uuid().optional(),
  employmentType: z
    .enum(["full_time", "part_time", "contract", "intern", "consultant"])
    .optional(),
  experienceMinYears: z.number().int().min(0).max(60).optional(),
  experienceMaxYears: z.number().int().min(0).max(60).optional(),
  // Strings, because these are exact minor units and a JSON number is a double.
  salaryMinMinor: z.string().regex(/^\d+$/).optional(),
  salaryMaxMinor: z.string().regex(/^\d+$/).optional(),
  description: z.string().trim().max(20_000).optional(),
  requirements: z.array(z.string().trim().max(500)).max(50).optional(),
  skills: z.array(z.string().trim().max(100)).max(50).optional(),
  openings: z.number().int().min(1).max(1000).optional(),
  hiringManagerId: z.string().uuid().optional(),
  recruiterId: z.string().uuid().optional(),
  closesOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

const candidateSchema = z.object({
  type: z.literal("candidate"),
  jobId: z.string().uuid(),
  firstName: z.string().trim().min(1).max(120),
  lastName: z.string().trim().min(1).max(120),
  email: z.string().trim().email().max(320),
  phone: z.string().trim().max(40).optional(),
  source: z.string().trim().max(80).optional(),
  resumeUrl: z.string().url().optional(),
});

const interviewSchema = z.object({
  type: z.literal("interview"),
  applicationId: z.string().uuid(),
  scheduledAt: z.string().datetime({ offset: true }),
  round: z.number().int().min(1).max(20).optional(),
  interviewType: z.string().trim().max(64).optional(),
  durationMinutes: z.number().int().min(5).max(600).optional(),
  meetingUrl: z.string().url().optional(),
  panelistIds: z.array(z.string().uuid()).max(20).optional(),
});

const postSchema = z.discriminatedUnion("type", [jobSchema, candidateSchema, interviewSchema]);

export async function POST(request: NextRequest) {
  let ctx;
  try {
    ctx = await requireApiContext(request, [...WRITE_ROLES]);
  } catch (e) {
    const { body, status } = authErrorResponse(e);
    return NextResponse.json(body, { status });
  }

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: "Request body is not valid JSON" }, { status: 400 });
  }

  const parsed = postSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") },
      { status: 400 }
    );
  }

  try {
    const repo = new NeonAtsRepository(ctx);

    if (parsed.data.type === "job") {
      const { type: _type, ...input } = parsed.data;
      return NextResponse.json(
        { data: await repo.createJob(input), message: "Job posted" },
        { status: 201 }
      );
    }

    if (parsed.data.type === "candidate") {
      const { type: _type, ...input } = parsed.data;
      // `apply` reports a repeat applicant rather than blocking one — people
      // legitimately reapply — so the duplicate flag is passed through for the
      // recruiter to see.
      const result = await repo.apply(input);
      return NextResponse.json({ data: result, message: "Candidate added" }, { status: 201 });
    }

    const { type: _type, ...input } = parsed.data;
    return NextResponse.json(
      { data: await repo.scheduleInterview(input), message: "Interview scheduled" },
      { status: 201 }
    );
  } catch (error) {
    return fail(error);
  }
}

const patchSchema = z.union([
  z.object({
    applicationId: z.string().uuid(),
    action: z.literal("advance"),
    /** Omit to move to the next stage in sequence. */
    toStageId: z.string().uuid().optional(),
  }),
  z.object({
    applicationId: z.string().uuid(),
    action: z.literal("reject"),
    reason: z.string().trim().min(3, "A reason is required when rejecting").max(2000),
  }),
  z.object({
    jobId: z.string().uuid(),
    action: z.literal("job_status"),
    status: z.enum(["draft", "open", "paused", "closed"]),
  }),
  z.object({
    interviewId: z.string().uuid(),
    action: z.literal("interview_outcome"),
    status: z.string().trim().min(1).max(40),
    overallRating: z.number().int().min(1).max(5).optional(),
    recommendation: z.string().trim().max(2000).optional(),
  }),
]);

export async function PATCH(request: NextRequest) {
  let ctx;
  try {
    ctx = await requireApiContext(request, [...WRITE_ROLES]);
  } catch (e) {
    const { body, status } = authErrorResponse(e);
    return NextResponse.json(body, { status });
  }

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: "Request body is not valid JSON" }, { status: 400 });
  }

  const parsed = patchSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid request" },
      { status: 400 }
    );
  }

  try {
    const repo = new NeonAtsRepository(ctx);
    const body = parsed.data;

    if (body.action === "advance") {
      // `advance(applicationId, actorId, toStageId?)`. The stage is optional
      // in the repository — omitting it moves to the next one in sequence.
      return NextResponse.json(
        await repo.advance(body.applicationId, ctx.userId, body.toStageId)
      );
    }

    if (body.action === "reject") {
      return NextResponse.json(
        await repo.reject(body.applicationId, ctx.userId, body.reason)
      );
    }

    if (body.action === "job_status") {
      return NextResponse.json(await repo.setJobStatus(body.jobId, body.status));
    }

    return NextResponse.json(
      await repo.recordInterviewOutcome(body.interviewId, {
        status: body.status,
        overallRating: body.overallRating,
        recommendation: body.recommendation,
      })
    );
  } catch (error) {
    return fail(error);
  }
}
