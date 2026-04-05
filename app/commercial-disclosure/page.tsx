import { LegalDocumentPage } from "@/components/legal/LegalDocumentPage";

export const metadata = {
  title: "商业声明",
};

export default function CommercialDisclosurePage() {
  const paragraphs = [
    "当前版本以社区分享为主，不提供付费会员或付费解锁功能。",
    "若未来出现赞助、广告或合作内容，会在页面中明确标注“商业合作/推广”字样。",
    "本站展示的游戏名称、封面与商标归其各自权利人所有，仅用于用户生成内容展示与讨论。",
  ];

  return (
    <LegalDocumentPage title="商业声明" paragraphs={paragraphs} />
  );
}
