import type { ChapterContent, ChapterRef, Source, TitleMeta } from "./types";
import type { DataChunk } from "../core/models";
import { CdnlibsApi, chapterKey, chapterTitle } from "./cdnlibs";

const SLUG_RE = /mangalib\.(?:me|org)\/\w+\/(?:manga\/)?(\d+--[a-z_-]+)/;

const api = new CdnlibsApi({ siteId: "1", service: "mangalib", origin: "https://mangalib.me" });

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

const source: Source = {
  key: "mangalib",
  kind: "manga",

  async fetchTitle(url: string, token: string | null): Promise<{ meta: TitleMeta; chapters: ChapterRef[] }> {
    api.setAuth(token);

    const slug = extractSlug(url);

    const [manga, rows] = await Promise.all([api.getManga(slug), api.getChapters(slug)]);

    return {
      meta: {
        id: String(manga.id),
        title: manga.rus_name || manga.name,
        coverUrl: manga.cover?.default ?? manga.cover?.md,
      },
      chapters: rows.map((row) => ({
        id: row.index,
        title: chapterTitle(row),
        key: chapterKey(row),
        slug,
      })),
    };
  },

  async fetchChapter(chapter: ChapterRef, _token: string | null): Promise<ChapterContent> {
    const data = await api.getChapterData(chapter.slug, chapter.key);
    const pages = data.pages ?? [];

    const downloaded = await Promise.all(
      pages.map(async (page) => ({ page, image: await api.getImageByPath(page.url) }))
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