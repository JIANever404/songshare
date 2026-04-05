import { notFound, redirect } from "next/navigation";
import { parseSubjectKind } from "@/lib/subject-kind";

type SubjectKindPreviewPageParams = {
  kind: string;
};

type SubjectKindPreviewPageProps = {
  params: Promise<SubjectKindPreviewPageParams>;
};

export default async function SubjectKindPreviewPage({
  params,
}: SubjectKindPreviewPageProps) {
  const { kind: rawKind } = await params;
  const kind = parseSubjectKind(rawKind);
  if (!kind) {
    notFound();
  }

  redirect(`/${kind}`);
}
