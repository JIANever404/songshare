"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ShareImagePreviewDialog } from "@/components/share/ShareImagePreviewDialog";
import { Button } from "@/components/ui/button";
import { SubjectKind, getSubjectKindShareTitle } from "@/lib/subject-kind";
import { ShareGame } from "@/lib/share/types";
import { generateEnhancedShareImageBlob } from "@/utils/image/exportShareImage";

type NoticeKind = "success" | "error" | "info";

interface SharePlatformActionsProps {
  kind: SubjectKind;
  shareId: string | null;
  games: Array<ShareGame | null>;
  creatorName?: string | null;
  shareMessage?: string | null;
  onResolveShareId?: () => Promise<string | null>;
  onNotice?: (kind: NoticeKind, message: string) => void;
}

type ShareImagePreviewState = {
  url: string;
  blob: Blob;
};

async function copyText(value: string) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }

  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();
  document.execCommand("copy");
  document.body.removeChild(textarea);
}

function blobToDataUrl(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    if (typeof FileReader === "undefined") {
      reject(new Error("FileReader unavailable"));
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        resolve(reader.result);
        return;
      }
      reject(new Error("Invalid data URL result"));
    };
    reader.onerror = () => reject(reader.error || new Error("Failed to read blob"));
    reader.readAsDataURL(blob);
  });
}

async function preloadPreviewImage(url: string) {
  if (typeof Image === "undefined") return;

  const image = new Image();
  image.decoding = "async";
  image.src = url;

  if (typeof image.decode === "function") {
    try {
      await image.decode();
      return;
    } catch {
      // fall through to onload
    }
  }

  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error("Failed to preload preview image"));
  });
}

export function SharePlatformActions({
  kind,
  shareId,
  games,
  creatorName,
  shareMessage,
  onResolveShareId,
  onNotice,
}: SharePlatformActionsProps) {
  const [previewOpen, setPreviewOpen] = useState(false);
  const [resolvedShareId, setResolvedShareId] = useState<string | null>(shareId);
  const [generatingAction, setGeneratingAction] = useState<"image" | "link" | null>(null);
  const [linkCopied, setLinkCopied] = useState(false);
  const [linkCopyPulse, setLinkCopyPulse] = useState(false);
  const [imagePreview, setImagePreview] = useState<ShareImagePreviewState | null>(null);
  const linkCopyPulseTimerRef = useRef<number | null>(null);
  const selectedCount = useMemo(() => games.filter((game) => Boolean(game)).length, [games]);
  const activeShareId = shareId ?? resolvedShareId;

  useEffect(() => {
    setResolvedShareId(shareId);
    if (!shareId) {
      setPreviewOpen(false);
      setLinkCopied(false);
      setLinkCopyPulse(false);
      setImagePreview(null);
    }
  }, [shareId]);

  useEffect(
    () => () => {
      if (linkCopyPulseTimerRef.current !== null) {
        window.clearTimeout(linkCopyPulseTimerRef.current);
      }
    },
    []
  );

  const shareTitle = useMemo(() => {
    return getSubjectKindShareTitle(kind, {
      creatorName,
      selectedCount,
    });
  }, [creatorName, kind, selectedCount]);

  function handleNotice(kindValue: NoticeKind, message: string) {
    onNotice?.(kindValue, message);
  }

  function triggerLinkCopyPulse() {
    setLinkCopyPulse(false);
    if (linkCopyPulseTimerRef.current !== null) {
      window.clearTimeout(linkCopyPulseTimerRef.current);
    }

    window.requestAnimationFrame(() => {
      setLinkCopyPulse(true);
      linkCopyPulseTimerRef.current = window.setTimeout(() => {
        setLinkCopyPulse(false);
        linkCopyPulseTimerRef.current = null;
      }, 240);
    });
  }

  async function resolveShareId() {
    if (activeShareId) return activeShareId;
    if (!onResolveShareId) return null;
    const nextShareId = await onResolveShareId();
    if (!nextShareId) return null;
    setResolvedShareId(nextShareId);
    return nextShareId;
  }

  const disabled = selectedCount === 0 || generatingAction !== null || (!activeShareId && !onResolveShareId);

  const baseClass =
    "inline-flex items-center justify-center gap-2 rounded-full border border-border/80 bg-card/70 px-6 py-3 font-bold text-card-foreground shadow-[inset_0_1px_0_rgba(255,255,255,0.32)] backdrop-blur-sm transition-all hover:-translate-y-0.5 hover:bg-accent/80 hover:text-accent-foreground disabled:cursor-not-allowed disabled:opacity-45";

  return (
    <div className="grid w-full max-w-[42rem] grid-cols-1 gap-3 sm:grid-cols-2">
      <Button
        variant="default"
        className="order-1 inline-flex items-center justify-center gap-2 rounded-full bg-[linear-gradient(135deg,#ff8f58,#ff6d48_56%,#ffbe63)] px-6 py-3 font-bold text-white shadow-[0_24px_45px_-28px_rgba(255,122,68,0.95)] transition-all hover:-translate-y-0.5 hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-45 sm:order-2"
        data-testid="share-generate-image"
        disabled={disabled}
        onClick={async () => {
          setGeneratingAction("image");
          try {
            const nextShareId = await resolveShareId();
            if (!nextShareId) return;
            const blob = await generateEnhancedShareImageBlob({
              kind,
              shareId: nextShareId,
              title: shareTitle,
              games,
              creatorName,
              shareMessage,
              showNames: true,
            });
            const url = await blobToDataUrl(blob);
            await preloadPreviewImage(url);
            setImagePreview({ url, blob });
            setPreviewOpen(true);
          } catch {
            handleNotice("error", "分享图片生成失败，请稍后重试");
          } finally {
            setGeneratingAction(null);
          }
        }}
      >
        {generatingAction === "image" ? "生成中..." : "生成分享图片"}
      </Button>

      <Button
        variant="outline"
        className={`${baseClass} order-2 sm:order-1`}
        data-testid="share-generate-link"
        disabled={disabled}
        onClick={async () => {
          setGeneratingAction("link");
          try {
            const nextShareId = await resolveShareId();
            if (!nextShareId) return;
            if (typeof window === "undefined") return;
            const nextShareUrl = `${window.location.origin}/${kind}/s/${nextShareId}`;
            await copyText(nextShareUrl);
            setLinkCopied(true);
            triggerLinkCopyPulse();
            handleNotice("success", "已生成并复制分享链接");
          } catch {
            setLinkCopied(false);
            handleNotice("error", "生成分享链接失败，请稍后重试");
          } finally {
            setGeneratingAction(null);
          }
        }}
      >
        <span
          className={
            linkCopyPulse
              ? "animate-[copy-pop_240ms_cubic-bezier(0.22,1,0.36,1)]"
              : undefined
          }
        >
          {generatingAction === "link"
            ? "生成中..."
            : linkCopied
              ? "已复制到剪贴板"
              : "生成分享链接"}
        </span>
      </Button>

      {activeShareId && previewOpen ? (
        <ShareImagePreviewDialog
          open={previewOpen}
          onOpenChange={(open) => {
            setPreviewOpen(open);
            if (!open) {
              setImagePreview(null);
            }
          }}
          kind={kind}
          shareId={activeShareId}
          title={shareTitle}
          games={games}
          creatorName={creatorName}
          shareMessage={shareMessage}
          initialPreviewUrl={imagePreview?.url ?? null}
          initialPreviewBlob={imagePreview?.blob ?? null}
          onNotice={handleNotice}
        />
      ) : null}
    </div>
  );
}
