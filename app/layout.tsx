import type React from "react";
import type { Metadata } from "next";
import GoogleAnalytics from "@/components/GoogleAnalytics";
import { getServerSiteUrl } from "@/lib/site-url";
import "./globals.css";

const SYSTEM_THEME_INIT_SCRIPT = `
(() => {
  const root = document.documentElement;
  const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
  const applyTheme = () => root.classList.toggle("dark", mediaQuery.matches);
  applyTheme();
  if (typeof mediaQuery.addEventListener === "function") {
    mediaQuery.addEventListener("change", applyTheme);
    return;
  }
  if (typeof mediaQuery.addListener === "function") {
    mediaQuery.addListener(applyTheme);
  }
})();
`;

const siteUrl = getServerSiteUrl();

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: "我的歌单你听吗",
  description: "挑 1 到 9 首，发给刚好会听的人。",
  alternates: {
    canonical: "/",
  },
  openGraph: {
    type: "website",
    locale: "zh_CN",
    title: "我的歌单你听吗",
    description: "挑 1 到 9 首，发给刚好会听的人。",
    url: "/",
    siteName: "我的歌单你听吗",
  },
  twitter: {
    card: "summary_large_image",
    title: "我的歌单你听吗",
    description: "挑 1 到 9 首，发给刚好会听的人。",
  },
  verification: {
    google: "swtOMxSQC6Dfn-w4YtMQ3OFH4SZz00Blcd6FI0qMgJc",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: SYSTEM_THEME_INIT_SCRIPT }} />
        <GoogleAnalytics />
      </head>
      <body>
        {children}
      </body>
    </html>
  );
}
