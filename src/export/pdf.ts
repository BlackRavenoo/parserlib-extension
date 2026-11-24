import type { Book, Exporter } from "./types";
import type { TextChunk, TextStyle } from "../core/models";
import { readPdfJpeg } from "./pdf-jpeg";
import type { PdfJpegInfo } from "./pdf-jpeg";

const PAGE_WIDTH = 1240;
const PAGE_HEIGHT = 1754;
const MARGIN = 96;
const LINE_HEIGHT = 40;
const PDF_PAGE_WIDTH = 595.28;
const PDF_PAGE_HEIGHT = 841.89;

interface ImagePlacement {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface PdfPage extends PdfJpegInfo {
  jpeg: Uint8Array;
  placement?: ImagePlacement;
}

interface PendingJpeg extends PdfJpegInfo {
  jpeg: Uint8Array;
  mime: string;
  placement: ImagePlacement;
}

interface RasterCanvas {
  canvas: HTMLCanvasElement;
  context: CanvasRenderingContext2D;
}

interface ImageDimensions {
  width: number;
  height: number;
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

function fittedImage({ width, height }: ImageDimensions): ImageDimensions {
  const scale = Math.min((PAGE_WIDTH - MARGIN * 2) / width, (PAGE_HEIGHT - MARGIN * 2) / height);
  return { width: width * scale, height: height * scale };
}

function drawImage(
  context: CanvasRenderingContext2D,
  image: ImageBitmap,
  { x, y, width, height }: ImagePlacement
): void {
  context.drawImage(image, x, y, width, height);
}

function decodeImage(data: Uint8Array, mime: string): Promise<ImageBitmap> {
  return createImageBitmap(new Blob([data.slice().buffer as ArrayBuffer], { type: mime }));
}

function bytes(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

function pageImageMatrix(placement?: ImagePlacement): string {
  if (!placement) return `${PDF_PAGE_WIDTH} 0 0 ${PDF_PAGE_HEIGHT} 0 0`;
  const scaleX = PDF_PAGE_WIDTH / PAGE_WIDTH;
  const scaleY = PDF_PAGE_HEIGHT / PAGE_HEIGHT;
  return `${(placement.width * scaleX).toFixed(5)} 0 0 ${(placement.height * scaleY).toFixed(5)} ` +
    `${(placement.x * scaleX).toFixed(5)} ${((PAGE_HEIGHT - placement.y - placement.height) * scaleY).toFixed(5)}`;
}

function makePdf(pages: PdfPage[]): Blob {
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
      `q\n${pageImageMatrix(page.placement)} cm\n/Im0 Do\nQ`
    );

    addObject(pageId, [bytes(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PDF_PAGE_WIDTH} ${PDF_PAGE_HEIGHT}] ` +
      `/Resources << /XObject << /Im0 ${imageId} 0 R >> >> /Contents ${contentId} 0 R >>`
    )]);
    addObject(imageId, [
      bytes(
        `<< /Type /XObject /Subtype /Image /Width ${page.width} /Height ${page.height} ` +
        `/ColorSpace ${page.colorSpace} /BitsPerComponent 8 /Filter /DCTDecode /Length ${page.jpeg.length} >>\nstream\n`
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

  async export(book: Book, reportPages): Promise<Blob> {
    const pages: PdfPage[] = [];
    let raster: RasterCanvas | undefined;
    let measurementContext: CanvasRenderingContext2D | undefined;
    let pendingJpeg: PendingJpeg | undefined;
    let pagesWithoutCanvas = 0;
    let y = MARGIN;

    const getRaster = () => {
      if (raster) return raster;
      const canvas = document.createElement("canvas");
      canvas.width = PAGE_WIDTH;
      canvas.height = PAGE_HEIGHT;
      const context = getContext(canvas);
      context.fillStyle = "#fff";
      context.fillRect(0, 0, PAGE_WIDTH, PAGE_HEIGHT);
      context.fillStyle = "#161616";
      raster = { canvas, context };
      measurementContext = context;
      return raster;
    };

    const paintJpeg = async (context: CanvasRenderingContext2D, page: PendingJpeg) => {
      const image = await decodeImage(page.jpeg, page.mime);
      try {
        drawImage(context, image, page.placement);
      } finally {
        image.close();
      }
    };

    const rasterContext = async () => {
      const { context } = getRaster();
      if (pendingJpeg) {
        await paintJpeg(context, pendingJpeg);
        pendingJpeg = undefined;
      }
      return context;
    };

    const finishPage = async () => {
      if (pendingJpeg) {
        pages.push(pendingJpeg);
        pagesWithoutCanvas++;
        pendingJpeg = undefined;
      } else {
        pages.push({
          width: PAGE_WIDTH,
          height: PAGE_HEIGHT,
          jpeg: await canvasToJpeg(getRaster().canvas),
          colorSpace: "/DeviceRGB",
        });
      }
      raster = undefined;
      y = MARGIN;
    };

    const ensureSpace = async (height: number) => {
      if (y + height > PAGE_HEIGHT - MARGIN) {
        await finishPage();
      }
    };

    const drawText = async (text: string, font: string, lineHeight: number, gapAfter: number) => {
      const measure = measurementContext ?? getRaster().context;
      measure.font = font;
      const lines = wrapText(measure, text, PAGE_WIDTH - MARGIN * 2);
      for (const line of lines) {
        await ensureSpace(lineHeight);
        const context = await rasterContext();
        context.font = font;
        context.fillText(line, MARGIN, y);
        y += lineHeight;
      }
      y += gapAfter;
    };

    const drawStyledText = async (paragraph: TextChunk[]) => {
      const headingLevel = paragraph[0]?.headingLevel;
      const fontSize = headingLevel ? Math.max(28, 40 - headingLevel * 2) : 26;
      const lineHeight = headingLevel ? fontSize + 16 : LINE_HEIGHT;
      const lines = wrapStyledText(measurementContext ?? getRaster().context, paragraph, PAGE_WIDTH - MARGIN * 2, fontSize);
      for (const line of lines) {
        await ensureSpace(lineHeight);
        if (line.length > 0) {
          const context = await rasterContext();
          let x = MARGIN;
          for (const segment of line) {
            context.font = fontFor(headingLevel ? [...segment.styles, "strong"] : segment.styles, fontSize);
            context.fillText(segment.text, x, y);
            x += context.measureText(segment.text).width;
          }
        }
        y += lineHeight;
      }
      y += headingLevel ? 16 : 24;
    };

    if (book.coverImage) {
      let cover: ImageBitmap | undefined;
      try {
        cover = await decodeImage(book.coverImage.data, book.coverImage.mime);
      } catch (err) {
        console.warn("[parserlib] обложка не распознана, PDF будет без неё", err);
      }
      if (cover) {
        try {
          const { width, height } = fittedImage(cover);
          drawImage(getRaster().context, cover, { x: (PAGE_WIDTH - width) / 2, y, width, height });
          y += height + 48;
        } finally {
          cover.close();
        }
      }
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

        const mime = chunk.mime || "image/jpeg";
        const jpeg = readPdfJpeg(chunk.data);
        const bitmap = jpeg ? undefined : await decodeImage(chunk.data, mime);
        try {
          const { width, height } = fittedImage(jpeg ?? bitmap!);
          await ensureSpace(height + 24);
          const placement = { x: (PAGE_WIDTH - width) / 2, y, width, height };
          if (jpeg) {
            const pageImage = { ...jpeg, jpeg: chunk.data, mime, placement };
            if (raster || pendingJpeg) await paintJpeg(await rasterContext(), pageImage);
            else pendingJpeg = pageImage;
          } else {
            drawImage(await rasterContext(), bitmap!, placement);
          }
          y += height + 24;
        } finally {
          bitmap?.close();
        }
        chunkIndex++;
      }
    }

    await finishPage();
    const blob = makePdf(pages);
    reportPages?.({ totalPages: pages.length, pagesWithoutCanvas });
    return blob;
  },
};

export default pdfExporter;
