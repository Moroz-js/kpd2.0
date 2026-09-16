import { NextResponse } from "next/server";
import { z } from "zod";
import { getSessionUser } from "@/lib/auth";
import { isAdmin } from "@/lib/permissions";
import {
  createCounterparty,
  listCounterparties,
  listCounterpartyOptions,
} from "@/lib/services/counterparties";
import {
  COUNTERPARTY_LEGAL_TYPES,
  COUNTERPARTY_PAYMENT_METHODS,
  COUNTERPARTY_ALIAS_SOURCES,
} from "@/lib/statuses";
import { inferPaymentMethod } from "@/lib/counterparty-requisites";

export async function GET(req: Request) {
  const me = await getSessionUser();
  if (!me) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);

  // Короткий список для выбора контрагента в операции доступен всем ролям,
  // полный справочник с реквизитами — только админу.
  if (searchParams.get("view") === "options") {
    return NextResponse.json(await listCounterpartyOptions());
  }

  if (!isAdmin(me)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  return NextResponse.json(
    await listCounterparties({
      executorId: searchParams.get("executorId") ?? undefined,
      clientId: searchParams.get("clientId") ?? undefined,
      bankAccountId: searchParams.get("bankAccountId") ?? undefined,
    })
  );
}

const paymentMethodSchema = z.enum(
  Object.keys(COUNTERPARTY_PAYMENT_METHODS) as [string, ...string[]]
);

const requisiteSchema = z
  .object({
    paymentMethod: paymentMethodSchema.optional(),
    taxId: z.string().nullable().optional(),
    bic: z.string().nullable().optional(),
    bankName: z.string().nullable().optional(),
    accountNumber: z.string().nullable().optional(),
    cardNumber: z.string().nullable().optional(),
    status: z.enum(["active", "archived"]).optional(),
    comment: z.string().nullable().optional(),
  })
  .transform((row) => ({
    ...row,
    paymentMethod: row.paymentMethod ?? inferPaymentMethod(row),
  }));

const createSchema = z.object({
  name: z.string().min(1, "Введите название контрагента"),
  legalType: z
    .enum(Object.keys(COUNTERPARTY_LEGAL_TYPES) as [string, ...string[]])
    .nullable()
    .optional(),
  comment: z.string().nullable().optional(),
  uniqueProjectId: z.string().nullable().optional(),
  uniqueWorkTypeId: z.string().nullable().optional(),
  executorId: z.string().nullable().optional(),
  clientId: z.string().nullable().optional(),
  bankAccountId: z.string().nullable().optional(),
  requisites: z.array(requisiteSchema).optional(),
  aliases: z
    .array(
      z.object({
        value: z.string().min(1),
        source: z.enum(Object.keys(COUNTERPARTY_ALIAS_SOURCES) as [string, ...string[]]).optional(),
      })
    )
    .optional(),
});

export async function POST(req: Request) {
  const me = await getSessionUser();
  if (!me) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isAdmin(me)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await req.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation", details: parsed.error.flatten() },
      { status: 422 }
    );
  }

  try {
    const created = await createCounterparty(parsed.data, me.id);
    return NextResponse.json(created, { status: 201 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Error";
    if (msg.includes("Unique constraint")) {
      return NextResponse.json(
        { error: "Контрагент с таким названием уже существует" },
        { status: 409 }
      );
    }
    if (msg.startsWith("Нельзя") || msg.startsWith("У контрагента")) {
      return NextResponse.json({ error: msg }, { status: 400 });
    }
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
