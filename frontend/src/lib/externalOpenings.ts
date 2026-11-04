import { READING_TIMELINE } from "./readingTimeline";
import { pvListForBook } from "./bilibiliPvCatalog";

export interface ExternalOpening {
  bookKey: string;
  title: string;
  bvid: string;
  kind: "activity" | "main";
  label: string;
}

const MAIN_BOOK_KEYS = new Set(
  READING_TIMELINE.filter((entry) => entry.kind === "main").map((entry) => entry.title)
);

export function isMainStoryBook(bookKey: string): boolean {
  return MAIN_BOOK_KEYS.has(bookKey);
}

/**
 * First known official PV. The full list comes from PV_CATALOG; unknown/new
 * books still fall back to the strict backend search.
 */
export function externalOpeningForBook(bookKey: string): ExternalOpening | null {
  const first = pvListForBook(bookKey)[0];
  if (!first) return null;
  const isMain = first.type.includes("概念") || first.type.includes("主线");
  return {
    bookKey,
    title: bookKey,
    bvid: first.bvid,
    kind: isMain ? "main" : "activity",
    label: first.type,
  };
}
