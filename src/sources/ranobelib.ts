import type { ChapterContent, ChapterRef, Source, TitleMeta } from "./types";
import type { DataChunk } from "../core/models";
import { CdnlibsApi, chapterKey, chapterTitle } from "./cdnlibs";
import type { SiteHeaders } from "./cdnlibs";

const SLUG_RE = /ranobelib\.me\/\w+\/(?:book\/)?(\d+--[a-z_-]+)/;
const SITE_ORIGIN = "https://ranobelib.me";

const SITE: SiteHeaders = { siteId: "3", service: "ranobelib" };
const api = new CdnlibsApi();

function extractSlug(url: string): string {
  const match = SLUG_RE.exec(url);
  if (!match) {
    throw new Error(
      `Не удалось вытащить slug тайтла из ссылки RanobeLib: ${url}. ` +
        `Ожидается что-то вроде https://ranobelib.me/ru/book/12345--title`
    );
  }
  return match[1]!;
}

function absolute(src: string): string {
  try {
    return new URL(src, SITE_ORIGIN).href;
  } catch {
    return src;
  }
}

async function parseHtmlToChunks(html: string): Promise<DataChunk[]> {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const chunks: DataChunk[] = [];

  for (const node of doc.body.querySelectorAll("p, img")) {
    if (node instanceof HTMLParagraphElement) {
      const text = (node.textContent ?? "").trim();
      if (text) chunks.push({ kind: "text", text });
    } else if (node instanceof HTMLImageElement) {
      const src = node.getAttribute("src") ?? "";
      if (!src) continue;
      const image = await api.getImageByUrl(SITE, absolute(src));
      chunks.push({ kind: "image", data: image.data, mime: image.mime });
    }
  }

  return chunks;
}

function extractProseMirrorText(node: any): string {
  const type = node?.type;

  if (type === "text") return typeof node.text === "string" ? node.text : "";
  if (type === "hardBreak") return "\n";

  const content = Array.isArray(node?.content) ? node.content : [];
  return content.map(extractProseMirrorText).join("");
}

// TODO: another node types???
async function parseProseMirrorToChunks(
  doc: any,
  attachments: Map<string, string>
): Promise<DataChunk[]> {
  const chunks: DataChunk[] = [];
  const content = Array.isArray(doc?.content) ? doc.content : [];

  for (const node of content) {
    if (node?.type === "paragraph") {
      const text = extractProseMirrorText(node).trim();
      if (text) chunks.push({ kind: "text", text });
    } else if (node?.type === "image") {
      const images = Array.isArray(node?.attrs?.images) ? node.attrs.images : [];
      for (const item of images) {
        const url = attachments.get(item?.image);
        if (!url) continue;
        const image = await api.getImageByUrl(SITE, absolute(url));
        chunks.push({ kind: "image", data: image.data, mime: image.mime });
      }
    }
  }

  return chunks;
}

const source: Source = {
  key: "ranobelib",
  kind: "novel",

  async fetchTitle(url: string, token: string | null): Promise<{ meta: TitleMeta; chapters: ChapterRef[] }> {
    api.setAuth(token);

    const slug = extractSlug(url);

    const [manga, rows] = await Promise.all([api.getManga(SITE, slug), api.getChapters(SITE, slug)]);

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
    const data = await api.getChapterData(SITE, chapter.slug, chapter.key);
    const content = data.content;

    if (typeof content === "string") {
      return { chunks: await parseHtmlToChunks(content) };
    }

    if (content && typeof content === "object") {
      const attachments = new Map(
        (data.attachments ?? []).map((a) => [a.name, a.url])
      );
      return { chunks: await parseProseMirrorToChunks(content, attachments) };
    }

    return { chunks: [] };
  },
};

export default source;
