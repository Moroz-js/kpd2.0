import { z } from "zod";

/** Опциональная дата (ISO / YYYY-MM-DD) или null. */
export const zNullableDateString = z
  .string()
  .nullable()
  .optional()
  .refine(
    (v) => v === undefined || v === null || v === "" || !Number.isNaN(Date.parse(v)),
    { message: "Некорректная дата" }
  );

/** YYYY-MM-DD → локальный полдень (без сдвига от UTC midnight). */
export function parseLocalDateInput(value: string): Date {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [y, m, d] = value.split("-").map(Number);
    return new Date(y, m - 1, d, 12, 0, 0, 0);
  }
  return new Date(value);
}
