import { LegalDocumentPage } from "@/components/legal/LegalDocumentPage";

export const metadata = {
  title: "使用条款",
};

export default function AgreementPage() {
  const paragraphs = [
    "你应确保上传与填写内容不侵犯他人合法权益，不包含违法违规内容。",
    "你发布的分享页将通过公开链接访问，默认可被任何人查看、转发和引用。",
    "为保证服务稳定，平台可能对异常请求进行限流、拦截或删除处理。",
    "使用本服务即视为同意本条款；如不同意，请停止使用。",
  ];

  return (
    <LegalDocumentPage title="使用条款" paragraphs={paragraphs} />
  );
}
