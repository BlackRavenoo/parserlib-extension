import type JSZip from "jszip";
import type { Book, BookChapter, Exporter } from "./types";
import { escapeXml } from "./types";
import { renderTextChunk } from "./text";

function extFromMime(mime: string): string {
  const subtype = (mime.split(";")[0] ?? "").split("/")[1]?.trim() ?? "";
  if (!subtype) return "jpg";
  return subtype === "jpeg" ? "jpg" : subtype;
}

interface ChapterEntry {
  title: string;
  fileName: string;
}

function addChapter(zip: JSZip, chapter: BookChapter): { manifestItems: string[]; spineItem: string; tocEntry: ChapterEntry } {
  const fileName = `chapter_${chapter.id}.xhtml`;
  const parts: string[] = [];
  const manifestItems: string[] = [];
  let paragraph: Extract<BookChapter["chunks"][number], { kind: "text" }>[] = [];
  const flushParagraph = () => {
    if (paragraph.length > 0) {
      const headingLevel = paragraph[0]?.headingLevel;
      const tag = headingLevel ? `h${headingLevel}` : "p";
      parts.push(`<${tag}>${paragraph.map((chunk) => renderTextChunk(chunk, "xhtml")).join("")}</${tag}>`);
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
    const imgFileName = `images/img_${chapter.id}_${chunkIndex}.jpg`;
    const imgId = `img-${chapter.id}-${chunkIndex}`;
    zip.file(`OEBPS/${imgFileName}`, chunk.data);
    manifestItems.push(`<item id="${imgId}" href="${imgFileName}" media-type="image/jpeg"/>`);
    parts.push(`<img src="${imgFileName}" alt="page ${chunkIndex + 1}"/>`);
  });

  flushParagraph();
  const xhtml = `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml">
<head>
  <title>${escapeXml(chapter.title)}</title>
  <style>img { display: block; width: 100%; height: auto; } p { line-height: 1.6; }</style>
</head>
<body>
  <h2>${escapeXml(chapter.title)}</h2>
  ${parts.join("\n  ")}
</body>
</html>`;

  zip.file(`OEBPS/${fileName}`, xhtml);
  manifestItems.push(`<item id="ch-${chapter.id}" href="${fileName}" media-type="application/xhtml+xml"/>`);
  return {
    manifestItems,
    spineItem: `<itemref idref="ch-${chapter.id}"/>`,
    tocEntry: { title: chapter.title, fileName },
  };
}

function navListItem(entry: ChapterEntry): string {
  return `<li><a href="${entry.fileName}">${escapeXml(entry.title)}</a></li>`;
}

function ncxNavPoint(entry: ChapterEntry, index: number): string {
  return `<navPoint id="navpoint-${index}" playOrder="${index + 1}"><navLabel><text>${escapeXml(
    entry.title
  )}</text></navLabel><content src="${entry.fileName}"/></navPoint>`;
}

function insertBeforeClosing(xml: string, tag: string, items: string[]): string {
  const closing = `</${tag}>`;
  const index = xml.lastIndexOf(closing);
  if (index < 0) throw new Error(`EPUB повреждён: не найден закрывающий тег ${closing}.`);
  return `${xml.slice(0, index)}${items.join("\n")}${items.length ? "\n" : ""}${xml.slice(index)}`;
}

function replaceSection(xml: string, tag: string, items: string[]): string {
  const section = new RegExp(`(<${tag}\\b[^>]*>)[\\s\\S]*?(<\\/${tag}>)`);
  if (!section.test(xml)) throw new Error(`EPUB повреждён: не найден раздел ${tag}.`);
  return xml.replace(section, (_match, opening: string, closing: string) =>
    `${opening}\n    ${items.join("\n    ")}\n  ${closing}`
  );
}

