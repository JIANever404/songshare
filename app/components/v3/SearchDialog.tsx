"use client";

import { useEffect, useMemo } from "react";
import Image from "next/image";
import { AlertCircle, Flame, Loader2, Music2, RefreshCw, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { SubjectKind } from "@/lib/subject-kind";
import { normalizeSearchQuery } from "@/lib/search/query";
import { RecommendedShareGame, ShareGame } from "@/lib/share/types";
import { cn } from "@/lib/utils";

interface SearchDialogProps {
  kind: SubjectKind;
  subjectLabel: string;
  dialogTitle: string;
  inputPlaceholder: string;
  idleHint: string;
  committedQuery: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  query: string;
  onQueryChange: (value: string) => void;
  loading: boolean;
  error: string;
  results: ShareGame[];
  recommendations: RecommendedShareGame[];
  recommendationsLoading: boolean;
  noResultQuery: string | null;
  activeIndex: number;
  onActiveIndexChange: (index: number) => void;
  onSubmitSearch: () => void;
  onPickGame: (game: ShareGame) => void;
}

type ViewState = "idle" | "searching" | "success" | "error" | "no-results";

function displayName(game: ShareGame) {
  return game.localizedName?.trim() || game.name;
}

function displaySecondaryText(kind: SubjectKind, game: ShareGame) {
  if (game.name.trim() && game.name !== displayName(game)) {
    return game.name;
  }
  return null;
}

function shouldTopCropCover(kind: SubjectKind) {
  void kind;
  return false;
}

function getNoResultHint(kind: SubjectKind, subjectLabel: string): string {
  void kind;
  void subjectLabel;
  return "尝试歌手名 + 歌曲名一起搜索";
}

function splitRecommendationRows(items: RecommendedShareGame[], rowCount = 5) {
  if (items.length === 0) return [];

  const nextRows: RecommendedShareGame[][] = [];
  const safeRowCount = Math.max(1, Math.min(rowCount, items.length));
  const baseSize = Math.floor(items.length / safeRowCount);
  const remainder = items.length % safeRowCount;
  let cursor = 0;

  for (let rowIndex = 0; rowIndex < safeRowCount; rowIndex += 1) {
    const rowSize = baseSize + (rowIndex < remainder ? 1 : 0);
    const row = items.slice(cursor, cursor + rowSize);
    if (row.length > 0) {
      nextRows.push(row);
    }
    cursor += rowSize;
  }

  return nextRows;
}

export function SearchDialog({
  kind,
  subjectLabel,
  dialogTitle,
  inputPlaceholder,
  idleHint,
  committedQuery,
  open,
  onOpenChange,
  query,
  onQueryChange,
  loading,
  error,
  results,
  recommendations,
  recommendationsLoading,
  noResultQuery,
  activeIndex,
  onActiveIndexChange,
  onSubmitSearch,
  onPickGame,
}: SearchDialogProps) {
  const trimmedQuery = query.trim();
  const orderedResults = results;
  const isRecommendationMode = trimmedQuery.length === 0;
  const recommendationRows = useMemo(() => {
    return splitRecommendationRows(recommendations, 5);
  }, [recommendations]);

  const hasSearchedCurrentQuery = useMemo(() => {
    const committed = normalizeSearchQuery(committedQuery);
    const current = normalizeSearchQuery(trimmedQuery);
    return committed.length > 0 && committed === current;
  }, [committedQuery, trimmedQuery]);

  const state: ViewState = useMemo(() => {
    if (loading) return "searching";
    if (error) return "error";
    if (trimmedQuery.length === 0) return "idle";
    if (hasSearchedCurrentQuery && orderedResults.length > 0) return "success";
    if (hasSearchedCurrentQuery && orderedResults.length === 0) return "no-results";
    return "idle";
  }, [error, hasSearchedCurrentQuery, loading, orderedResults.length, trimmedQuery]);

  useEffect(() => {
    if (!open) return;

    if (orderedResults.length === 0) {
      if (activeIndex !== -1) {
        onActiveIndexChange(-1);
      }
      return;
    }

    if (activeIndex < 0 || activeIndex >= orderedResults.length) {
      onActiveIndexChange(0);
    }
  }, [activeIndex, onActiveIndexChange, open, orderedResults.length]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[min(34rem,calc(100svh-1.5rem))] max-h-[min(34rem,calc(100svh-1.5rem))] w-[95vw] flex-col overflow-hidden rounded-[2rem] border border-border/70 bg-background/90 p-6 shadow-[0_30px_80px_-44px_rgba(15,20,35,0.9)] backdrop-blur-2xl sm:h-[min(36rem,calc(100svh-2rem))] sm:max-w-md md:max-w-lg lg:max-w-xl">
        <DialogHeader>
          <DialogTitle>{dialogTitle}</DialogTitle>
          <DialogDescription className="sr-only">
            搜索并选择要加入当前分享页的歌曲。
          </DialogDescription>
        </DialogHeader>

        <div className="mb-4">
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Input
                value={query}
                role="combobox"
                aria-expanded={open}
                aria-controls="search-results-list"
                aria-label={`${subjectLabel}搜索输入框`}
                placeholder={inputPlaceholder}
                onChange={(event) => onQueryChange(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "ArrowDown") {
                    event.preventDefault();
                    if (orderedResults.length === 0) return;
                    const nextIndex = Math.min((activeIndex < 0 ? -1 : activeIndex) + 1, orderedResults.length - 1);
                    onActiveIndexChange(nextIndex);
                    return;
                  }

                  if (event.key === "ArrowUp") {
                    event.preventDefault();
                    if (orderedResults.length === 0) return;
                    const nextIndex = Math.max((activeIndex < 0 ? 0 : activeIndex) - 1, 0);
                    onActiveIndexChange(nextIndex);
                    return;
                  }

                  if (event.key === "Enter") {
                    event.preventDefault();
                    if (loading) {
                      return;
                    }
                    const normalizedCommitted = normalizeSearchQuery(committedQuery);
                    const resultsMatchCurrentQuery =
                      normalizedCommitted.length > 0 &&
                      normalizedCommitted === normalizeSearchQuery(trimmedQuery);
                    if (
                      resultsMatchCurrentQuery &&
                      activeIndex >= 0 &&
                      orderedResults[activeIndex]
                    ) {
                      onPickGame(orderedResults[activeIndex]);
                      return;
                    }
                    if (normalizeSearchQuery(trimmedQuery).length > 0) {
                      onSubmitSearch();
                    }
                    return;
                  }

                  if (event.key === "Escape") {
                    onOpenChange(false);
                  }
                }}
                disabled={loading}
                className="pr-10"
                autoFocus
              />
              {query ? (
                <button
                  type="button"
                  aria-label="清空搜索"
                  onClick={() => {
                    onQueryChange("");
                    onActiveIndexChange(-1);
                  }}
                  className="absolute right-2 top-1/2 inline-flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-accent/70 hover:text-foreground"
                >
                  <X className="h-4 w-4" />
                </button>
              ) : null}
            </div>
            <Button
              type="button"
              onClick={onSubmitSearch}
              disabled={loading || normalizeSearchQuery(query).length === 0}
              className="px-5"
            >
              {loading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  搜索中
                </>
              ) : (
                <>
                  <Search className="mr-2 h-4 w-4" />
                  搜索
                </>
              )}
            </Button>
          </div>
        </div>

        <div
          className={cn(
            "min-h-0 flex-1",
            isRecommendationMode ? "overflow-y-auto overscroll-contain pr-1" : "overflow-y-auto"
          )}
          id="search-results-list"
          role="listbox"
        >
          {isRecommendationMode ? (
            recommendationsLoading && recommendations.length === 0 ? (
              <RecommendationSkeleton />
            ) : recommendationRows.length > 0 ? (
              <RecommendationBubbles rows={recommendationRows} onPickGame={onPickGame} />
            ) : (
              <SearchStatus
                kind={kind}
                subjectLabel={subjectLabel}
                idleHint={idleHint}
                state="idle"
                error={error}
                loading={loading}
                noResultQuery={noResultQuery}
                onRetry={onSubmitSearch}
              />
            )
          ) : state === "success" ? (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
              {orderedResults.map((game, index) => {
                const secondaryText = displaySecondaryText(kind, game);
                return (
                  <button
                    key={`${String(game.id)}-${index}`}
                    type="button"
                    onMouseEnter={() => onActiveIndexChange(index)}
                    onClick={() => onPickGame(game)}
                    className={cn(
                      "music-subpanel cursor-pointer rounded-[1.4rem] p-1.5 transition-all duration-200 hover:-translate-y-0.5 sm:p-2",
                      index === activeIndex
                        ? "border-orange-300/80 bg-orange-50/80 dark:border-orange-500/40 dark:bg-orange-500/10"
                        : "hover:bg-accent/70"
                    )}
                    title={displayName(game)}
                  >
                    <div className="relative h-0 w-full overflow-hidden rounded bg-muted pb-[133.33%]">
                      {game.cover ? (
                        <Image
                          src={game.cover}
                          alt={displayName(game)}
                          fill
                          className={cn("object-cover", shouldTopCropCover(kind) && "object-top")}
                          sizes="(max-width: 768px) 40vw, 20vw"
                          loading="lazy"
                        />
                      ) : (
                        <div className="absolute inset-0 flex items-center justify-center">
                          <Music2 className="h-7 w-7 text-muted-foreground" />
                        </div>
                      )}
                    </div>
                    <div className="mt-1 space-y-0.5 sm:mt-2">
                      <p className="truncate text-xs font-semibold sm:text-sm">{displayName(game)}</p>
                      {secondaryText ? (
                        <p className="truncate text-[11px] text-muted-foreground sm:text-xs">{secondaryText}</p>
                      ) : null}
                    </div>
                  </button>
                );
              })}
            </div>
          ) : (
            <SearchStatus
              kind={kind}
              subjectLabel={subjectLabel}
              idleHint={idleHint}
              state={state}
              error={error}
              loading={loading}
              noResultQuery={noResultQuery}
              onRetry={onSubmitSearch}
            />
          )}
        </div>

        <DialogFooter className="mt-4 flex shrink-0 flex-col justify-between border-t border-border/60 pt-3 sm:flex-row sm:justify-between">
          <div className="mb-2 text-xs text-muted-foreground sm:mb-0">
            {trimmedQuery.length > 0 && orderedResults.length > 0 ? `共 ${orderedResults.length} 条结果` : ""}
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => onOpenChange(false)}
            className="hidden sm:inline-flex"
          >
            关闭
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RecommendationBubbles(props: {
  rows: RecommendedShareGame[][];
  onPickGame: (game: ShareGame) => void;
}) {
  const { rows, onPickGame } = props;

  return (
    <div data-testid="search-recommendations" className="space-y-2 py-1">
      {rows.map((row, rowIndex) => {
        const duplicatedRow = [...row, ...row];
        return (
          <div key={`recommendation-row-${rowIndex}`} className="music-marquee-row search-recommendation-row">
            <div
              className="music-marquee-track"
              style={{
                ["--marquee-duration" as string]: `${36 + rowIndex * 3}s`,
                ["--marquee-direction" as string]: rowIndex % 2 === 0 ? "normal" : "reverse",
              }}
            >
              {duplicatedRow.map((game, gameIndex) => (
                <button
                  key={`${rowIndex}-${String(game.id)}-${gameIndex}`}
                  type="button"
                  data-testid="search-recommendation-bubble"
                  data-hot={game.isHot ? "true" : "false"}
                  onClick={() => onPickGame(game)}
                  className="search-recommendation-bubble"
                  title={`${game.localizedName || game.name} ${game.name}`}
                >
                  <span
                    className={cn(
                      "flex items-center gap-1 leading-tight text-foreground",
                      game.isHot ? "text-[0.82rem] font-semibold" : "text-[0.73rem] font-medium"
                    )}
                  >
                    <span className="truncate">{game.localizedName || game.name}</span>
                    {game.isHot ? <Flame className="h-3 w-3 shrink-0 fill-current text-orange-500" /> : null}
                  </span>
                  <span
                    className={cn(
                      "truncate leading-tight text-muted-foreground",
                      game.isHot ? "text-[0.7rem]" : "text-[0.62rem]"
                    )}
                  >
                    {game.name}
                  </span>
                </button>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function RecommendationSkeleton() {
  return (
    <div className="space-y-2 py-1" data-testid="search-recommendations-loading">
      {Array.from({ length: 5 }, (_, rowIndex) => (
        <div key={`recommendation-skeleton-${rowIndex}`} className="music-marquee-row">
          <div className="music-marquee-track">
            {Array.from({ length: 6 }, (_, itemIndex) => (
              <div
                key={`recommendation-skeleton-${rowIndex}-${itemIndex}`}
                className="search-recommendation-bubble animate-pulse bg-card/65"
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function SearchStatus(props: {
  kind: SubjectKind;
  subjectLabel: string;
  idleHint: string;
  state: Exclude<ViewState, "success">;
  error: string;
  loading: boolean;
  noResultQuery: string | null;
  onRetry: () => void;
}) {
  const {
    kind,
    subjectLabel,
    idleHint,
    state,
    error,
    loading,
    noResultQuery,
    onRetry,
  } = props;

  if (state === "searching") {
    return (
      <div className="flex flex-col items-center justify-center py-10 text-muted-foreground" aria-live="polite">
        <Loader2 className="mb-2 h-8 w-8 animate-spin" />
        <p>正在搜索...</p>
      </div>
    );
  }

  if (state === "error") {
    return (
      <div className="flex flex-col items-center justify-center py-10 text-red-500" aria-live="polite">
        <AlertCircle className="mb-2 h-8 w-8" />
        <p>{error || "搜索失败，请检查网络连接后重试"}</p>
        <Button variant="outline" className="mt-4" onClick={onRetry} disabled={loading}>
          <RefreshCw className="mr-2 h-4 w-4" />
          重试
        </Button>
      </div>
    );
  }

  if (state === "no-results") {
    const noResultHint = getNoResultHint(kind, subjectLabel);
    return (
      <div className="flex flex-col items-center justify-center py-10 text-muted-foreground" aria-live="polite">
        <Music2 className="mb-2 h-8 w-8 opacity-50" />
        <p>{noResultQuery ? `未找到“${noResultQuery}”` : `未找到相关${subjectLabel}`}</p>
        <p className="mt-2 text-sm">{noResultHint}</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center justify-center py-10 text-muted-foreground" aria-live="polite">
      <Search className="mb-2 h-12 w-12 opacity-30" />
      <p>{idleHint}</p>
    </div>
  );
}
