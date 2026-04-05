"use client";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface ActionClusterProps {
  filledCount: number;
  readOnly: boolean;
  saving: boolean;
  onSave: () => void;
}

function saveButtonLabel(params: { saving: boolean; filledCount: number }) {
  const { saving, filledCount } = params;
  if (saving) return "处理中...";
  if (filledCount === 0) return "先选一首歌";
  return "生成分享页";
}

export function ActionCluster({
  filledCount,
  readOnly,
  saving,
  onSave,
}: ActionClusterProps) {
  const showEditActions = !readOnly;
  const saveDisabled = saving || filledCount === 0;

  return (
    <section className="flex w-full flex-col items-center">
      {showEditActions ? (
        <div className="w-full max-w-[42rem] space-y-3">
          <Button
            type="button"
            className={cn(
              "inline-flex w-full items-center justify-center gap-2 whitespace-nowrap bg-[linear-gradient(135deg,#ff8f58,#ff6d48_56%,#ffbe63)] px-4 py-3 text-sm font-bold text-white shadow-[0_24px_45px_-28px_rgba(255,122,68,0.95)] transition-all hover:-translate-y-0.5 hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-45",
              saveDisabled && "cursor-not-allowed opacity-45 hover:translate-y-0 hover:brightness-100"
            )}
            disabled={saveDisabled}
            onClick={onSave}
          >
            {saveButtonLabel({ saving, filledCount })}
          </Button>
        </div>
      ) : null}
    </section>
  );
}