function chapterTitlesFromNav(nav: string): Map<number, string> {
  const list = /<ol>([\s\S]*?)<\/ol>/.exec(nav)?.[1];
  if (list === undefined) throw new Error("EPUB повреждён: не найден список глав.");

  const titles = new Map<number, string>();
  const entries = list.matchAll(/<li><a href="chapter_(\d+)\.xhtml">([^<]*)<\/a><\/li>/g);
  for (const entry of entries) {
    const id = Number(entry[1]);
    if (titles.has(id)) throw new Error(`EPUB повреждён: глава ${id} повторяется в оглавлении.`);
    titles.set(id, entry[2]!);
  }
  return titles;
}

async function openExisting(file: Blob, title: string): Promise<{
  zip: JSZip;
  ids: Set<number>;
  titles: Map<number, string>;
  opf: string;
  nav: string;
  ncx: string;
}> {
  const { default: JSZip } = await import("jszip");
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(file);
  } catch {
    throw new Error("Не удалось открыть выбранный EPUB: файл не является ZIP-архивом.");
  }

  const required = ["mimetype", "OEBPS/content.opf", "OEBPS/nav.xhtml", "OEBPS/toc.ncx"];
  if (required.some((name) => !zip.file(name))) {
    throw new Error("Докачка поддерживается для EPUB, созданных этим расширением.");
  }
  const [mimetype, opf, nav, ncx] = await Promise.all([
    zip.file("mimetype")!.async("string"),
    zip.file("OEBPS/content.opf")!.async("string"),
    zip.file("OEBPS/nav.xhtml")!.async("string"),
    zip.file("OEBPS/toc.ncx")!.async("string"),
  ]);
  if (mimetype !== "application/epub+zip") throw new Error("Выбранный файл не является EPUB.");
  if (!opf.includes(`<dc:title>${escapeXml(title)}</dc:title>`)) {
    throw new Error("Название книги в EPUB не совпадает с текущим тайтлом.");
  }
  for (const tag of ["manifest", "spine"]) {
    if (!opf.includes(`</${tag}>`)) throw new Error("EPUB повреждён: неполный content.opf.");
  }
  if (!nav.includes("</ol>") || !ncx.includes("</navMap>")) {
    throw new Error("EPUB повреждён: неполное оглавление.");
  }

  const ids = new Set<number>();
  for (const name of Object.keys(zip.files)) {
    const match = /^OEBPS\/chapter_(\d+)\.xhtml$/.exec(name);
    if (!match) continue;
    const id = Number(match[1]);
    if (!opf.includes(`href="chapter_${id}.xhtml"`) || !opf.includes(`idref="ch-${id}"`)) {
      throw new Error(`EPUB повреждён: глава ${id} отсутствует в содержании.`);
    }
    ids.add(id);
  }
  if (ids.size === 0 || (ncx.match(/<navPoint\b/g) ?? []).length !== ids.size) {
    throw new Error("Докачка поддерживается для EPUB, созданных этим расширением.");
  }
  const titles = chapterTitlesFromNav(nav);
  if (titles.size !== ids.size || [...ids].some((id) => !titles.has(id))) {
    throw new Error("EPUB повреждён: оглавление не совпадает со списком глав.");
  }
  return { zip, ids, titles, opf, nav, ncx };
}

