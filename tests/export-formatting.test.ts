import assert from "node:assert/strict";
import test from "node:test";
import JSZip from "jszip";
import fb2Exporter from "../src/export/fb2";
import epubExporter from "../src/export/epub";
import type { Book } from "../src/export/types";
import { escapeXml } from "../src/export/types";

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

test("XML escaping preserves supplementary Unicode and removes forbidden characters", () => {
  assert.equal(escapeXml("🌍𠮷\u{10ffff}"), "🌍𠮷\u{10ffff}");
  assert.equal(escapeXml("a\ud800b\udfffc\u0000\u0008\u000b\u000c\u001f\ufffe\uffff"), "abc");
  assert.equal(escapeXml("\t\n\r<&>\"'"), "\t\n\r&lt;&amp;&gt;&quot;&apos;");
});

test("FB2 and EPUB preserve supplementary Unicode in metadata and chapter text", async () => {
  const unicodeBook: Book = {
    title: "Книга 🌍",
    author: "Автор 𠮷",
    chapters: [{
      id: 1,
      title: "Глава 🌍",
      chunks: [{ kind: "text", text: "Текст 𠮷 🌍", styles: [], startsParagraph: true }],
    }],
  };
  const fb2 = await (await fb2Exporter.export(unicodeBook)).text();
  assert.ok(fb2.includes("Книга 🌍"));
  assert.ok(fb2.includes("Автор 𠮷"));
  assert.ok(fb2.includes("Глава 🌍"));
  assert.ok(fb2.includes("Текст 𠮷 🌍"));

  const zip = await JSZip.loadAsync(await epubExporter.export(unicodeBook));
  const opf = await zip.file("OEBPS/content.opf")!.async("text");
  const xhtml = await zip.file("OEBPS/chapter_1.xhtml")!.async("text");
  assert.ok(opf.includes("Книга 🌍"));
  assert.ok(opf.includes("Автор 𠮷"));
  assert.ok(xhtml.includes("Глава 🌍"));
  assert.ok(xhtml.includes("Текст 𠮷 🌍"));
});
