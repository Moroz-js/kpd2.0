import "server-only";

// scripts/snapshot-worker.mjs is a plain JS module reused as-is by the manual
// snapshot API route (single source of truth for snapshot creation, no
// spawn/shell). TypeScript can't infer a precise discriminated return type
// from a .mjs file, so we re-type the boundary explicitly here.
import { createSnapshot as createSnapshotImpl } from "@/scripts/snapshot-worker.mjs";

export type ManualSnapshotRun = {
  id: string;
  businessDate: Date;
  cutoffAt: Date;
  startedAt: Date;
  completedAt: Date | null;
  status: string;
  runKind: string;
  scheduleKey: string | null;
};

export type ManualSnapshotResult =
  | { busy: false; run: ManualSnapshotRun }
  | { busy: true; run: null };

type CreateSnapshotFn = (options?: {
  manual?: boolean;
  businessDate?: string | null;
}) => Promise<ManualSnapshotRun | { busy: true } | undefined>;

const createSnapshot = createSnapshotImpl as CreateSnapshotFn;

export async function createManualSnapshot(): Promise<ManualSnapshotResult> {
  const run = await createSnapshot({ manual: true });
  if (!run || !("id" in run)) {
    return { busy: true, run: null };
  }
  return { busy: false, run };
}
