"use client";

import { type MouseEvent, useEffect, useRef, useState } from "react";
import type { SubjectKind } from "@/lib/subject-kind";
import { cn } from "@/lib/utils";

interface SiteFooterProps {
  className?: string;
  kind?: SubjectKind;
}

export function SiteFooter({ className, kind }: SiteFooterProps) {
  void kind;
  const [showContactBubble, setShowContactBubble] = useState(false);
  const [footerStats, setFooterStats] = useState<{
    updatedAtLabel: string | null;
    visitorCount: number | null;
  }>({
    updatedAtLabel: null,
    visitorCount: null,
  });
  const contactRef = useRef<HTMLSpanElement | null>(null);

  function toggleContactBubble() {
    setShowContactBubble((current) => !current);
  }

  function handleAuthorClick(event: MouseEvent<HTMLAnchorElement>) {
    event.preventDefault();
    toggleContactBubble();
  }

  useEffect(() => {
    if (!showContactBubble) return;

    const handlePointerDown = (event: PointerEvent) => {
      if (!contactRef.current?.contains(event.target as Node)) {
        setShowContactBubble(false);
      }
    };

    window.addEventListener("pointerdown", handlePointerDown, true);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown, true);
    };
  }, [showContactBubble]);

  useEffect(() => {
    let cancelled = false;

    async function loadFooterStats() {
      try {
        const response = await fetch("/api/site/footer-stats", {
          cache: "no-store",
        });
        if (!response.ok) return;

        const json = (await response.json()) as {
          ok?: boolean;
          updatedAtLabel?: string | null;
          visitorCount?: number | null;
        };

        if (cancelled || !json?.ok) return;
        setFooterStats({
          updatedAtLabel: typeof json.updatedAtLabel === "string" ? json.updatedAtLabel : null,
          visitorCount: typeof json.visitorCount === "number" ? json.visitorCount : null,
        });
      } catch {
        if (!cancelled) {
          setFooterStats((current) => current);
        }
      }
    }

    void loadFooterStats();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <footer
      className={cn(
        "mx-auto w-full max-w-6xl pt-4 text-center text-xs text-muted-foreground",
        className
      )}
    >
      <div className="music-divider mb-4" />
      <p className="inline-flex flex-wrap items-center justify-center gap-x-2 gap-y-1 text-[10px] sm:text-[11px]">
        <span>数据来源：</span>
        <a href="https://music.apple.com/" target="_blank" rel="noreferrer" className="font-semibold text-orange-500 transition-colors hover:text-cyan-500">
          Apple Music
        </a>
        <span aria-hidden="true">/</span>
        <span ref={contactRef} className="relative inline-flex items-center whitespace-nowrap">
          <span className="pointer-events-none absolute inset-0 z-0 whitespace-nowrap text-muted-foreground">
            作者：舟舟
          </span>
          <span className="relative z-10 inline-flex items-center gap-0 whitespace-nowrap">
            <span>作者：</span>
            <a
              href="https://github.com/JIANever404/songshare/issues"
              target="_blank"
              rel="noreferrer"
              className="cursor-pointer font-medium text-muted-foreground underline decoration-current/70 underline-offset-4 transition-colors hover:text-foreground"
              onClick={handleAuthorClick}
              aria-expanded={showContactBubble}
              aria-label="前往 GitHub Issues 联系作者"
            >
              舟舟
            </a>
          </span>
          {showContactBubble ? (
            <span className="absolute bottom-full left-1/2 z-20 mb-2 -translate-x-1/2 whitespace-nowrap rounded-full border border-border/70 bg-background/95 px-3 py-2 text-[11px] tracking-normal text-foreground shadow-[0_16px_40px_-24px_rgba(15,20,35,0.55)] backdrop-blur-sm">
              联系方式：GitHub Issues
            </span>
          ) : null}
        </span>
        <span className="inline-flex flex-nowrap items-center gap-x-2 whitespace-nowrap">
          <span>
            更新时间：
            <span className="ml-1 font-medium text-foreground/85">
              {footerStats.updatedAtLabel ?? "--"}
            </span>
          </span>
          <span aria-hidden="true">/</span>
          <span>
            访问人数：
            <span className="ml-1 font-medium text-foreground/85">
              {footerStats.visitorCount ?? "--"}
            </span>
          </span>
          <span aria-hidden="true">/</span>
          <span>
            由
            <a
              href="https://openai.com/codex/"
              target="_blank"
              rel="noreferrer"
              className="mx-1 font-medium underline decoration-current/70 underline-offset-4 transition-colors hover:text-foreground"
            >
              codex
            </a>
            强力驱动
          </span>
        </span>
      </p>
    </footer>
  );
}
