import assert from "node:assert/strict";
import test from "node:test";
import type { TestContext } from "node:test";
import pdfExporter from "../src/export/pdf";
import type { Book } from "../src/export/types";
import { setGlobal } from "./helpers/globals";

const book: Book = {
  title: "Книга",
  chapters: [{ id: 1, title: "Глава", chunks: [
    { kind: "text", text: "Текст главы", styles: [], startsParagraph: true },
  ] }],
};

function setup(t: TestContext) {
  const draws: Array<{ page: number; text: string; font: string }> = [];
  let page = 0;
  setGlobal(t, "document", {
    createElement(tag: string) {
      assert.equal(tag, "canvas");
      const currentPage = ++page;
      const context = {
        font: "10px sans-serif",
        fillStyle: "#000",
        fillRect() {},
        drawImage() {},
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
  return { draws, warn };
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
