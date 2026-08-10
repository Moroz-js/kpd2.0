const UNKNOWN_EXECUTOR_NAME =
  /^пока\s+не\s+(?:извест(?:ен|на|но)|определ(?:е|ё)н(?:а|о)?)$/iu;

function normalizeExecutorName(name: string): string {
  return name
    .trim()
    .toLocaleLowerCase("ru-RU")
    .replace(/[«»"'()[\]{}.,:;!?—–-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Служебные исполнители «Пока не известен/определен» и варианты написания. */
export function isUnknownExecutorName(name: string): boolean {
  return UNKNOWN_EXECUTOR_NAME.test(normalizeExecutorName(name));
}

/** Служебный неизвестный исполнитель всегда первый, остальные — по русскому алфавиту. */
export function compareExecutorNames(a: string, b: string): number {
  const aUnknown = isUnknownExecutorName(a);
  const bUnknown = isUnknownExecutorName(b);
  if (aUnknown !== bUnknown) return aUnknown ? -1 : 1;
  return a.localeCompare(b, "ru");
}
