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
