import type { ChapterContent, ChapterRef, Source, TitleMeta } from "./types";
import type { DataChunk, TextStyle } from "../core/models";
import { CdnlibsApi, chapterKey, chapterTitle } from "./cdnlibs";
import type { SiteHeaders } from "./cdnlibs";
import { libSocialTitle, libSocialToken, libSocialRequestPatch } from "./libsocial";

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

interface TextRun {
  text: string;
  styles: TextStyle[];
}

function addTextRun(runs: TextRun[], text: string, styles: TextStyle[]): void {
  if (!text) return;
  const previous = runs[runs.length - 1];
  if (previous && previous.styles.join("|") === styles.join("|")) {
    previous.text += text;
  } else {
    runs.push({ text, styles });
  }
}

function trimTextRuns(runs: TextRun[]): TextRun[] {
  const result = runs.filter((run) => run.text.length > 0).map((run) => ({ ...run }));
  const first = result[0];
  const last = result[result.length - 1];
  if (first) first.text = first.text.trimStart();
  if (last) last.text = last.text.trimEnd();
  return result.filter((run) => run.text.length > 0);
}

function htmlStyles(element: Element, inherited: TextStyle[]): TextStyle[] {
  const styles = new Set(inherited);
  const tag = element.tagName.toLowerCase();
  if (tag === "em" || tag === "i") styles.add("emphasis");
  if (tag === "strong" || tag === "b") styles.add("strong");
  return [...styles];
}

function collectHtmlText(node: Node, runs: TextRun[], inherited: TextStyle[] = []): void {
  if (node.nodeType === Node.TEXT_NODE) {
    addTextRun(runs, node.nodeValue ?? "", inherited);
    return;
  }

  if (node instanceof HTMLBRElement) {
    addTextRun(runs, "\n", inherited);
    return;
  }

  const styles = node instanceof Element ? htmlStyles(node, inherited) : inherited;
  for (const child of node.childNodes) collectHtmlText(child, runs, styles);
}

function textChunksFromRuns(runs: TextRun[]): DataChunk[] {
  return trimTextRuns(runs).map((run, index) => ({
    kind: "text",
    text: run.text,
    styles: run.styles,
    startsParagraph: index === 0,
  }));
}

function parseProseMirrorStyles(marks: any, inherited: TextStyle[]): TextStyle[] {
  const styles = new Set(inherited);
  if (!Array.isArray(marks)) return [...styles];
  for (const mark of marks) {
    const type = mark?.type;
    if (type === "em" || type === "italic") styles.add("emphasis");
    if (type === "strong" || type === "bold") styles.add("strong");
  }
  return [...styles];
}

function collectProseMirrorText(node: any, runs: TextRun[], inherited: TextStyle[] = []): void {
  const styles = parseProseMirrorStyles(node?.marks, inherited);
  if (node?.type === "text") {
    addTextRun(runs, typeof node.text === "string" ? node.text : "", styles);
    return;
  }
  if (node?.type === "hardBreak") {
    addTextRun(runs, "\n", styles);
    return;
  }

  const content = Array.isArray(node?.content) ? node.content : [];
  for (const child of content) collectProseMirrorText(child, runs, styles);
}

async function parseHtmlToChunks(html: string): Promise<DataChunk[]> {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const chunks: DataChunk[] = [];

  for (const node of doc.body.querySelectorAll("p, img")) {
    if (node instanceof HTMLParagraphElement) {
      const runs: TextRun[] = [];
      collectHtmlText(node, runs);
      chunks.push(...textChunksFromRuns(runs));
    } else if (node instanceof HTMLImageElement) {
      const src = node.getAttribute("src") ?? "";
      if (!src) continue;
      const image = await api.getImageByUrl(SITE, absolute(src));
      chunks.push({ kind: "image", data: image.data, mime: image.mime });
    }
  }

  return chunks;
}

async function parseProseMirrorToChunks(
  doc: any,
  attachments: Map<string, string>
): Promise<DataChunk[]> {
  const chunks: DataChunk[] = [];
  const content = Array.isArray(doc?.content) ? doc.content : [];

  for (const node of content) {
    if (node?.type === "paragraph") {
      const runs: TextRun[] = [];
      collectProseMirrorText(node, runs);
      chunks.push(...textChunksFromRuns(runs));
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
  key: "ranobelib",
  kind: "novel",

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
    const content = data.content;

    if (typeof content === "string") {
      const chunks = await parseHtmlToChunks(content);
      if (chunks.length === 0) {
        throw new Error(`Глава «${chapter.title}» не содержит ни текста, ни иллюстраций.`);
      }
      return { chunks };
    }

    if (content && typeof content === "object") {
      const attachments = new Map(
        (data.attachments ?? []).map((a) => [a.name, a.url])
      );
      const chunks = await parseProseMirrorToChunks(content, attachments);
      if (chunks.length === 0) {
        throw new Error(`Глава «${chapter.title}» не содержит ни текста, ни иллюстраций.`);
      }
      return { chunks };
    }

    throw new Error(
      `Глава «${chapter.title}»: не удалось распознать формат содержимого (${typeof content}).`
    );
  },
};

export default source;
