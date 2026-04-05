import type { MetadataRoute } from "next";
import { getServerSiteUrl, getSiteHost } from "@/lib/site-url";

export default function robots(): MetadataRoute.Robots {
  const siteUrl = getServerSiteUrl();
  return {
    rules: [
      {
        userAgent: "*",
        allow: ["/", "/song"],
        disallow: ["/api/", "/*/s/*"],
      },
    ],
    host: getSiteHost(siteUrl),
    sitemap: `${siteUrl}/sitemap.xml`,
  };
}
