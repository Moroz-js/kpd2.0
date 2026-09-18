import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { isAdmin } from "@/lib/permissions";
import { buildExportWorkbook } from "@/lib/services/excel-export";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET() {
  const me = await getSessionUser();
  if (!me) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isAdmin(me)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const buffer = await buildExportWorkbook();
  const date = new Date().toISOString().slice(0, 10);
  const filename = `Кэшфлоу_${date}.xlsx`;

  return new NextResponse(new Uint8Array(buffer), {
    status: 200,
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="cashflow.xlsx"; filename*=UTF-8''${encodeURIComponent(filename)}`,
    },
  });
}
