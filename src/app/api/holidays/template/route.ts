import { NextResponse, type NextRequest } from "next/server";
import { requireApiContext } from "@/lib/api-context";
import { authErrorResponse } from "@/lib/server-auth";
import { generateHolidayTemplateCsv, generateHolidayTemplateXlsx } from "@/lib/holiday-import";

export async function GET(request: NextRequest) {
  try {
    await requireApiContext(request, ["owner", "admin", "hr"]);
  } catch (e) {
    const { body, status } = authErrorResponse(e);
    return NextResponse.json(body, { status });
  }

  const { searchParams } = new URL(request.url);
  const format = searchParams.get("format")?.toLowerCase() === "csv" ? "csv" : "xlsx";

  if (format === "csv") {
    const csv = generateHolidayTemplateCsv();
    return new NextResponse(csv, {
      status: 200,
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": 'attachment; filename="holiday-calendar-template.csv"',
      },
    });
  }

  const buffer = generateHolidayTemplateXlsx();
  return new NextResponse(new Uint8Array(buffer), {
    status: 200,
    headers: {
      "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "content-disposition": 'attachment; filename="holiday-calendar-template.xlsx"',
    },
  });
}
