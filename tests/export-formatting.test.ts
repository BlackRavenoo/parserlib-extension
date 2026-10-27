import assert from "node:assert/strict";
import test from "node:test";
import JSZip from "jszip";
import fb2Exporter from "../src/export/fb2";
import epubExporter from "../src/export/epub";
import type { Book } from "../src/export/types";

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

test("FB2 keeps heading blocks and inline emphasis in the output", async () => {
  const xml = await (await fb2Exporter.export(book)).text();

  assert.match(xml, /<subtitle><p>Заголовок<\/p><\/subtitle>/);
  assert.match(xml, /<p><emphasis><strong>Текст<\/strong><\/emphasis><\/p>/);
});

test("EPUB keeps heading levels and inline emphasis in the chapter XHTML", async () => {
  const blob = await epubExporter.export(book);
  const zip = await JSZip.loadAsync(blob);
  const xhtml = await zip.file("OEBPS/chapter_1.xhtml")!.async("text");

  assert.match(xhtml, /<h2>Заголовок<\/h2>/);
  assert.match(xhtml, /<p><em><strong>Текст<\/strong><\/em><\/p>/);
});
