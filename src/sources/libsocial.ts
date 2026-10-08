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
  const h1 = document.querySelector("h1.anx_anz")?.textContent?.trim();
  if (h1) return h1;

  const og = document
    .querySelector('meta[property="og:title"]')
    ?.getAttribute("content");
  if (og) {
    const parts: string[] = og
      .split(" · ")
      .map((s: string) => s.trim())
      .filter(Boolean);
    if (parts.length >= 2 && /^Читать\s+\d+/i.test(parts[parts.length - 1]!)) {
      parts.pop();
    }
    if (parts.length >= 2) return parts.slice(1).join(" · ");
    return parts[0] || og;
  }
  return null;
}
