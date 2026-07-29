import { Loader2 } from "lucide-react";

export default function DashboardLoading() {
  return (
    <div className="flex min-h-[50vh] flex-1 items-center justify-center">
      <div className="flex items-center gap-2 text-sm text-neutral-500">
        <Loader2 className="h-5 w-5 animate-spin" />
        Загрузка…
      </div>
    </div>
  );
}
