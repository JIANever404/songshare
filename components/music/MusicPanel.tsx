"use client";

import type { ReactNode } from "react";
import SpotlightCard from "@/components/SpotlightCard";
import { cn } from "@/lib/utils";

interface MusicPanelProps {
  children: ReactNode;
  className?: string;
  spotlightColor?: `rgba(${number}, ${number}, ${number}, ${number})`;
}

export function MusicPanel({
  children,
  className,
  spotlightColor = "rgba(255, 151, 104, 0.2)",
}: MusicPanelProps) {
  return (
    <SpotlightCard
      spotlightColor={spotlightColor}
      className={cn("music-panel p-5 sm:p-6", className)}
    >
      {children}
    </SpotlightCard>
  );
}
