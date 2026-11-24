import assert from "node:assert/strict";
import test from "node:test";
import type { TestContext } from "node:test";
import pdfExporter from "../src/export/pdf";
import type { Book, ExportPageMetrics } from "../src/export/types";
import type { DataChunk } from "../src/core/models";
import { setGlobal } from "./helpers/globals";

const book: Book = {
  title: "Книга",
  chapters: [{ id: 1, title: "Глава", chunks: [
    { kind: "text", text: "Текст главы", styles: [], startsParagraph: true },
  ] }],
};

const tallJpeg = Buffer.from(
  "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAAQAAgDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAb/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAABgf/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCLAGVxf//Z",
  "base64"
);
const wideJpeg = Buffer.from(
  "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAAEABADASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAf/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAABQf/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCOALiMf//Z",
  "base64"
);

const picture = (data: Uint8Array): DataChunk => ({ kind: "image", data, mime: "image/jpeg" });
const withChunks = (...chunks: DataChunk[]): Book => ({
  ...book,
  chapters: [{ id: 1, title: "Глава", chunks }],
});

function setup(t: TestContext) {
  const draws: Array<{ page: number; text: string; font: string }> = [];
  const images: Array<{ page: number; y: number }> = [];
  let page = 0;
  setGlobal(t, "document", {
    createElement(tag: string) {
      assert.equal(tag, "canvas");
      const currentPage = ++page;
      const context = {
        font: "10px sans-serif",
        fillStyle: "#000",
        fillRect() {},
        drawImage(_image: ImageBitmap, _x: number, y: number) { images.push({ page: currentPage, y }); },
        measureText(text: string) { return { width: text.length * Number.parseFloat(this.font.replace(/^[^0-9]*/, "")) / 2 }; },
        fillText(text: string) { draws.push({ page: currentPage, text, font: this.font }); },
      };
      return {
        width: 0,
        height: 0,
        getContext: () => context,
        toBlob(callback: BlobCallback) { queueMicrotask(() => callback(new Blob([Uint8Array.of(255, 216, 255, 217)]))); },
      };
    },
  });
  const warn = t.mock.method(console, "warn", () => {});
  return { draws, images, warn, get canvasCount() { return page; } };
}

test("PDF keeps the title font after a cover forces a new page", async (t) => {
  const { draws } = setup(t);
  const close = t.mock.fn();
  setGlobal(t, "createImageBitmap", async () => ({ width: 1000, height: 1600, close }));
  const blob = await pdfExporter.export({ ...book, coverImage: { data: Uint8Array.of(1), mime: "image/png" } });
  assert.equal(blob.type, "application/pdf");
  assert.deepEqual(draws.find(({ text }) => text === book.title), { page: 2, text: book.title, font: "bold 52px Arial, sans-serif" });
  assert.ok(draws.some(({ text }) => text === "Текст главы"));
  assert.equal(close.mock.callCount(), 1);
});

test("PDF keeps a chapter heading font when it starts on a new page", async (t) => {
  const { draws } = setup(t);
  await pdfExporter.export({
    title: "Книга",
    chapters: [{ id: 1, title: "Первая", chunks: Array.from({ length: 23 }, () => ({
      kind: "text" as const, text: "Абзац", styles: [], startsParagraph: true,
    })) }, { id: 2, title: "Вторая", chunks: [] }],
  });
  assert.deepEqual(draws.find(({ text }) => text === "Вторая"), { page: 2, text: "Вторая", font: "bold 40px Arial, sans-serif" });
});

test("PDF skips an undecodable cover and exports the downloaded chapter", async (t) => {
  const { draws, warn } = setup(t);
  const error = new Error("Изображение повреждено");
  setGlobal(t, "createImageBitmap", async () => { throw error; });
  const blob = await pdfExporter.export({ ...book, coverImage: { data: new TextEncoder().encode("<html>Denied</html>"), mime: "text/html" } });
  assert.ok((await blob.text()).startsWith("%PDF-1.4"));
  assert.ok(draws.some(({ text }) => text === "Текст главы"));
  assert.equal(warn.mock.calls[0]?.arguments[1], error);
});

