import type { Book, Exporter } from "./types";

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function extFromMime(mime: string): string {
  const subtype = (mime.split(";")[0] ?? "").split("/")[1]?.trim() ?? "";
  if (!subtype) return "jpg";
  return subtype === "jpeg" ? "jpg" : subtype;
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
    const navPoints: string[] = [];

    if (book.coverImage) {
      const coverExt = extFromMime(book.coverImage.mime);
      zip.file(`OEBPS/images/cover.${coverExt}`, book.coverImage.data);
      manifestItems.push(
        `<item id="cover-img" href="images/cover.${coverExt}" media-type="${book.coverImage.mime}" properties="cover-image"/>`
      );
    }

    book.chapters.forEach((chapter, i) => {
      const fileName = `chapter_${chapter.id}.xhtml`;
      const parts: string[] = [];

      chapter.chunks.forEach((chunk, chunkIndex) => {
        if (chunk.kind === "text") {
          parts.push(`<p>${escapeXml(chunk.text)}</p>`);
          return;
        }

        const imgFileName = `images/img_${chapter.id}_${chunkIndex}.jpg`;
        const imgId = `img-${chapter.id}-${chunkIndex}`;

        zip.file(`OEBPS/${imgFileName}`, chunk.data);
        manifestItems.push(
          `<item id="${imgId}" href="${imgFileName}" media-type="image/jpeg"/>`
        );
        parts.push(`<img src="${imgFileName}" alt="page ${chunkIndex + 1}"/>`);
      });

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
      manifestItems.push(
        `<item id="ch-${chapter.id}" href="${fileName}" media-type="application/xhtml+xml"/>`
      );
      spineItems.push(`<itemref idref="ch-${chapter.id}"/>`);
      navPoints.push(
        `<navPoint id="navpoint-${i}" playOrder="${i + 1}"><navLabel><text>${escapeXml(
          chapter.title
        )}</text></navLabel><content src="${fileName}"/></navPoint>`
      );
    });

    const bookId = `urn:uuid:${crypto.randomUUID()}`;

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
    ${navPoints.join("\n    ")}
  </navMap>
</ncx>`
    );

    const content = await zip.generateAsync({ type: "uint8array" });
    return new Blob([content.buffer as ArrayBuffer], { type: "application/epub+zip" });
  },
};

export default epubExporter;
