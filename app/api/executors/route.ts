import { NextResponse } from "next/server";
import { z } from "zod";
import { getSessionUser } from "@/lib/auth";
import { canManageExecutors, canViewExecutorsList, isAdmin } from "@/lib/permissions";
import {
  createExecutor,
  listExecutors,
  type CreateExecutorInput,
} from "@/lib/services/executors";

export async function GET() {
  const me = await getSessionUser();
  if (!me) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!canViewExecutorsList(me)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  return NextResponse.json(await listExecutors());
}

const permanentSchema = z.object({
  type: z.literal("permanent"),
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  contactEmail: z.string().email("Некорректный контактный email").nullable().optional(),
  contacts: z.string().nullable().optional(),
  accessEmail: z.string().email("Некорректный email для доступа").nullable().optional(),
  password: z.string().optional(),
  companyStatus: z.string().nullable().optional(),
  responsibleUserId: z.string().nullable().optional(),
  specialty: z.string().nullable().optional(),
  defaultBankAccountId: z.string().nullable().optional(),
  recipientTypes: z.array(z.string()).optional(),
  recipientType: z.string().nullable().optional(),
});

const namedSchema = z.object({
  type: z.enum(["external", "service", "bank"]),
  name: z.string().min(1),
  contactEmail: z.string().email("Некорректный контактный email").nullable().optional(),
  contacts: z.string().nullable().optional(),
  accessEmail: z.string().email("Некорректный email для доступа").nullable().optional(),
  password: z.string().optional(),
  responsibleUserId: z.string().nullable().optional(),
  recipientTypes: z.array(z.string()).optional(),
  recipientType: z.string().nullable().optional(),
  defaultBankAccountId: z.string().nullable().optional(),
});

const createSchema = z.union([permanentSchema, namedSchema]);

export async function POST(req: Request) {
  const me = await getSessionUser();
  if (!me) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!canManageExecutors(me)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await req.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation", details: parsed.error.flatten() },
      { status: 400 }
    );
  }
  try {
    if (parsed.data.accessEmail && (!parsed.data.password || parsed.data.password.length < 6)) {
      return NextResponse.json({ error: "Пароль не короче 6 символов" }, { status: 400 });
    }
    const data: CreateExecutorInput = isAdmin(me)
      ? parsed.data
      : { ...parsed.data, accessEmail: null, password: undefined };
    const created = await createExecutor(data, me.id);
    return NextResponse.json(created, { status: 201 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Error";
    if (msg.includes("Unique constraint")) {
      return NextResponse.json({ error: "Email уже занят" }, { status: 409 });
    }
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
