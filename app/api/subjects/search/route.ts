import { handleItunesSearchRequest } from "@/lib/itunes/route";

export async function GET(request: Request) {
  return handleItunesSearchRequest(request, {
    forcedKind: "song",
  });
}
