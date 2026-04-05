import { Converter } from "opencc-js";
import type { ItunesStorefront } from "@/lib/itunes/storefront";

const traditionalToSimplified = Converter({ from: "hk", to: "cn" });

export function normalizeItunesDisplayText(
  value: string | null | undefined,
  storefront: ItunesStorefront
) {
  if (typeof value !== "string") {
    return "";
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }

  if (storefront === "cn") {
    return traditionalToSimplified(trimmed);
  }

  return trimmed;
}
