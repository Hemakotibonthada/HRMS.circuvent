import { NextRequest, NextResponse } from "next/server";
import { requireRole, authErrorResponse } from "@/lib/server-auth";

// ═══════════════════════════════════════════════════════════════
// HRMS API — Payroll Operations
// Process payroll, generate payslips, tax calculations
// ═══════════════════════════════════════════════════════════════

export async function GET(request: NextRequest) {
  try {
    await requireRole(request, ["owner", "admin", "hr"]);
  } catch (e) {
    const { body, status } = authErrorResponse(e);
    return NextResponse.json(body, { status });
  }
  const { searchParams } = new URL(request.url);
  const month = parseInt(searchParams.get("month") || String(new Date().getMonth() + 1));
  const year = parseInt(searchParams.get("year") || String(new Date().getFullYear()));
  const employeeId = searchParams.get("employeeId");
  const status = searchParams.get("status");

  return NextResponse.json({
    data: [],
    summary: {
      month, year,
      totalEmployees: 0,
      totalGross: 0,
      totalDeductions: 0,
      totalNet: 0,
      processed: 0,
      pending: 0,
    },
    filters: { month, year, employeeId, status },
  });
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

    if (action === "process") {
      // Process payroll for a month
      const { month, year } = body;
      if (!month || !year) {
        return NextResponse.json({ error: "Month and year required" }, { status: 400 });
      }

      return NextResponse.json({
        message: `Payroll processing initiated for ${month}/${year}`,
        data: {
          month, year,
          status: "processing",
          initiatedAt: new Date().toISOString(),
          estimatedCompletion: new Date(Date.now() + 300000).toISOString(),
        },
      });
    }

    if (action === "generate_payslip") {
      const { employeeId, month, year } = body;
      if (!employeeId || !month || !year) {
        return NextResponse.json({ error: "employeeId, month, and year required" }, { status: 400 });
      }

      // Calculate salary components (sample)
      const basic = body.basic || 35000;
      const hra = Math.round(basic * 0.4);
      const conveyance = 3000;
      const special = Math.round(basic * 0.5);
      const medical = 2500;
      const bonus = body.bonus || 0;
      const gross = basic + hra + conveyance + special + medical + bonus;

      const pf = Math.round(basic * 0.12);
      const pt = 200;
      const tds = Math.round(gross * 0.1);
      const insurance = 1500;
      const loanEmi = body.loanEmi || 0;
      const totalDeductions = pf + pt + tds + insurance + loanEmi;
      const net = gross - totalDeductions;

      const payslip = {
        id: `PAY-${Date.now()}`,
        employeeId, month, year,
        earnings: { basic, hra, conveyance, special, medical, bonus },
        deductions: { pf, pt, tds, insurance, loanEmi },
        grossSalary: gross,
        totalDeductions,
        netSalary: net,
        status: "processed",
        generatedAt: new Date().toISOString(),
      };

      return NextResponse.json({ data: payslip, message: "Payslip generated" }, { status: 201 });
    }

    return NextResponse.json({ error: "Invalid action. Use 'process' or 'generate_payslip'" }, { status: 400 });
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
}
