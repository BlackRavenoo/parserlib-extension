import type { RequestPatch } from "../lib/headers";

const LIBSOCIAL_DOMAINS = ["mangalib.me", "mangalib.org", "ranobelib.me"];

export function libSocialRequestPatch(pageUrl: string): RequestPatch {
  const origin = new URL(pageUrl).origin;

  return {
    requestDomains: ["api.cdnlibs.org", "cover.cdnlibs.org"],
    excludedInitiatorDomains: LIBSOCIAL_DOMAINS,
    headers: [
      { header: "referer", operation: "set", value: `${origin}/` },
      { header: "origin", operation: "set", value: origin },
      { header: "sec-fetch-site", operation: "set", value: "cross-site" },
    ],
  };
}

export function libSocialToken(): string | null {
  const raw = localStorage.getItem("auth");
  if (!raw) return null;
  try {
    const session = JSON.parse(raw);
    const token = session?.token?.access_token;
    return typeof token === "string" && token.length > 0 ? token : null;
  } catch {
    return null;
  }
}

export function libSocialTitle(): string | null {
  const heading = document.querySelector("h1.anx_anz")?.textContent?.trim();
  if (heading) return heading;

  const ogTitle = document.querySelector('meta[property="og:title"]')?.getAttribute("content");
  if (!ogTitle) return null;

  const parts = ogTitle.split(" · ").map((part) => part.trim()).filter(Boolean);
  if (parts.length >= 2 && /^Читать\s+\d+/i.test(parts[parts.length - 1]!)) parts.pop();
  return parts.length >= 2 ? parts.slice(1).join(" · ") : parts[0] || ogTitle;
}
