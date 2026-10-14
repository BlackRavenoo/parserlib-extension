import type { Book, Exporter } from "./types";
import type { TextChunk, TextStyle } from "../core/models";

const PAGE_WIDTH = 1240;
const PAGE_HEIGHT = 1754;
const MARGIN = 96;
const LINE_HEIGHT = 40;
const PDF_PAGE_WIDTH = 595.28;
const PDF_PAGE_HEIGHT = 841.89;

interface RasterPage {
  width: number;
  height: number;
  jpeg: Uint8Array;
}

function wrapText(context: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const lines: string[] = [];

  for (const paragraphLine of text.split(/\r?\n/)) {
    const words = paragraphLine.split(/\s+/).filter(Boolean);
    if (words.length === 0) {
      lines.push("");
      continue;
    }

    let line = "";
    for (const word of words) {
      const candidate = line ? `${line} ${word}` : word;
      if (!line || context.measureText(candidate).width <= maxWidth) {
        line = candidate;
      } else {
        lines.push(line);
        line = word;
      }
    }
    lines.push(line);
  }

  return lines;
}

interface StyledText {
  text: string;
  styles: TextStyle[];
}

interface StyledWord {
  segments: StyledText[];
  spaceBefore: StyledText[];
}

type StyledToken = StyledWord | { newline: true };

function fontFor(styles: TextStyle[], fontSize: number): string {
  const parts: string[] = [];
  if (styles.includes("emphasis")) parts.push("italic");
  if (styles.includes("strong")) parts.push("bold");
  parts.push(`${fontSize}px Arial, sans-serif`);
  return parts.join(" ");
}

function measureStyled(context: CanvasRenderingContext2D, segments: StyledText[], fontSize: number): number {
  return segments.reduce((width, segment) => {
    context.font = fontFor(segment.styles, fontSize);
    return width + context.measureText(segment.text).width;
  }, 0);
}

function mergeStyledText(target: StyledText[], text: string, styles: TextStyle[]): void {
  const last = target[target.length - 1];
  if (last && last.styles.join("|") === styles.join("|")) last.text += text;
  else target.push({ text, styles });
}

function styledTokens(chunks: TextChunk[]): StyledToken[] {
  const tokens: StyledToken[] = [];
  let currentWord: StyledText[] = [];
  let spaceBefore: StyledText[] = [];

  const flushWord = () => {
    if (currentWord.length === 0) return;
    tokens.push({ segments: currentWord, spaceBefore });
    currentWord = [];
    spaceBefore = [];
  };

  for (const chunk of chunks) {
    const pieces = chunk.text.match(/\n|[^\S\n]+|[^\s]+/gu) ?? [];
    for (const piece of pieces) {
      if (piece === "\n") {
        flushWord();
        spaceBefore = [];
        tokens.push({ newline: true });
      } else if (/^\s+$/u.test(piece)) {
        flushWord();
        mergeStyledText(spaceBefore, piece, chunk.styles);
      } else {
        mergeStyledText(currentWord, piece, chunk.styles);
      }
    }
  }
  flushWord();
  return tokens;
}

function wrapStyledText(
  context: CanvasRenderingContext2D,
  chunks: TextChunk[],
  maxWidth: number,
  fontSize: number
): StyledText[][] {
  const lines: StyledText[][] = [];
  let line: StyledText[] = [];
  let lineWidth = 0;

  const flushLine = () => {
    lines.push(line);
    line = [];
    lineWidth = 0;
  };

  for (const token of styledTokens(chunks)) {
    if ("newline" in token) {
      flushLine();
      continue;
    }

    const wordWidth = measureStyled(context, token.segments, fontSize);
    const spaceWidth = line.length ? measureStyled(context, token.spaceBefore, fontSize) : 0;
    if (line.length > 0 && lineWidth + spaceWidth + wordWidth > maxWidth) {
      flushLine();
    } else if (spaceWidth > 0) {
      for (const space of token.spaceBefore) mergeStyledText(line, space.text, space.styles);
      lineWidth += spaceWidth;
    }

    for (const segment of token.segments) mergeStyledText(line, segment.text, segment.styles);
    lineWidth += wordWidth;
  }

  if (line.length > 0 || lines.length === 0) flushLine();
  return lines;
}

