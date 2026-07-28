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
