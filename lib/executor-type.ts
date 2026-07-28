import { EXECUTOR_TYPES, type ExecutorType } from "@/lib/statuses";

export const EXECUTOR_TYPE_OPTIONS = Object.entries(EXECUTOR_TYPES) as [ExecutorType, string][];

/** legacy: external-person / external-legal → external */
export function normalizeExecutorType(type: string): ExecutorType {
  if (type === "external-person" || type === "external-legal") return "external";
  if (type in EXECUTOR_TYPES) return type as ExecutorType;
  return "permanent";
}

export function canBeResponsible(type: string): boolean {
  return normalizeExecutorType(type) === "permanent";
}

export function formatNameForExecutorType(type: ExecutorType, raw: string): string {
  const t = raw.trim();
  if (type === "service") return t.toUpperCase();
  return t;
}
