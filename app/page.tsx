import type { Metadata } from "next";
import HomeKindEntryClient from "@/app/components/HomeKindEntryClient";

export const metadata: Metadata = {
  title: "我的歌单你听吗",
};

export default function HomePage() {
  return <HomeKindEntryClient />;
}
