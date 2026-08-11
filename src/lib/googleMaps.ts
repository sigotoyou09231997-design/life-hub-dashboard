/**
 * No API key, no billing. Uses the classic "embed a map" iframe URL format
 * (the same one Google Maps' own "共有 > 地図を埋め込む" produces) rather
 * than the official (keyed) Maps Embed API, plus the documented
 * key-free universal deep link for opening a place in the Maps app/site.
 * If this ever needs to move to the official Maps JavaScript/Places API,
 * this file is the only place that needs to change.
 */

export function buildMapEmbedUrl(query: string): string {
  return `https://maps.google.com/maps?q=${encodeURIComponent(query)}&output=embed`;
}

export function buildMapSearchUrl(query: string): string {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}
