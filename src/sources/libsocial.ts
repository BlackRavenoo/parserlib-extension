import type { RequestPatch } from "../lib/headers";

const LIBSOCIAL_DOMAINS = ["mangalib.me", "mangalib.org", "hentailib.me", "ranobelib.me"];

export function libSocialRequestPatch(pageUrl: string): RequestPatch {
  const page = new URL(pageUrl);
  const origin = page.origin;
  const isRanobeLib = page.hostname === "ranobelib.me" || page.hostname.endsWith(".ranobelib.me");
  const isHentaiLib = page.hostname === "hentailib.me" || page.hostname.endsWith(".hentailib.me");

  return {
    requestDomains: isHentaiLib
      ? ["hapi.hentaicdn.org", "cover.hentaicdn.org"]
      : ["api.cdnlibs.org", "cover.cdnlibs.org"],
    excludedInitiatorDomains: LIBSOCIAL_DOMAINS,
    headers: [
      { header: "referer", operation: "set", value: `${origin}/` },
      { header: "origin", operation: "set", value: origin },
      { header: "sec-fetch-site", operation: "set", value: "cross-site" },
    ],
    ...(isRanobeLib && {
      additionalRules: [
        {
          requestDomains: ["ranobelib.me"],
          excludedInitiatorDomains: LIBSOCIAL_DOMAINS,
          headers: [
            {
              header: "accept",
              operation: "set",
              value: "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
            },
            { header: "referer", operation: "set", value: pageUrl },
            { header: "sec-fetch-site", operation: "set", value: "same-origin" },
          ],
        },
      ],
    }),
    ...(isHentaiLib && {
      additionalRules: [
        {
          requestDomains: ["img3h.hentaicdn.org"],
          excludedInitiatorDomains: LIBSOCIAL_DOMAINS,
          headers: [
            {
              header: "accept",
              operation: "set",
              value: "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
            },
            { header: "referer", operation: "set", value: `${origin}/` },
            { header: "sec-fetch-site", operation: "set", value: "cross-site" },
          ],
        },
      ],
    }),
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
