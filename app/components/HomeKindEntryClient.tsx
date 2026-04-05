"use client";

import dynamic from "next/dynamic";

const HomeKindEntry = dynamic(() => import("@/app/components/HomeKindEntry"), {
  ssr: false,
});

export default function HomeKindEntryClient() {
  return <HomeKindEntry />;
}
