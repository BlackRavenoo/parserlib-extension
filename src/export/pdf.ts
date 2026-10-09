import type { Book, Exporter } from "./types";

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

      for (const chunk of chapter.chunks) {
        if (chunk.kind === "text") {
          await drawText(chunk.text, "26px Arial, sans-serif", LINE_HEIGHT, 24);
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
      }
    }

    await finishPage();
    return makePdf(pages);
  },
};

export default pdfExporter;
