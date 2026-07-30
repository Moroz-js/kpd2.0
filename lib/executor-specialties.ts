import { WORK_TYPE_SEGMENTS } from "@/lib/statuses";

const SEGMENT_SET = new Set<string>(WORK_TYPE_SEGMENTS);

/** Разбор specialties (JSON) с fallback на legacy-поле specialty из Excel. */
export function parseExecutorSpecialties(
  specialtiesJson: string | null | undefined,
  specialtyLegacy?: string | null
): string[] {
  try {
    const parsed = JSON.parse(specialtiesJson ?? "[]") as unknown;
    if (Array.isArray(parsed) && parsed.length > 0) {
      return parsed.filter(
        (s): s is string => typeof s === "string" && SEGMENT_SET.has(s)
      );
    }
  } catch {
    /* ignore */
  }
  if (!specialtyLegacy?.trim()) return [];
  return specialtyLegacy
    .split(/[,;]/)
    .map((s) => s.trim())
    .filter((s) => SEGMENT_SET.has(s));
}

export function specialtiesLabel(
  specialtiesJson: string | null | undefined,
  specialtyLegacy?: string | null
): string {
  const segments = parseExecutorSpecialties(specialtiesJson, specialtyLegacy);
  if (segments.length) return segments.join(", ");
  return specialtyLegacy?.trim() || "";
}
