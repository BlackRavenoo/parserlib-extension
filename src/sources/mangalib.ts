import type { ChapterContent, ChapterRef, Source, TitleMeta } from "./types";
import type { DataChunk } from "../core/models";
import { CdnlibsApi, chapterKey, chapterTitle } from "./cdnlibs";
import type { SiteHeaders } from "./cdnlibs";
import { libSocialTitle, libSocialToken, libSocialRequestPatch } from "./libsocial";

const SLUG_RE = /mangalib\.(?:me|org)\/\w+\/(?:manga\/)?(\d+--[a-z_-]+)/;

const SITE: SiteHeaders = { siteId: "1", service: "mangalib" };
const api = new CdnlibsApi();

function extractSlug(url: string): string {
  const match = SLUG_RE.exec(url);
  if (!match) {
    throw new Error(
      `Не удалось вытащить slug тайтла из ссылки MangaLib: ${url}. ` +
        `Ожидается что-то вроде https://mangalib.me/ru/manga/12345--naruto`
    );
  }
  return match[1]!;
}

async function fetchMeta(slug: string, token: string | null): Promise<TitleMeta> {
  api.setAuth(token);
  const manga = await api.getManga(SITE, slug);
  return {
    id: String(manga.id),
    title: manga.rus_name || manga.name,
    author: manga.authors?.[0]?.rus_name || manga.authors?.[0]?.name,
    coverUrl: manga.cover?.default ?? manga.cover?.md,
  };
}

async function fetchChapters(slug: string, token: string | null): Promise<ChapterRef[]> {
  api.setAuth(token);
  const rows = await api.getChapters(SITE, slug);
  return rows.map((row) => ({
    id: row.index,
    title: chapterTitle(row),
    key: chapterKey(row),
    slug,
  }));
}

const source: Source = {
  key: "mangalib",
  kind: "manga",

  titleSlug(url: string): string | null {
    return SLUG_RE.exec(url)?.[1] ?? null;
  },

  titleInPage: libSocialTitle,

  tokenInPage: libSocialToken,

  requestPatch: libSocialRequestPatch,

  async fetchTitle(url: string, token: string | null): Promise<{ meta: TitleMeta; chapters: ChapterRef[] }> {
    const slug = extractSlug(url);

    const [meta, chapters] = await Promise.all([
      fetchMeta(slug, token),
      fetchChapters(slug, token),
    ]);

    return { meta, chapters };
  },

  async fetchChapters(url: string, token: string | null): Promise<ChapterRef[]> {
    return fetchChapters(extractSlug(url), token);
  },

  async fetchChapter(chapter: ChapterRef, token: string | null): Promise<ChapterContent> {
    api.setAuth(token);
    const data = await api.getChapterData(SITE, chapter.slug, chapter.key);
    const pages = data.pages ?? [];
    if (pages.length === 0) {
      throw new Error(`Глава «${chapter.title}» не содержит ни одной страницы.`);
    }

    const downloaded = await Promise.all(
      pages.map(async (page) => ({ page, image: await api.getImageByPath(SITE, page.url) }))
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