test("PDF still rejects an undecodable chapter image", async (t) => {
  setup(t);
  const error = new Error("Изображение главы повреждено");
  setGlobal(t, "createImageBitmap", async () => { throw error; });
  await assert.rejects(pdfExporter.export({ ...book, chapters: [{ id: 1, title: "Глава", chunks: [
    { kind: "image", data: Uint8Array.of(1), mime: "image/jpeg" },
  ] }] }), error);
});

test("PDF embeds JPEGs unchanged and lays out following text on a new page", async (t) => {
  const browser = setup(t);
  const decode = t.mock.fn(async () => { throw new Error("JPEG не должен декодироваться."); });
  setGlobal(t, "createImageBitmap", decode);
  const report = t.mock.fn<(_metrics: ExportPageMetrics) => void>();
  const pdf = await pdfExporter.export(withChunks(picture(tallJpeg), picture(tallJpeg), ...book.chapters[0]!.chunks), report);
  const output = Buffer.from(await pdf.arrayBuffer()).toString("latin1");

  assert.equal(decode.mock.callCount(), 0);
  assert.equal(browser.canvasCount, 2);
  assert.deepEqual(report.mock.calls.map(({ arguments: args }) => args[0]), [{ totalPages: 4, pagesWithoutCanvas: 2 }]);
  assert.equal(output.split(tallJpeg.toString("latin1")).length - 1, 2);
  const matrices = [...output.matchAll(/\bq\n([\d.]+) 0 0 ([\d.]+) ([\d.]+) ([\d.]+) cm\n/g)];
  assert.equal(matrices.length, 4);
  const [, width, height, x, y] = matrices[1]!.map(Number);
  assert.ok(Math.abs(width! + 2 * x! - 595.28) < 0.001);
  assert.ok(Math.abs(height! + 2 * y! - 841.89) < 0.001);
  assert.ok(browser.draws.some(({ page, text }) => page === 2 && text === "Текст главы"));
});

for (const following of [[], [picture(wideJpeg)]]) {
  test(`PDF paints a pending JPEG when ${following.length ? "a second image" : "text"} fits on the same page`, async (t) => {
    const browser = setup(t);
    const close = t.mock.fn();
    const decode = t.mock.fn(async () => ({ width: 16, height: 4, close }));
    setGlobal(t, "createImageBitmap", decode);
    const report = t.mock.fn<(_metrics: ExportPageMetrics) => void>();
    const pdf = await pdfExporter.export(
      withChunks(picture(tallJpeg), picture(wideJpeg), ...following, ...book.chapters[0]!.chunks),
      report
    );
    const output = Buffer.from(await pdf.arrayBuffer());

    assert.deepEqual(report.mock.calls[0]?.arguments[0], { totalPages: 3, pagesWithoutCanvas: 1 });
    assert.equal(decode.mock.callCount(), 1 + following.length);
    assert.equal(close.mock.callCount(), 1 + following.length);
    assert.deepEqual(browser.images, (following.length ? [96, 382] : [96]).map((y) => ({ page: 2, y })));
    assert.equal(browser.canvasCount, 2);
    assert.ok(output.includes(tallJpeg));
    assert.equal(output.includes(wideJpeg), false);
    assert.ok(browser.draws.some(({ page, text }) => page === 2 && text === "Текст главы"));
  });
}

test("PDF uses the browser decoder for a JPEG with EXIF metadata", async (t) => {
  setup(t);
  const image = Buffer.concat([tallJpeg.subarray(0, 2), Buffer.of(0xff, 0xe1, 0, 2), tallJpeg.subarray(2)]);
  const decode = t.mock.fn(async () => ({ width: 8, height: 16, close() {} }));
  setGlobal(t, "createImageBitmap", decode);
  const report = t.mock.fn<(_metrics: ExportPageMetrics) => void>();
  const pdf = await pdfExporter.export(withChunks(picture(image)), report);
  assert.equal(decode.mock.callCount(), 1);
  assert.deepEqual(report.mock.calls[0]?.arguments[0], { totalPages: 2, pagesWithoutCanvas: 0 });
  assert.equal(Buffer.from(await pdf.arrayBuffer()).includes(image), false);
});
