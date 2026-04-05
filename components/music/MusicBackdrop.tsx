"use client";

import { useEffect, useState } from "react";
import Waves from "@/components/Waves";
import { cn } from "@/lib/utils";

interface MusicBackdropProps {
  className?: string;
  compact?: boolean;
}

export function MusicBackdrop({ className, compact = false }: MusicBackdropProps) {
  const [showAnimatedBackdrop, setShowAnimatedBackdrop] = useState(false);
  const [useLowPowerBackdrop, setUseLowPowerBackdrop] = useState(false);

  useEffect(() => {
    const mediaQuery = window.matchMedia("(max-width: 639px)");
    const reducedMotionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    const syncAnimatedBackdrop = () => {
      const isPhone = mediaQuery.matches;
      const deviceMemory = typeof navigator !== "undefined" ? (navigator as Navigator & { deviceMemory?: number }).deviceMemory : undefined;
      const lowPowerDevice = reducedMotionQuery.matches || (typeof deviceMemory === "number" && deviceMemory <= 4);

      setShowAnimatedBackdrop(isPhone);
      setUseLowPowerBackdrop(isPhone && lowPowerDevice);
    };

    syncAnimatedBackdrop();
    if (typeof mediaQuery.addEventListener === "function") {
      mediaQuery.addEventListener("change", syncAnimatedBackdrop);
      reducedMotionQuery.addEventListener("change", syncAnimatedBackdrop);
      return () => {
        mediaQuery.removeEventListener("change", syncAnimatedBackdrop);
        reducedMotionQuery.removeEventListener("change", syncAnimatedBackdrop);
      };
    }

    mediaQuery.addListener(syncAnimatedBackdrop);
    reducedMotionQuery.addListener(syncAnimatedBackdrop);
    return () => {
      mediaQuery.removeListener(syncAnimatedBackdrop);
      reducedMotionQuery.removeListener(syncAnimatedBackdrop);
    };
  }, []);

  return (
    <div aria-hidden="true" className={cn("pointer-events-none absolute inset-0 overflow-hidden", className)}>
      {showAnimatedBackdrop ? (
        <>
          <Waves
            className={cn("mix-blend-soft-light", useLowPowerBackdrop ? "opacity-28" : "opacity-40")}
            lineColor={useLowPowerBackdrop ? "rgba(45, 76, 142, 0.16)" : "rgba(45, 76, 142, 0.22)"}
            waveSpeedX={useLowPowerBackdrop ? 0.01 : compact ? 0.016 : 0.0125}
            waveSpeedY={useLowPowerBackdrop ? 0.004 : compact ? 0.008 : 0.005}
            waveAmpX={useLowPowerBackdrop ? 12 : compact ? 22 : 32}
            waveAmpY={useLowPowerBackdrop ? 6 : compact ? 12 : 18}
            xGap={useLowPowerBackdrop ? 22 : compact ? 14 : 12}
            yGap={useLowPowerBackdrop ? 36 : compact ? 28 : 34}
            friction={0.93}
            tension={0.006}
            maxCursorMove={useLowPowerBackdrop ? 24 : compact ? 64 : 90}
            maxFps={useLowPowerBackdrop ? 12 : 15}
            pixelRatioCap={useLowPowerBackdrop ? 1 : 1.15}
            motionScale={useLowPowerBackdrop ? 0.42 : 0.7}
            interactive={false}
          />
        </>
      ) : null}
      <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(255,255,255,0.18),rgba(255,255,255,0)_26%,rgba(9,12,22,0.04)_100%)] dark:bg-[linear-gradient(180deg,rgba(255,255,255,0.05),rgba(255,255,255,0)_30%,rgba(2,6,12,0.18)_100%)]" />
    </div>
  );
}
