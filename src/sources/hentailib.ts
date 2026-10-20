import type { DataChunk } from "../core/models";
import { HttpClient } from "../lib/http";
import type { HttpClientConfig } from "../lib/http";
import { CdnlibsApi, chapterKey, chapterTitle } from "./cdnlibs";
import type { SiteHeaders } from "./cdnlibs";
import { libSocialRequestPatch, libSocialTitle, libSocialToken } from "./libsocial";
import type { ChapterContent, ChapterRef, Source, TitleMeta } from "./types";

const SITE: SiteHeaders = {
  siteId: "4",
  service: "hentailib",
  apiBaseUrl: "https://hapi.hentaicdn.org/api/manga",
};
const IMAGE_HOST = "https://img3h.hentaicdn.org";
const HENTAILIB_LIMITS: HttpClientConfig = {
  anonymous: { requestsPerMinute: 60, rateLimitRetries: 2, rateLimitRetryDelaySeconds: 5 },
  authenticated: { requestsPerMinute: 90, rateLimitRetries: 8, rateLimitRetryDelaySeconds: 5 },
  serverRetries: 3,
  serverRetryDelaySeconds: 1,
};
const api = new CdnlibsApi(new HttpClient(HENTAILIB_LIMITS));

function titleSlug(url: string): string | null {
  const page = new URL(url);
  if (page.hostname.replace(/^www\./, "") !== "hentailib.me") return null;
  return /^\/(?:[a-z]{2}\/)?(?:manga\/)?(\d+--[a-z0-9_-]+)(?:\/|$)/i.exec(page.pathname)?.[1] ?? null;
}

function requireAuth(token: string | null): void {
  if (!token) {
    throw new Error("Для HentaiLib нужна авторизация. Войдите в аккаунт на сайте и откройте popup снова.");
  }
  api.setAuth(token);
}

async function fetchMeta(slug: string, token: string | null): Promise<TitleMeta> {
  requireAuth(token);
  const manga = await api.getManga(SITE, slug);
  return {
    id: String(manga.id),
    title: manga.rus_name || manga.name,
    author: manga.authors?.[0]?.rus_name || manga.authors?.[0]?.name,
    coverUrl: manga.cover?.default ?? manga.cover?.md,
  };
}

async function fetchChapters(slug: string, token: string | null): Promise<ChapterRef[]> {
  requireAuth(token);
  const rows = await api.getChapters(SITE, slug);
  return rows.map((row) => ({
    id: row.index,
    title: chapterTitle(row),
    key: chapterKey(row),
    slug,
  }));
}

const source: Source = {
  key: "hentailib",
  kind: "manga",
  requiresAuth: true,
  titleSlug,
  titleInPage: libSocialTitle,
  tokenInPage: libSocialToken,
  requestPatch: libSocialRequestPatch,

  async fetchTitle(url: string, token: string | null): Promise<{ meta: TitleMeta; chapters: ChapterRef[] }> {
    const slug = titleSlug(url);
    if (!slug) throw new Error(`Не удалось получить slug тайтла из ссылки HentaiLib: ${url}`);
    const [meta, chapters] = await Promise.all([fetchMeta(slug, token), fetchChapters(slug, token)]);
    return { meta, chapters };
  },

  async fetchChapters(url: string, token: string | null): Promise<ChapterRef[]> {
    const slug = titleSlug(url);
    if (!slug) throw new Error(`Не удалось получить slug тайтла из ссылки HentaiLib: ${url}`);
    return fetchChapters(slug, token);
  },

  async fetchChapter(chapter: ChapterRef, token: string | null): Promise<ChapterContent> {
    requireAuth(token);
    const data = await api.getChapterData(SITE, chapter.slug, chapter.key);
    const pages = data.pages ?? [];
    if (pages.length === 0) throw new Error(`Глава «${chapter.title}» не содержит ни одной страницы.`);

    const downloaded = await Promise.all(
      pages.map(async (page) => ({
        page,
        image: await api.getImageByUrl(
          /^https?:\/\//i.test(page.url)
            ? page.url
            : `${IMAGE_HOST}${page.url.startsWith("/") ? "" : "/"}${page.url}`
        ),
      }))
    );
    downloaded.sort((a, b) => a.page.id - b.page.id);

    const chunks: DataChunk[] = downloaded.map(({ image }) => ({
      kind: "image",
      data: image.data,
      mime: image.mime,
    }));
    return { chunks };
  },
};

export default source;
