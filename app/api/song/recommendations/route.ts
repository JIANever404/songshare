import { NextResponse } from "next/server";
import { fetchSongRecommendations, buildSongRecommendationResponse } from "@/lib/itunes/charts";

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, max-age=0",
};

export async function GET() {
  try {
    const items = await fetchSongRecommendations("song");

    if (items.length === 0) {
      return NextResponse.json(
        {
          ok: false,
          source: "apple-charts",
          kind: "song",
          items: [],
          error: "推荐加载失败，请稍后再试",
        },
        {
          status: 503,
          headers: NO_STORE_HEADERS,
        }
      );
    }

    return NextResponse.json(buildSongRecommendationResponse({ kind: "song", items }), {
      headers: NO_STORE_HEADERS,
    });
  } catch {
    return NextResponse.json(
      {
        ok: false,
        source: "apple-charts",
        kind: "song",
        items: [],
        error: "推荐加载失败，请稍后再试",
      },
      {
        status: 503,
        headers: NO_STORE_HEADERS,
      }
    );
  }
}
