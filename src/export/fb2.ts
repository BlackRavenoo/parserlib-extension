import type { Book, Exporter } from "./types";

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

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

      chapter.chunks.forEach((chunk, chunkIndex) => {
        if (chunk.kind === "text") {
          section.push(`<p>${escapeXml(chunk.text)}</p>`);
          return;
        }

        const id = `img_${chapter.id}_${chunkIndex}`;
        section.push(`<image l:href="#${id}"/>`);
        binaries.push(
          `<binary id="${id}" content-type="image/jpeg">${bytesToBase64(chunk.data)}</binary>`
        );
      });

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
