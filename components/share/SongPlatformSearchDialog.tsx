"use client";

import Image from "next/image";
import { createPortal } from "react-dom";
import { useState } from "react";
import { ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { buildSongPlatformAppSearchUrl, buildSongPlatformSearchUrl, SongPlatform } from "@/lib/song-share";
import { ShareGame } from "@/lib/share/types";

interface SongPlatformSearchDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  game: ShareGame | null;
  onBeforePlatformOpen?: () => void;
}

function displayName(game: ShareGame) {
  return game.localizedName?.trim() || game.name;
}

type OpenTargetOptions = {
  webUrl: string;
  appUrl?: string | null;
};

function openTarget({ webUrl, appUrl }: OpenTargetOptions) {
  if (typeof window === "undefined") {
    return;
  }

  if (!appUrl || appUrl === webUrl) {
    window.location.href = webUrl;
    return;
  }

  let appOpened = false;
  const handleVisibilityChange = () => {
    if (document.visibilityState === "hidden") {
      appOpened = true;
    }
  };

  document.addEventListener("visibilitychange", handleVisibilityChange, true);
  window.location.href = appUrl;

  window.setTimeout(() => {
    document.removeEventListener("visibilitychange", handleVisibilityChange, true);
    if (!appOpened) {
      window.location.href = webUrl;
    }
  }, 1200);
}

function getPlatformEntry(platform: SongPlatform, game: ShareGame) {
  const webUrl = buildSongPlatformSearchUrl(platform, game);
  const appUrl = buildSongPlatformAppSearchUrl(platform, game);

  if (platform === "apple") {
    return { label: "Apple Music", webUrl, appUrl };
  }
  if (platform === "qq") {
    return { label: "QQ 音乐搜索", webUrl, appUrl };
  }
  return { label: "网易云搜索", webUrl, appUrl };
}

export function SongPlatformSearchDialog({
  open,
  onOpenChange,
  game,
  onBeforePlatformOpen,
}: SongPlatformSearchDialogProps) {
  const [showWeChatOpenHint, setShowWeChatOpenHint] = useState(false);
  const isWeChatBrowser =
    typeof navigator !== "undefined" && /MicroMessenger/i.test(navigator.userAgent);

  function handleOpenChange(nextOpen: boolean) {
    if (!nextOpen) {
      setShowWeChatOpenHint(false);
    }
    onOpenChange(nextOpen);
  }

  function handlePlatformOpen(platform: SongPlatform) {
    if (!game) return;
    onBeforePlatformOpen?.();
    if (isWeChatBrowser) {
      setShowWeChatOpenHint(true);
      return;
    }

    const target = getPlatformEntry(platform, game);
    openTarget(target);
  }

  const weChatOpenHintOverlay =
    showWeChatOpenHint && typeof document !== "undefined"
      ? createPortal(
          <div
            className="music-wechat-open-browser-layer"
            aria-hidden="true"
            onClick={() => setShowWeChatOpenHint(false)}
          >
            <div className="music-wechat-open-browser-arrow" aria-hidden="true">
              <svg viewBox="0 0 240 160" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path
                  d="M28 130C72 124 112 103 143 74C168 50 186 28 214 18"
                  stroke="rgba(255,255,255,0.92)"
                  strokeWidth="6"
                  strokeLinecap="round"
                />
                <path
                  d="M192 16H220V44"
                  stroke="rgba(255,255,255,0.92)"
                  strokeWidth="6"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </div>
            <div className="music-wechat-open-browser-bubble">
              <span>点击右上角三个点，选择“在浏览器中打开”</span>
            </div>
          </div>,
          document.body
        )
      : null;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="w-[94vw] max-h-[88vh] overflow-y-auto rounded-[2rem] border border-border/70 bg-background/92 p-5 shadow-[0_30px_80px_-44px_rgba(15,20,35,0.9)] backdrop-blur-2xl sm:max-w-lg sm:p-6">
        <DialogHeader>
          <DialogTitle className="text-[rgba(239,236,232,0.92)]">搜索原曲</DialogTitle>
          <DialogDescription className="sr-only">
            查看这首歌在不同平台的打开入口。
          </DialogDescription>
        </DialogHeader>

        {game ? (
          <div className="space-y-4">
            <div className="music-subpanel flex items-center gap-4 rounded-[1.5rem] p-4">
              <div className="w-16 flex-shrink-0 overflow-hidden rounded-[1.1rem] border border-border/70 bg-muted shadow-sm">
                {game.cover ? (
                  <Image
                    src={game.cover}
                    alt={game.name}
                    width={96}
                    height={96}
                    unoptimized
                    className="aspect-square h-auto w-full object-cover"
                  />
                ) : (
                  <div className="flex aspect-square items-center justify-center text-[11px] text-muted-foreground">
                    无图
                  </div>
                )}
              </div>

              <div className="min-w-0 flex-1">
                <p className="text-base font-bold text-foreground">{displayName(game)}</p>
                {game.localizedName?.trim() !== game.name ? (
                  <p className="mt-1 text-sm text-muted-foreground">{game.name}</p>
                ) : null}
              </div>

            </div>

            <div className="space-y-3">
              <div className="music-subpanel rounded-[1.5rem] p-4">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm font-semibold text-foreground">Apple Music</p>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="rounded-full"
                    onClick={() => handlePlatformOpen("apple")}
                  >
                    打开
                    <ExternalLink className="h-4 w-4" />
                  </Button>
                </div>
              </div>

              <div className="music-subpanel rounded-[1.5rem] p-4">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm font-semibold text-foreground">QQ 音乐搜索</p>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="rounded-full"
                    onClick={() => handlePlatformOpen("qq")}
                  >
                    打开
                    <ExternalLink className="h-4 w-4" />
                  </Button>
                </div>
              </div>

              <div className="music-subpanel rounded-[1.5rem] p-4">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm font-semibold text-foreground">网易云搜索</p>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="rounded-full"
                    onClick={() => handlePlatformOpen("netease")}
                  >
                    打开
                    <ExternalLink className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </div>
          </div>
        ) : null}
      </DialogContent>
      {weChatOpenHintOverlay}
    </Dialog>
  );
}
