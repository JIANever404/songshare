import Link from "next/link";
import { MusicBackdrop } from "@/components/music/MusicBackdrop";
import { MusicPanel } from "@/components/music/MusicPanel";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <main className="relative isolate min-h-screen overflow-hidden px-4 py-6 text-foreground">
      <MusicBackdrop compact />
      <div className="relative z-10 mx-auto flex w-full max-w-[430px] flex-col justify-center">
        <MusicPanel className="space-y-5 p-5 sm:p-6 text-center">
          <div className="space-y-3">
            <p className="music-kicker justify-center">Not Found</p>
            <h1 className="text-[2.3rem] font-black leading-[0.98] text-foreground">这个页面不见了</h1>
            <p className="text-sm leading-6 text-muted-foreground">
              链接可能失效了，或者这个页面本来就不存在。
            </p>
          </div>

          <Button asChild size="lg" className="w-full">
            <Link href="/" prefetch={false}>
              返回首页
            </Link>
          </Button>
        </MusicPanel>
      </div>
    </main>
  );
}
