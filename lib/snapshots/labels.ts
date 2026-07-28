export type SnapshotOption = {
  id: string;
  businessDate: string;
  cutoffAt: string;
};

const SNAPSHOT_DATE_TIME = new Intl.DateTimeFormat("ru-RU", {
  timeZone: "Europe/Moscow",
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});
const SNAPSHOT_DATE_TIME_WITH_SECONDS = new Intl.DateTimeFormat("ru-RU", {
  timeZone: "Europe/Moscow",
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

export function snapshotLabel(snapshot: SnapshotOption): string {
  return SNAPSHOT_DATE_TIME.format(new Date(snapshot.cutoffAt));
}

export function snapshotOptionLabel(
  snapshot: SnapshotOption,
  snapshots: SnapshotOption[]
): string {
  const label = snapshotLabel(snapshot);
  const sameMinute = snapshots.filter((item) => snapshotLabel(item) === label);
  return sameMinute.length > 1
    ? SNAPSHOT_DATE_TIME_WITH_SECONDS.format(new Date(snapshot.cutoffAt))
    : label;
}

export function snapshotSourceLabel(
  source: string,
  snapshots: SnapshotOption[]
): string {
  if (source === "live") return "Актуальные данные";
  const snapshot = snapshots.find((item) => item.id === source);
  return snapshot ? snapshotOptionLabel(snapshot, snapshots) : "Загрузка снимка…";
}
