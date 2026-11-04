/**
 * Upstream PRTS 404s that are known to be missing from the current asset
 * snapshot. They are referenced by old story data but no longer exist on the
 * CDN; retrying them only produces noise in the "download complete" summary.
 */
const KNOWN_MISSING = new Set([
  "torappu.prts.wiki/assets/avg/images/item_cc2_1.png",
  "torappu.prts.wiki/assets/avg/images/item_cc2_2.png",
  "torappu.prts.wiki/assets/avg/images/item_cc2_4.png",
  "torappu.prts.wiki/assets/avg/images/item_cc2_5.png",
  "torappu.prts.wiki/assets/avg/images/31_luo_i1.png",
  "torappu.prts.wiki/assets/avg/images/31_luo_i2.png",
  "torappu.prts.wiki/assets/audio/customse/act24side",
]);

function normalize(key: string): string {
  return key.replace(/^https?:\/\//i, "").replace(/[?#].*$/, "");
}

export function isKnownMissingAsset(key: string): boolean {
  const path = normalize(key);
  if (KNOWN_MISSING.has(path)) return true;
  // Some old scripts point at an audio *directory* (customse/act24side)
  // instead of a file; it can never be downloaded as media.
  return /\/assets\/audio\/[^/]+\/[^/.]+$/i.test(path);
}
