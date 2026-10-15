import assert from "node:assert/strict";
import test from "node:test";
import { parseProseMirrorToChunks } from "../src/sources/ranobelib";
import fb2Exporter from "../src/export/fb2";
import epubExporter from "../src/export/epub";
import type { Book } from "../src/export/types";

const chapterContent = {
  type: "doc",
  content: [
    {
      type: "heading",
      attrs: { level: 2, textAlign: "center" },
      content: [{ type: "text", text: "Глава 1: Тест" }],
    },
    {
      type: "heading",
      attrs: { level: 3 },
      content: [{ type: "text", text: "Часть 1" }],
    },
    {
      type: "paragraph",
      content: [
        { type: "text", text: "Обычный " },
        { type: "text", text: "курсивный", marks: [{ type: "italic" }] },
        { type: "text", text: " и " },
        { type: "text", text: "жирный", marks: [{ type: "bold" }] },
        { type: "text", text: " текст." },
      ],
    },
  ],
};

const book: Book = {
  title: "Тестовая книга",
  chapters: [
    {
      id: 1,
      title: "Глава",
      chunks: [
        { kind: "text", text: "Заголовок", styles: [], startsParagraph: true, headingLevel: 2 },
        { kind: "text", text: "Текст", styles: ["emphasis", "strong"], startsParagraph: true },
      ],
    },
  ],
};

test("RanobeLib ProseMirror headings and inline styles survive parsing", async () => {
  const chunks = await parseProseMirrorToChunks(chapterContent, new Map());

  assert.deepEqual(chunks, [
    { kind: "text", text: "Глава 1: Тест", styles: [], startsParagraph: true, headingLevel: 2 },
    { kind: "text", text: "Часть 1", styles: [], startsParagraph: true, headingLevel: 3 },
    { kind: "text", text: "Обычный ", styles: [], startsParagraph: true },
    { kind: "text", text: "курсивный", styles: ["emphasis"], startsParagraph: false },
    { kind: "text", text: " и ", styles: [], startsParagraph: false },
    { kind: "text", text: "жирный", styles: ["strong"], startsParagraph: false },
    { kind: "text", text: " текст.", styles: [], startsParagraph: false },
  ]);
});

test("FB2 keeps heading blocks and inline emphasis in the output", async () => {
  const xml = await (await fb2Exporter.export(book)).text();

  assert.match(xml, /<subtitle><p>Заголовок<\/p><\/subtitle>/);
  assert.match(xml, /<p><emphasis><strong>Текст<\/strong><\/emphasis><\/p>/);
});

test("EPUB keeps heading levels and inline emphasis in the chapter XHTML", async () => {
  const blob = await epubExporter.export(book);
  const { default: JSZip } = await import("jszip");
  const zip = await JSZip.loadAsync(blob);
  const xhtml = await zip.file("OEBPS/chapter_1.xhtml")!.async("text");

  assert.match(xhtml, /<h2>Заголовок<\/h2>/);
  assert.match(xhtml, /<p><em><strong>Текст<\/strong><\/em><\/p>/);
});
