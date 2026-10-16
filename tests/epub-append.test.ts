import assert from "node:assert/strict";
import test from "node:test";
import JSZip from "jszip";
import epubExporter from "../src/export/epub";
import { getFormat, listFormats } from "../src/export/registry";
import { chaptersToAppend } from "../src/lib/append-plan";
import type { Book } from "../src/export/types";
import type { ChapterRef } from "../src/sources/types";

const firstBook: Book = {
  title: "Книга & главы",
  chapters: [
    {
      id: 1,
      title: "Глава 1",
      chunks: [{ kind: "text", text: "Старый текст", styles: [], startsParagraph: true }],
    },
  ],
};

const nextBook: Book = {
  title: firstBook.title,
  chapters: [
    {
      id: 2,
      title: "Глава 2",
      chunks: [
        { kind: "text", text: "Новый текст", styles: ["strong"], startsParagraph: true },
        { kind: "image", data: new Uint8Array([1, 2, 3]), mime: "image/jpeg" },
      ],
    },
  ],
};

test("format capabilities are exposed by the registry", () => {
  assert.deepEqual(listFormats().map(({ key, supportsAppend }) => [key, supportsAppend]), [
    ["fb2", false],
    ["epub", true],
    ["pdf", false],
  ]);
  assert.equal(getFormat("epub").extension, "epub");
});

test("append plan skips downloaded chapters and includes gaps before the file's last chapter", () => {
  const chapters: ChapterRef[] = [1, 2, 3].map((id) => ({ id, title: `Глава ${id}`, key: String(id), slug: "book" }));
  assert.deepEqual(chaptersToAppend(chapters, new Set([1, 2])), [chapters[2]]);
  assert.deepEqual(chaptersToAppend(chapters, new Set([1, 2, 3])), []);
  assert.deepEqual(chaptersToAppend(chapters, new Set([1, 3])), [chapters[1]]);
});

test("EPUB append preserves old content and updates the package and both contents lists", async () => {
  const original = await epubExporter.export(firstBook);
  assert.deepEqual(await epubExporter.inspectExisting!(original, firstBook.title), new Set([1]));
  const completed = await epubExporter.append!(nextBook, original);
  assert.deepEqual(await epubExporter.inspectExisting!(completed, firstBook.title), new Set([1, 2]));

  const bytes = new Uint8Array(await completed.arrayBuffer());
  assert.equal(new DataView(bytes.buffer).getUint32(0, true), 0x04034b50);
  assert.equal(new DataView(bytes.buffer).getUint16(8, true), 0);
  assert.equal(new TextDecoder().decode(bytes.subarray(30, 38)), "mimetype");

  const oldZip = await JSZip.loadAsync(original);
  const zip = await JSZip.loadAsync(completed);
  const oldChapter = await oldZip.file("OEBPS/chapter_1.xhtml")!.async("string");
  assert.equal(await zip.file("OEBPS/chapter_1.xhtml")!.async("string"), oldChapter);
  assert.match(await zip.file("OEBPS/chapter_2.xhtml")!.async("string"), /Новый текст/);
  assert.deepEqual(await zip.file("OEBPS/images/img_2_1.jpg")!.async("uint8array"), new Uint8Array([1, 2, 3]));

  const opf = await zip.file("OEBPS/content.opf")!.async("string");
  const nav = await zip.file("OEBPS/nav.xhtml")!.async("string");
  const ncx = await zip.file("OEBPS/toc.ncx")!.async("string");
  assert.match(opf, /href="chapter_2.xhtml"/);
  assert.match(opf, /idref="ch-2"/);
  assert.match(opf, /href="images\/img_2_1.jpg"/);
  assert.match(nav, /<a href="chapter_2.xhtml">Глава 2<\/a>/);
  assert.match(ncx, /playOrder="2"/);
  assert.equal((ncx.match(/<navPoint\b/g) ?? []).length, 2);
});

test("EPUB append rejects another book and duplicate chapters", async () => {
  const original = await epubExporter.export(firstBook);
  await assert.rejects(epubExporter.inspectExisting!(original, "Другая книга"), /не совпадает/);
  await assert.rejects(epubExporter.append!(firstBook, original), /уже есть в EPUB/);
});

test("an EPUB can be continued more than once", async () => {
  const original = await epubExporter.export(firstBook);
  const second = await epubExporter.append!(nextBook, original);
  const third = await epubExporter.append!(
    {
      title: firstBook.title,
      chapters: [{ id: 3, title: "Глава 3", chunks: [{ kind: "text", text: "Конец", styles: [], startsParagraph: true }] }],
    },
    second
  );
  assert.deepEqual(await epubExporter.inspectExisting!(third, firstBook.title), new Set([1, 2, 3]));
  const zip = await JSZip.loadAsync(third);
  const ncx = await zip.file("OEBPS/toc.ncx")!.async("string");
  assert.equal((ncx.match(/<navPoint\b/g) ?? []).length, 3);
  assert.match(ncx, /playOrder="3"/);
});