function canvasToJpeg(canvas: HTMLCanvasElement): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(async (blob) => {
      if (!blob) {
        reject(new Error("Не удалось создать страницу PDF."));
        return;
      }
      resolve(new Uint8Array(await blob.arrayBuffer()));
    }, "image/jpeg", 0.88);
  });
}

function getContext(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Не удалось создать страницу PDF.");
  return context;
}

function bytes(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

function makePdf(pages: RasterPage[]): Blob {
  const objectCount = 2 + pages.length * 3;
  const parts: Uint8Array[] = [bytes("%PDF-1.4\n%\xE2\xE3\xCF\xD3\n")];
  const offsets = new Array<number>(objectCount + 1).fill(0);
  let offset = parts[0]!.length;

  const addObject = (id: number, content: Uint8Array[]) => {
    offsets[id] = offset;
    const objectParts = [bytes(`${id} 0 obj\n`), ...content, bytes("\nendobj\n")];
    for (const part of objectParts) {
      parts.push(part);
      offset += part.length;
    }
  };

  const pageIds = pages.map((_, index) => 3 + index * 3);
  addObject(1, [bytes(`<< /Type /Catalog /Pages 2 0 R >>`)]);
  addObject(2, [bytes(`<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pages.length} >>`)]);

  pages.forEach((page, index) => {
    const pageId = pageIds[index]!;
    const imageId = pageId + 1;
    const contentId = pageId + 2;
    const content = bytes(
      `q\n${PDF_PAGE_WIDTH} 0 0 ${PDF_PAGE_HEIGHT} 0 0 cm\n/Im0 Do\nQ`
    );

    addObject(pageId, [bytes(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PDF_PAGE_WIDTH} ${PDF_PAGE_HEIGHT}] ` +
      `/Resources << /XObject << /Im0 ${imageId} 0 R >> >> /Contents ${contentId} 0 R >>`
    )]);
    addObject(imageId, [
      bytes(
        `<< /Type /XObject /Subtype /Image /Width ${page.width} /Height ${page.height} ` +
        `/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${page.jpeg.length} >>\nstream\n`
      ),
      page.jpeg,
      bytes("\nendstream"),
    ]);
    addObject(contentId, [bytes(`<< /Length ${content.length} >>\nstream\n`), content, bytes("\nendstream")]);
  });

  const xrefOffset = offset;
  const xref = ["xref", `0 ${objectCount + 1}`, "0000000000 65535 f "];
  for (let id = 1; id <= objectCount; id++) {
    xref.push(`${String(offsets[id]).padStart(10, "0")} 00000 n `);
  }
  parts.push(bytes(`${xref.join("\n")}\ntrailer\n<< /Size ${objectCount + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`));

  return new Blob(parts as unknown as BlobPart[], { type: "application/pdf" });
}

const pdfExporter: Exporter = {
  extension: "pdf",

  async export(book: Book): Promise<Blob> {
    const pages: RasterPage[] = [];
    let canvas = document.createElement("canvas");
    canvas.width = PAGE_WIDTH;
    canvas.height = PAGE_HEIGHT;
    let context = getContext(canvas);

    const startPage = () => {
      canvas = document.createElement("canvas");
      canvas.width = PAGE_WIDTH;
      canvas.height = PAGE_HEIGHT;
      context = getContext(canvas);
      context.fillStyle = "#fff";
      context.fillRect(0, 0, PAGE_WIDTH, PAGE_HEIGHT);
      context.fillStyle = "#161616";
      return MARGIN;
    };

    context.fillStyle = "#fff";
    context.fillRect(0, 0, PAGE_WIDTH, PAGE_HEIGHT);
    context.fillStyle = "#161616";
    let y = MARGIN;

    const finishPage = async () => {
      pages.push({ width: PAGE_WIDTH, height: PAGE_HEIGHT, jpeg: await canvasToJpeg(canvas) });
    };

    const ensureSpace = async (height: number) => {
      if (y + height > PAGE_HEIGHT - MARGIN) {
        await finishPage();
        y = startPage();
      }
    };

    const drawText = async (text: string, font: string, lineHeight: number, gapAfter: number) => {
      context!.font = font;
      const lines = wrapText(context!, text, PAGE_WIDTH - MARGIN * 2);
      for (const line of lines) {
        await ensureSpace(lineHeight);
        context!.fillText(line, MARGIN, y);
        y += lineHeight;
      }
      y += gapAfter;
    };

    const drawStyledText = async (paragraph: TextChunk[]) => {
      const headingLevel = paragraph[0]?.headingLevel;
      const fontSize = headingLevel ? Math.max(28, 40 - headingLevel * 2) : 26;
      const lineHeight = headingLevel ? fontSize + 16 : LINE_HEIGHT;
      const lines = wrapStyledText(context!, paragraph, PAGE_WIDTH - MARGIN * 2, fontSize);
      for (const line of lines) {
        await ensureSpace(lineHeight);
        let x = MARGIN;
        for (const segment of line) {
          context!.font = fontFor(headingLevel ? [...segment.styles, "strong"] : segment.styles, fontSize);
          context!.fillText(segment.text, x, y);
          x += context!.measureText(segment.text).width;
        }
        y += lineHeight;
      }
      y += headingLevel ? 16 : 24;
    };

    if (book.coverImage) {
      const cover = await createImageBitmap(
        new Blob([book.coverImage.data.slice().buffer as ArrayBuffer], { type: book.coverImage.mime })
      );
      const scale = Math.min((PAGE_WIDTH - MARGIN * 2) / cover.width, (PAGE_HEIGHT - MARGIN * 2) / cover.height);
      const width = cover.width * scale;
      const height = cover.height * scale;
      context.drawImage(cover, (PAGE_WIDTH - width) / 2, y, width, height);
      cover.close();
      y += height + 48;
    }

    await drawText(book.title, "bold 52px Arial, sans-serif", 64, 24);
    if (book.author) await drawText(book.author, "30px Arial, sans-serif", 40, 64);

    for (const chapter of book.chapters) {
      await drawText(chapter.title, "bold 40px Arial, sans-serif", 52, 28);

      for (let chunkIndex = 0; chunkIndex < chapter.chunks.length;) {
        const chunk = chapter.chunks[chunkIndex]!;
        if (chunk.kind === "text") {
          const paragraph = [chunk];
          chunkIndex++;
          while (chunkIndex < chapter.chunks.length) {
            const next = chapter.chunks[chunkIndex]!;
            if (next.kind !== "text" || next.startsParagraph) break;
            paragraph.push(next);
            chunkIndex++;
          }
          await drawStyledText(paragraph);
          continue;
        }

        const image = await createImageBitmap(
          new Blob([chunk.data.slice().buffer as ArrayBuffer], { type: chunk.mime || "image/jpeg" })
        );
        const scale = Math.min(
          (PAGE_WIDTH - MARGIN * 2) / image.width,
          (PAGE_HEIGHT - MARGIN * 2) / image.height
        );
        const width = image.width * scale;
        const height = image.height * scale;
        await ensureSpace(height + 24);
        context!.drawImage(image, (PAGE_WIDTH - width) / 2, y, width, height);
        image.close();
        y += height + 24;
        chunkIndex++;
      }
    }

    await finishPage();
    return makePdf(pages);
  },
};

export default pdfExporter;
