import type { Book, Exporter } from "./types";
import { escapeXml } from "./types";
import { renderTextChunk } from "./text";

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

const fb2Exporter: Exporter = {
  extension: "fb2",

  async export(book: Book): Promise<Blob> {
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
      const section: string[] = [`<title><p>${escapeXml(chapter.title)}</p></title>`];
      let paragraph: Extract<(typeof chapter.chunks)[number], { kind: "text" }>[] = [];
      const flushParagraph = () => {
        if (paragraph.length > 0) {
          const text = paragraph.map((chunk) => renderTextChunk(chunk, "fb2")).join("");
          section.push(
            paragraph[0]?.headingLevel ? `<subtitle><p>${text}</p></subtitle>` : `<p>${text}</p>`
          );
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
        section.push(`<image l:href="#${id}"/>`);
        binaries.push(
          `<binary id="${id}" content-type="image/jpeg">${bytesToBase64(chunk.data)}</binary>`
        );
      });

      flushParagraph();
      body.push(`<section>${section.join("\n")}</section>`);
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

    return new Blob(parts, { type: "application/x-fictionbook+xml" });
  },
};

export default fb2Exporter;
