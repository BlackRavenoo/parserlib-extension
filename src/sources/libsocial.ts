import type { RequestPatch } from "../lib/headers";

const FIREFOX_UA = "Mozilla/5.0 (X11; Linux x86_64; rv:147.0) Gecko/20100101 Firefox/147.0";

const LIBSOCIAL_DOMAINS = ["mangalib.me", "mangalib.org", "ranobelib.me"];

export function libSocialRequestPatch(): RequestPatch {
  return {
    urlFilter: "||api.cdnlibs.org ||cover.cdnlibs.org",
    excludedInitiatorDomains: LIBSOCIAL_DOMAINS,
    headers: [
      { header: "user-agent", operation: "set", value: FIREFOX_UA },
      { header: "referer", operation: "set", value: "https://mangalib.me/" },
      { header: "origin", operation: "set", value: "https://mangalib.me" },
      { header: "sec-gpc", operation: "set", value: "1" },
      { header: "sec-fetch-dest", operation: "set", value: "empty" },
      { header: "sec-fetch-mode", operation: "set", value: "cors" },
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
