import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { KindPageLoadingFallback } from "@/app/components/KindPageLoadingFallback";
import SongShareV3App from "@/app/components/SongShareV3App";
import { parseSubjectKind } from "@/lib/subject-kind";

export const dynamicParams = false;

type SubjectKindPageParams = {
  kind: string;
};

type SubjectKindPageProps = {
  params: Promise<SubjectKindPageParams>;
};

export function generateStaticParams() {
  return [{ kind: "song" }];
}

function SubjectKindPageFallback() {
  return (
    <KindPageLoadingFallback
      kicker="Song Share"
      title="我的歌单你听吗"
      message="页面正在准备中，马上就把选歌工作台带出来。"
    />
  );
}

export async function generateMetadata({
  params,
}: SubjectKindPageProps): Promise<Metadata> {
  const { kind: rawKind } = await params;
  const kind = parseSubjectKind(rawKind);
  if (!kind) {
    return { title: "页面不存在" };
  }

  return {
    title: "我的歌单你听吗",
  };
}

export default async function SubjectKindPage({
  params,
}: SubjectKindPageProps) {
  const { kind: rawKind } = await params;
  const kind = parseSubjectKind(rawKind);
  if (!kind) {
    notFound();
  }

  return (
    <Suspense fallback={<SubjectKindPageFallback />}>
      <SongShareV3App kind={kind} />
    </Suspense>
  );
}
