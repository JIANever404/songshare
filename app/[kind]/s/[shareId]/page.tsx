import type { Metadata } from "next";
import { notFound, permanentRedirect, redirect } from "next/navigation";
import { Suspense } from "react";
import { KindPageLoadingFallback } from "@/app/components/KindPageLoadingFallback";
import SongShareV3App from "@/app/components/SongShareV3App";
import { isCanonicalShareId, normalizeShareId } from "@/lib/share/id";
import { getShare } from "@/lib/share/storage";
import type { ShareGame } from "@/lib/share/types";
import { getSubjectKindShareTitle, parseSubjectKind } from "@/lib/subject-kind";

type ShareReadonlyPageParams = {
  kind: string;
  shareId: string;
};

type ShareReadonlyPageProps = {
  params: Promise<ShareReadonlyPageParams>;
};

type InitialReadonlyShareData = {
  shareId: string;
  kind: "song";
  creatorName: string | null;
  shareMessage?: string | null;
  games: Array<ShareGame | null>;
  coverOrder?: string[];
};

function ShareReadonlyPageFallback() {
  return (
    <KindPageLoadingFallback
      kicker="Song Share"
      title="分享页加载中"
      message="分享页正在整理封面、曲线和歌曲卡片，马上就好。"
    />
  );
}

export async function generateMetadata({
  params,
}: ShareReadonlyPageProps): Promise<Metadata> {
  const { kind: rawKind, shareId: rawShareId } = await params;
  const kind = parseSubjectKind(rawKind);
  const shareId = normalizeShareId(rawShareId);
  if (!kind) {
    return { title: "页面不存在" };
  }

  if (!shareId) {
    return { title: "我的歌单你听吗" };
  }

  const share = await getShare(shareId);
  if (share && parseSubjectKind(share.kind) === kind) {
    const selectedCount = share.games.filter((game) => Boolean(game)).length;
    return {
      title: getSubjectKindShareTitle(kind, {
        creatorName: share.creatorName,
        selectedCount,
      }),
    };
  }

  return {
    title: "我的歌单你听吗",
  };
}

export default async function ShareReadonlyPage({
  params,
}: ShareReadonlyPageProps) {
  const { kind: rawKind, shareId: rawShareId } = await params;
  const kind = parseSubjectKind(rawKind);
  const shareId = normalizeShareId(rawShareId);
  if (!kind || !shareId) {
    notFound();
  }

  if (!isCanonicalShareId(rawShareId) || rawShareId.trim().toLowerCase() !== shareId) {
    permanentRedirect(`/${kind}/s/${shareId}`);
  }

  let initialShareData: InitialReadonlyShareData | null = null;

  try {
    const share = await getShare(shareId);
    if (share) {
      const shareKind = parseSubjectKind(share.kind) ?? kind;
      if (shareKind !== kind) {
        redirect(`/${shareKind}/s/${share.shareId}`);
      }

      initialShareData = {
        shareId: share.shareId,
        kind: shareKind,
        creatorName: share.creatorName,
        shareMessage: share.shareMessage ?? null,
        games: share.games,
        coverOrder: share.coverOrder ?? [],
      };
    }
  } catch {
    initialShareData = null;
  }

  if (!initialShareData) {
    return (
      <Suspense fallback={<ShareReadonlyPageFallback />}>
        <SongShareV3App kind={kind} mode="shareWorkbench" initialShareId={shareId} initialShareData={null} />
      </Suspense>
    );
  }

  return (
    <Suspense fallback={<ShareReadonlyPageFallback />}>
      <SongShareV3App
        kind={kind}
        mode="shareWorkbench"
        initialShareId={shareId}
        initialShareData={initialShareData}
      />
    </Suspense>
  );
}
