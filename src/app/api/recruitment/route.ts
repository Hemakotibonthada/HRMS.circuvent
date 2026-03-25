import { NextRequest, NextResponse } from "next/server";

// ═══════════════════════════════════════════════════════════════
// HRMS API — Recruitment & Hiring
// Job postings, candidate management, interview scheduling
// ═══════════════════════════════════════════════════════════════

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const type = searchParams.get("type") || "jobs"; // jobs | candidates | pipeline
  const status = searchParams.get("status");
  const jobId = searchParams.get("jobId");

  if (type === "pipeline") {
    return NextResponse.json({
      data: {
        stages: [
          { stage: "applied", count: 0 },
          { stage: "screening", count: 0 },
          { stage: "phone_screen", count: 0 },
          { stage: "technical", count: 0 },
          { stage: "culture_fit", count: 0 },
          { stage: "offer", count: 0 },
          { stage: "hired", count: 0 },
          { stage: "rejected", count: 0 },
        ],
        metrics: {
          totalApplications: 0,
          averageTimeToHire: 0,
          offerAcceptRate: 0,
          sourceBreakdown: {},
        },
      },
    });
  }

  return NextResponse.json({
    data: [],
    filters: { type, status, jobId },
  });
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { type } = body;

    if (type === "job") {
      const required = ["title", "department", "location", "experience", "description"];
      const missing = required.filter((f) => !body[f]);
      if (missing.length > 0) {
        return NextResponse.json({ error: `Missing: ${missing.join(", ")}` }, { status: 400 });
      }

      const job = {
        id: `JOB-${Date.now()}`,
        ...body,
        status: "open",
        applicantCount: 0,
        postedDate: new Date().toISOString().split("T")[0],
        createdAt: new Date().toISOString(),
      };

      return NextResponse.json({ data: job, message: "Job posted successfully" }, { status: 201 });
    }

    if (type === "candidate") {
      const required = ["jobId", "name", "email", "experience"];
      const missing = required.filter((f) => !body[f]);
      if (missing.length > 0) {
        return NextResponse.json({ error: `Missing: ${missing.join(", ")}` }, { status: 400 });
      }

      const candidate = {
        id: `CAND-${Date.now()}`,
        ...body,
        stage: "applied",
        rating: 0,
        appliedDate: new Date().toISOString().split("T")[0],
        createdAt: new Date().toISOString(),
      };

      return NextResponse.json({ data: candidate, message: "Candidate added" }, { status: 201 });
    }

    if (type === "schedule_interview") {
      const required = ["candidateId", "interviewerId", "date", "time", "stage"];
      const missing = required.filter((f) => !body[f]);
      if (missing.length > 0) {
        return NextResponse.json({ error: `Missing: ${missing.join(", ")}` }, { status: 400 });
      }

      const interview = {
        id: `INT-${Date.now()}`,
        ...body,
        duration: body.duration || "45 min",
        type: body.interviewType || "video",
        status: "scheduled",
        createdAt: new Date().toISOString(),
      };

      return NextResponse.json({ data: interview, message: "Interview scheduled" }, { status: 201 });
    }

    if (type === "advance_stage") {
      const { candidateId, newStage, feedback } = body;
      if (!candidateId || !newStage) {
        return NextResponse.json({ error: "candidateId and newStage required" }, { status: 400 });
      }

      return NextResponse.json({
        data: { candidateId, stage: newStage, feedback, updatedAt: new Date().toISOString() },
        message: `Candidate moved to ${newStage}`,
      });
    }

    return NextResponse.json({ error: "Invalid type" }, { status: 400 });
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
}