const epubExporter: Exporter = {
  extension: "epub",

  async export(book: Book): Promise<Blob> {
    const { default: JSZip } = await import("jszip");
    const zip = new JSZip();

    zip.file("mimetype", "application/epub+zip", { compression: "STORE" });

    zip.file(
      "META-INF/container.xml",
      `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`
    );

    const manifestItems: string[] = [];
    const spineItems: string[] = [];
    const tocEntries: ChapterEntry[] = [];

    if (book.coverImage) {
      const coverExt = extFromMime(book.coverImage.mime);
      zip.file(`OEBPS/images/cover.${coverExt}`, book.coverImage.data);
      manifestItems.push(
        `<item id="cover-img" href="images/cover.${coverExt}" media-type="${book.coverImage.mime}" properties="cover-image"/>`
      );
    }

    book.chapters.forEach((chapter) => {
      const entry = addChapter(zip, chapter);
      manifestItems.push(...entry.manifestItems);
      spineItems.push(entry.spineItem);
      tocEntries.push(entry.tocEntry);
    });

    const bookId = `urn:uuid:${crypto.randomUUID()}`;

    zip.file(
      "OEBPS/nav.xhtml",
      `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<head>
  <title>${escapeXml(book.title)}</title>
</head>
<body>
  <nav epub:type="toc" id="toc">
    <h1>Содержание</h1>
    <ol>
      ${tocEntries
        .map(navListItem)
        .join("\n      ")}
    </ol>
  </nav>
</body>
</html>`
    );

    zip.file(
      "OEBPS/content.opf",
      `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="BookId">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="BookId">${bookId}</dc:identifier>
    <dc:title>${escapeXml(book.title)}</dc:title>
    ${book.author ? `<dc:creator>${escapeXml(book.author)}</dc:creator>` : ""}
    <dc:language>ru</dc:language>
    <meta property="dcterms:modified">${new Date().toISOString().split(".")[0]}Z</meta>
  </metadata>
  <manifest>
    <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    ${manifestItems.join("\n    ")}
  </manifest>
  <spine toc="ncx">
    ${spineItems.join("\n    ")}
  </spine>
</package>`
    );

    zip.file(
      "OEBPS/toc.ncx",
      `<?xml version="1.0" encoding="UTF-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
  <head><meta name="dtb:uid" content="${bookId}"/></head>
  <docTitle><text>${escapeXml(book.title)}</text></docTitle>
  <navMap>
    ${tocEntries
      .map(ncxNavPoint)
      .join("\n    ")}
  </navMap>
</ncx>`
    );

    const content = await zip.generateAsync({ type: "uint8array" });
    return new Blob([content.buffer as ArrayBuffer], { type: "application/epub+zip" });
  },

  async inspectExisting(file: Blob, title: string): Promise<Set<number>> {
    const { ids } = await openExisting(file, title);
    return ids;
  },

  async append(book: Book, file: Blob): Promise<Blob> {
    const { zip, ids, titles, opf, nav, ncx } = await openExisting(file, book.title);
    const chapters = [...book.chapters].sort((a, b) => a.id - b.id);
    if (chapters.some((chapter) => !Number.isSafeInteger(chapter.id) || chapter.id < 0)) {
      throw new Error("Новые главы должны иметь корректные ID.");
    }
    if (chapters.some((chapter) => ids.has(chapter.id))) {
      throw new Error("Некоторые новые главы уже есть в EPUB.");
    }
    if (new Set(chapters.map((chapter) => chapter.id)).size !== chapters.length) {
      throw new Error("Список новых глав содержит повторы.");
    }
    if (chapters.length === 0) return file;

    const manifestItems: string[] = [];
    chapters.forEach((chapter) => {
      const entry = addChapter(zip, chapter);
      manifestItems.push(...entry.manifestItems);
      titles.set(chapter.id, escapeXml(chapter.title));
    });

    const orderedIds = [...titles.keys()].sort((a, b) => a - b);
    const spineItems = orderedIds.map((id) => `<itemref idref="ch-${id}"/>`);
    const navItems = orderedIds.map((id) => `<li><a href="chapter_${id}.xhtml">${titles.get(id)}</a></li>`);
    const ncxItems = orderedIds.map((id, index) =>
      `<navPoint id="navpoint-${index}" playOrder="${index + 1}"><navLabel><text>${titles.get(id)}</text></navLabel><content src="chapter_${id}.xhtml"/></navPoint>`
    );

    let nextOpf = insertBeforeClosing(opf, "manifest", manifestItems);
    nextOpf = replaceSection(nextOpf, "spine", spineItems);
    nextOpf = nextOpf.replace(
      /(<meta property="dcterms:modified">)[^<]*(<\/meta>)/,
      `$1${new Date().toISOString().split(".")[0]}Z$2`
    );
    zip.file("OEBPS/content.opf", nextOpf);
    zip.file("OEBPS/nav.xhtml", replaceSection(nav, "ol", navItems));
    zip.file("OEBPS/toc.ncx", replaceSection(ncx, "navMap", ncxItems));

    return zip.generateAsync({ type: "blob", mimeType: "application/epub+zip" });
  },
};

export default epubExporter;
