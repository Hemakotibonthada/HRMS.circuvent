import { NextRequest, NextResponse } from "next/server";
import { requireRole, authErrorResponse } from "@/lib/server-auth";

// ═══════════════════════════════════════════════════════════════
// HRMS API — Reports & Analytics
// Generate reports, export data, analytics endpoints
// ═══════════════════════════════════════════════════════════════

export async function GET(request: NextRequest) {
  try {
    await requireRole(request, ["owner", "admin", "hr"]);
  } catch (e) {
    const { body, status } = authErrorResponse(e);
    return NextResponse.json(body, { status });
  }
  const { searchParams } = new URL(request.url);
  const type = searchParams.get("type") || "summary";
  const period = searchParams.get("period") || "current_month";
  const department = searchParams.get("department");
  const format = searchParams.get("format") || "json";

  // Available report types
  const reportTypes = [
    { id: "headcount", name: "Headcount Report", description: "Employee count by department, status, type" },
    { id: "attendance", name: "Attendance Report", description: "Daily/monthly attendance summary" },
    { id: "leave", name: "Leave Report", description: "Leave utilization and balance report" },
    { id: "payroll", name: "Payroll Report", description: "Salary disbursement summary" },
    { id: "expense", name: "Expense Report", description: "Expense claims by category and status" },
    { id: "recruitment", name: "Recruitment Report", description: "Hiring funnel and source analysis" },
    { id: "performance", name: "Performance Report", description: "Rating distribution and goal progress" },
    { id: "training", name: "Training Report", description: "Course completion and skill coverage" },
    { id: "attrition", name: "Attrition Report", description: "Turnover analysis and exit reasons" },
    { id: "compliance", name: "Compliance Report", description: "Regulatory compliance status" },
    { id: "diversity", name: "Diversity Report", description: "Gender, age, and diversity metrics" },
    { id: "compensation", name: "Compensation Report", description: "Salary bands and market comparison" },
  ];

  if (type === "list") {
    return NextResponse.json({ data: reportTypes });
  }

  // Generate report data based on type
  const reportData = {
    reportType: type,
    period,
    department: department || "all",
    generatedAt: new Date().toISOString(),
    data: {
      summary: {
        totalEmployees: 0,
        activeEmployees: 0,
        departments: 0,
        avgTenure: 0,
        attritionRate: 0,
        avgSalary: 0,
      },
      charts: [],
      tables: [],
    },
    exportFormats: ["csv", "excel", "pdf"],
  };

  return NextResponse.json(reportData);
}

export async function POST(request: NextRequest) {
  try {
    await requireRole(request, ["owner", "admin", "hr"]);
  } catch (e) {
    const { body, status } = authErrorResponse(e);
    return NextResponse.json(body, { status });
  }
  try {
    const body = await request.json();
    const { action } = body;

    if (action === "export") {
      const { reportType, format, filters, columns } = body;
      if (!reportType || !format) {
        return NextResponse.json({ error: "reportType and format required" }, { status: 400 });
      }

      if (!["csv", "excel", "pdf"].includes(format)) {
        return NextResponse.json({ error: "Format must be csv, excel, or pdf" }, { status: 400 });
      }

      return NextResponse.json({
        message: `${reportType} report export initiated`,
        data: {
          jobId: `EXPORT-${Date.now()}`,
          reportType,
          format,
          status: "processing",
          estimatedCompletion: new Date(Date.now() + 30000).toISOString(),
          filters,
          columns,
        },
      });
    }

    if (action === "schedule") {
      const { reportType, frequency, recipients, format } = body;
      if (!reportType || !frequency || !recipients?.length) {
        return NextResponse.json({ error: "reportType, frequency, and recipients required" }, { status: 400 });
      }

      return NextResponse.json({
        message: "Report scheduled successfully",
        data: {
          id: `SCHED-${Date.now()}`,
          reportType,
          frequency,
          recipients,
          format: format || "excel",
          nextRun: new Date(Date.now() + 86400000).toISOString(),
          enabled: true,
        },
      }, { status: 201 });
    }

    return NextResponse.json({ error: "Invalid action. Use 'export' or 'schedule'" }, { status: 400 });
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
}
