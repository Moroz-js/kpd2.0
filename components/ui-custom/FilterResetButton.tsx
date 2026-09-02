import { RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";

export function FilterResetButton({
  active,
  onClick,
}: {
  active: boolean;
  onClick: () => void;
}) {
  return (
    <Button
      type="button"
      size="sm"
      variant="outline"
      className="h-8 text-xs"
      disabled={!active}
      onClick={onClick}
    >
      <RotateCcw className="mr-1 h-3.5 w-3.5" />
      Снять фильтры
    </Button>
  );
}
