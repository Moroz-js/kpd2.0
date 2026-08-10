export type NumberedProjectType = "internal" | "client";

export function isNumberedProjectType(
  type: string
): type is NumberedProjectType {
  return type === "internal" || type === "client";
}

export function formatProjectNumber(
  type: NumberedProjectType,
  serial: number
): string {
  if (!Number.isInteger(serial) || serial < 1) {
    throw new Error("Порядковый номер проекта должен быть положительным целым");
  }
  const prefix = type === "internal" ? "ПВ" : "ПК";
  return `${prefix}.${String(serial).padStart(3, "0")}`;
}
