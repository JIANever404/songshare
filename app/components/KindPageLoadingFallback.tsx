import { MusicBackdrop } from "@/components/music/MusicBackdrop";
import { MusicPanel } from "@/components/music/MusicPanel";

interface KindPageLoadingFallbackProps {
  kicker: string;
  title: string;
  message: string;
}

function SongCardSkeleton() {
  return (
    <div className="rounded-[2rem] border border-border/70 bg-card/70 p-5 shadow-[0_20px_50px_-36px_rgba(15,20,35,0.5)] backdrop-blur-sm">
      <div className="flex items-center gap-4">
        <div className="h-10 w-8 animate-pulse rounded-full bg-foreground/8" />
        <div className="h-20 w-20 animate-pulse rounded-[1.5rem] bg-foreground/8" />
        <div className="min-w-0 flex-1 space-y-3">
          <div className="h-6 w-4/5 animate-pulse rounded-full bg-foreground/8" />
          <div className="h-4 w-1/2 animate-pulse rounded-full bg-foreground/8" />
          <div className="h-3 w-full animate-pulse rounded-full bg-foreground/6" />
        </div>
      </div>
    </div>
  );
}

export function KindPageLoadingFallback({
  kicker,
  title,
  message,
}: KindPageLoadingFallbackProps) {
  return (
    <main className="relative isolate min-h-screen overflow-hidden px-4 py-5 text-foreground">
      <MusicBackdrop compact />
      <div className="relative z-10 mx-auto flex w-full max-w-[430px] flex-col gap-4">
        <MusicPanel className="space-y-4 p-5">
          <div className="space-y-3">
            <p className="music-kicker">{kicker}</p>
            <div className="space-y-3">
              <h1 className="text-[2.35rem] font-black leading-[0.94] text-foreground">{title}</h1>
              <p className="max-w-[24rem] text-sm leading-6 text-muted-foreground">{message}</p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <span className="music-chip">正在加载</span>
          </div>
        </MusicPanel>

        <MusicPanel className="space-y-4 p-5">
          <div className="flex items-center justify-between">
            <div className="space-y-2">
              <div className="h-8 w-28 animate-pulse rounded-full bg-foreground/8" />
              <div className="h-4 w-16 animate-pulse rounded-full bg-foreground/6" />
            </div>
            <div className="h-7 w-12 animate-pulse rounded-full bg-foreground/8" />
          </div>

          <div className="space-y-4">
            <SongCardSkeleton />
            <SongCardSkeleton />
          </div>
        </MusicPanel>

        <MusicPanel className="space-y-3 p-5">
          <div className="h-16 w-full animate-pulse rounded-full bg-[linear-gradient(135deg,rgba(255,136,92,0.18),rgba(255,205,112,0.3))]" />
          <div className="h-16 w-full animate-pulse rounded-full bg-card/70" />
        </MusicPanel>
      </div>
    </main>
  );
}
