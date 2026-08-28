// GET /api/me/documents/[id]/file — download an HR-uploaded employee document from R2.

import { NextResponse, type NextRequest } from "next/server";
import { and, eq } from "drizzle-orm";

import { withTenant } from "@/db/client";
import { employeeDocuments } from "@/db/schema";
import { authErrorResponse } from "@/lib/server-auth";
import { requireApiContext } from "@/lib/api-context";
import { currentEmployeeId } from "@/lib/current-employee";
import { getObjectBytes, StorageConfigError, StorageRequestError } from "@/lib/storage/object-store";

function safeFilename(name: string): string {
  const cleaned = name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9 _.-]/g, "")
    .trim()
    .slice(0, 80);
  return cleaned.length > 0 ? cleaned : "document";
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  let ctx;
  try {
    ctx = await requireApiContext(request);
  } catch (e) {
    const { body, status } = authErrorResponse(e);
    return NextResponse.json(body, { status });
  }

  const { id } = await params;

  try {
    const file = await withTenant(ctx, async (tx) => {
      const self = await currentEmployeeId(ctx, tx);
      if (!self) return null;

      const [row] = await tx
        .select({
          employeeId: employeeDocuments.employeeId,
          name: employeeDocuments.name,
          blobUrl: employeeDocuments.blobUrl,
          mimeType: employeeDocuments.mimeType,
        })
        .from(employeeDocuments)
        .where(and(eq(employeeDocuments.orgId, ctx.orgId), eq(employeeDocuments.id, id)))
        .limit(1);

      if (!row || row.employeeId !== self || !row.blobUrl) return null;
      return row;
    });

    if (!file) {
      return NextResponse.json({ error: "Document not found" }, { status: 404 });
    }

    const bytes = await getObjectBytes(file.blobUrl);
    return new NextResponse(bytes.slice(), {
      headers: {
        "Content-Type": file.mimeType || "application/octet-stream",
        "Content-Disposition": `attachment; filename="${safeFilename(file.name)}"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error) {
    if (error instanceof StorageConfigError || error instanceof StorageRequestError) {
      return NextResponse.json({ error: error.message }, { status: 503 });
    }
    console.error("Employee document download failed:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
