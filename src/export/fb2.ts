import type { Book, BookChapter, Exporter } from "./types";
import { escapeXml, isBookIdentity } from "./types";
import { renderTextChunk } from "./text";
import { openExistingFb2 } from "./fb2-existing";

const FB2_MIME = "application/x-fictionbook+xml";

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

function validateChapters(chapters: BookChapter[]): void {
  const ids = chapters.map((chapter) => chapter.id);
  if (ids.some((id) => !Number.isSafeInteger(id) || id < 0)) throw new Error("Главы FB2 должны иметь корректные ID.");
  if (new Set(ids).size !== ids.length) throw new Error("Список глав FB2 содержит повторы.");
}

function renderChapter(chapter: BookChapter): { section: string; binaries: string[]; imageIds: string[] } {
  const section: string[] = [`<title><p>${escapeXml(chapter.title)}</p></title>`];
  const binaries: string[] = [];
  const imageIds: string[] = [];
  let paragraph: Extract<BookChapter["chunks"][number], { kind: "text" }>[] = [];
  const flushParagraph = () => {
    if (paragraph.length > 0) {
      const text = paragraph.map((chunk) => renderTextChunk(chunk, "fb2")).join("");
      section.push(paragraph[0]?.headingLevel ? `<subtitle><p>${text}</p></subtitle>` : `<p>${text}</p>`);
      paragraph = [];
    }
  };
  chapter.chunks.forEach((chunk, chunkIndex) => {
    if (chunk.kind === "text") {
      if (chunk.startsParagraph) flushParagraph();
      paragraph.push(chunk);
      return;
    }
    flushParagraph();
    const id = `img_${chapter.id}_${chunkIndex}`;
    imageIds.push(id);
    section.push(`<image l:href="#${id}"/>`);
    binaries.push(`<binary id="${id}" content-type="image/jpeg">${bytesToBase64(chunk.data)}</binary>`);
  });
  flushParagraph();
  return { section: `<section id="chapter_${chapter.id}">${section.join("\n")}</section>`, binaries, imageIds };
}

const fb2Exporter: Exporter = {
  extension: "fb2",

  async export(book: Book): Promise<Blob> {
    validateChapters(book.chapters);
    if (book.identity && !isBookIdentity(book.identity)) throw new Error("Некорректные сведения об источнике и ветке перевода.");
    const binaries: string[] = [];
    let coverRef = "";

    if (book.coverImage) {
      const id = "cover";
      coverRef = `<coverpage><image l:href="#${id}"/></coverpage>`;
      binaries.push(
        `<binary id="${id}" content-type="${book.coverImage.mime}">${bytesToBase64(
          book.coverImage.data
        )}</binary>`
      );
    }

    const body: string[] = [];

    for (const chapter of book.chapters) {
      const rendered = renderChapter(chapter);
      body.push(rendered.section);
      binaries.push(...rendered.binaries);
    }

    const parts: BlobPart[] = [
      `<?xml version="1.0" encoding="UTF-8"?>
<FictionBook xmlns="http://www.gribuser.ru/xml/fictionbook/2.0" xmlns:l="http://www.w3.org/1999/xlink">
  <description>
    <title-info>
      <book-title>${escapeXml(book.title)}</book-title>
      ${book.author ? `<author><nickname>${escapeXml(book.author)}</nickname></author>` : ""}
      ${coverRef}
    </title-info>
    <custom-info info-type="parserlib">${escapeXml(JSON.stringify({ version: 1, identity: book.identity }))}</custom-info>
  </description>
  <body>
`,
      ...body,
      `
  </body>
`,
      ...binaries,
      `
</FictionBook>`,
    ];

    return new Blob(parts, { type: FB2_MIME });
  },

  async inspectExisting(file, title, identity): Promise<Set<number>> {
    const { chapters } = await openExistingFb2(file, title, identity);
    return new Set(chapters.keys());
  },

  async append(book, file): Promise<Blob> {
    const existing = await openExistingFb2(file, book.title, book.identity);
    validateChapters(book.chapters);
    if (book.chapters.some((chapter) => existing.chapters.has(chapter.id))) throw new Error("Некоторые новые главы уже есть в FB2.");
    if (book.chapters.length === 0) return file;
    const chapters = new Map<number, Blob | string>(existing.chapters);
    const binaries: string[] = [];
    for (const chapter of book.chapters) {
      const rendered = renderChapter(chapter);
      if (existing.xmlIds.has(`chapter_${chapter.id}`) || rendered.imageIds.some((id) => existing.xmlIds.has(id))) {
        throw new Error("В FB2 уже используются идентификаторы изображений или секций новой главы.");
      }
      chapters.set(chapter.id, rendered.section);
      binaries.push(...rendered.binaries);
    }
    const ordered = [...chapters.entries()].sort(([first], [second]) => first - second);
    return new Blob([
      existing.prefix,
      ...ordered.map(([, section]) => section),
      "\n</body>\n",
      ...existing.binaries,
      ...binaries,
      "\n</FictionBook>",
    ], { type: FB2_MIME });
  },
};

export default fb2Exporter;
