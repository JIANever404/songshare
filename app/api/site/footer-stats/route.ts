import { NextResponse } from "next/server";
import {
  registerFooterVisit,
  VISITOR_COOKIE_MAX_AGE,
  VISITOR_COOKIE_NAME,
} from "@/lib/site-footer-stats";

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, max-age=0",
};

export async function GET() {
  try {
    const stats = await registerFooterVisit();
    const response = NextResponse.json(
      {
        ok: true,
        updatedAtLabel: stats.deployTimeLabel,
        visitorCount: stats.visitorCount,
      },
      {
        headers: NO_STORE_HEADERS,
      }
    );

    if (stats.nextVisitorId) {
      response.cookies.set({
        name: VISITOR_COOKIE_NAME,
        value: stats.nextVisitorId,
        maxAge: VISITOR_COOKIE_MAX_AGE,
        path: "/",
        sameSite: "lax",
        httpOnly: true,
        secure: true,
      });
    }

    return response;
  } catch {
    return NextResponse.json(
      {
        ok: true,
        updatedAtLabel: null,
        visitorCount: null,
      },
      {
        headers: NO_STORE_HEADERS,
      }
    );
  }
}
