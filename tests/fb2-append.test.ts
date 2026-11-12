import assert from "node:assert/strict";
import test from "node:test";
import { SaxesParser } from "saxes";
import fb2Exporter from "../src/export/fb2";
import type { Book, BookChapter } from "../src/export/types";

const identity = { sourceKey: "ranobelib", titleId: "123", branchId: 41 };
const chapter = (id: number): BookChapter => ({
  id, title: `Глава ${id} 🌍`, chunks: [
    { kind: "text", text: `Текст ${id} & 𠮷`, styles: ["emphasis", "strong"], startsParagraph: true },
    { kind: "image", data: Uint8Array.of(id, 0, 255), mime: "image/jpeg" },
  ],
});
const firstBook: Book = {
  title: "Книга & 🌍", author: "Автор 𠮷", identity,
  coverImage: { data: Uint8Array.of(8, 9, 10), mime: "image/png" },
  chapters: [chapter(1), chapter(3)],
};
const nextBook: Book = { title: firstBook.title, identity, chapters: [chapter(4), chapter(2)] };

function section(xml: string, id: number): string {
  return new RegExp(`<section id="chapter_${id}">[\\s\\S]*?</section>`).exec(xml)![0];
}

test("FB2 fills chapter gaps in order and preserves old sections, cover and image bytes", async () => {
  const original = await fb2Exporter.export(firstBook);
  const oldXml = await original.text();
  assert.deepEqual(await fb2Exporter.inspectExisting!(original, firstBook.title, identity), new Set([1, 3]));
  const completed = await fb2Exporter.append!(nextBook, original);
  const xml = await completed.text();
  assert.equal(completed.type, "application/x-fictionbook+xml");
  assert.deepEqual(await fb2Exporter.inspectExisting!(completed, firstBook.title, identity), new Set([1, 2, 3, 4]));
  assert.equal(section(xml, 1), section(oldXml, 1));
  assert.equal(section(xml, 3), section(oldXml, 3));
  assert.deepEqual([...xml.matchAll(/<section id="chapter_(\d+)"/g)].map((match) => Number(match[1])), [1, 2, 3, 4]);
  for (const binary of oldXml.matchAll(/<binary\b[^>]*>[\s\S]*?<\/binary>/g)) assert.ok(xml.includes(binary[0]));
  assert.match(xml, /<coverpage><image l:href="#cover"\/><\/coverpage>/);
  assert.match(xml, /id="img_2_1" content-type="image\/jpeg">AgD\/<\/binary>/);
  assert.match(xml, /<emphasis><strong>Текст 2 &amp; 𠮷<\/strong><\/emphasis>/);
  assert.match(xml, /Автор 𠮷/);
  assert.doesNotThrow(() => new SaxesParser({ xmlns: true }).write(xml).close());
  assert.equal(await original.text(), oldXml);
});

test("FB2 identity survives repeated appends and the no-new-chapters result reuses the input", async () => {
  const original = await fb2Exporter.export(firstBook);
  const second = await fb2Exporter.append!(nextBook, original);
  assert.equal(await fb2Exporter.append!({ ...nextBook, chapters: [] }, second), second);
  const third = await fb2Exporter.append!({ ...nextBook, chapters: [chapter(5)] }, second);
  assert.deepEqual(await fb2Exporter.inspectExisting!(third, firstBook.title, identity), new Set([1, 2, 3, 4, 5]));
  assert.equal((await third.text()).match(/info-type="parserlib"/g)?.length, 1);
});

test("FB2 rejects another source, title or branch before merging content", async () => {
  const original = await fb2Exporter.export(firstBook);
  for (const other of [
    { ...identity, sourceKey: "mangalib" }, { ...identity, titleId: "456" },
    { ...identity, branchId: 42 }, { ...identity, branchId: null }, undefined,
  ]) {
    await assert.rejects(fb2Exporter.inspectExisting!(original, firstBook.title, other), /не совпадают/);
    await assert.rejects(fb2Exporter.append!({ ...nextBook, identity: other }, original), /не совпадают/);
  }
  await assert.rejects(fb2Exporter.inspectExisting!(original, "Другая книга", identity), /Название книги/);
});

test("FB2 supports null branches and identity-free internal exports", async () => {
  for (const other of [{ ...identity, branchId: null }, undefined]) {
    const original = await fb2Exporter.export({ ...firstBook, identity: other });
    const completed = await fb2Exporter.append!({ ...nextBook, identity: other }, original);
    assert.deepEqual(await fb2Exporter.inspectExisting!(completed, firstBook.title, other), new Set([1, 2, 3, 4]));
  }
});

test("old FB2 files without chapter IDs and identity require a new download", async () => {
  const original = await fb2Exporter.export(firstBook);
  const legacy = new Blob([(await original.text()).replace(/\s*<custom-info[^>]*>.*?<\/custom-info>/, "").replace(/ id="chapter_\d+"/g, "")]);
  await assert.rejects(fb2Exporter.inspectExisting!(legacy, firstBook.title, identity), /нет сведений для докачки/);
  await assert.rejects(fb2Exporter.append!(nextBook, legacy), /Скачайте книгу заново/);
});

test("FB2 refuses duplicate or invalid new chapter IDs and image ID collisions", async () => {
  const original = await fb2Exporter.export(firstBook);
  await assert.rejects(fb2Exporter.append!(firstBook, original), /уже есть в FB2/);
  for (const ids of [[2, 2], [-1], [1.5], [Number.MAX_SAFE_INTEGER + 1]]) {
    await assert.rejects(fb2Exporter.append!({ ...nextBook, chapters: ids.map(chapter) }, original), /ID|повторы/);
    await assert.rejects(fb2Exporter.export({ ...nextBook, chapters: ids.map(chapter) }), /ID|повторы/);
  }
  const collision = new Blob([(await original.text()).replace("</FictionBook>", '<binary id="img_2_1" content-type="image/jpeg">AA==</binary></FictionBook>')]);
  await assert.rejects(fb2Exporter.append!(nextBook, collision), /уже используются идентификаторы/);
});

test("FB2 rejects malformed XML, broken image references and corrupted append metadata", async () => {
  const original = await (await fb2Exporter.export(firstBook)).text();
  for (const xml of [
    original.slice(0, -20), original.replace("</section>", "</p>"),
    original.replace('id="chapter_3"', 'id="chapter_1"'),
    original.replace('id="chapter_1"', 'id="broken"'),
    original.replace(/<binary id="img_1_1"[^>]*>.*?<\/binary>/, ""),
    original.replace(/(<custom-info[^>]*>).*?(<\/custom-info>)/, "$1null$2"),
    original.replace(/(<custom-info[^>]*>).*?(<\/custom-info>)/, "$1broken$2"),
    original.replace("&quot;version&quot;:1", "&quot;version&quot;:2"),
    original.replace("&quot;branchId&quot;:41", "&quot;branchId&quot;:&quot;41&quot;"),
    original.replace('encoding="UTF-8"', 'encoding="windows-1251"'),
  ]) {
    const corrupt = new Blob([xml]);
    await assert.rejects(fb2Exporter.inspectExisting!(corrupt, firstBook.title, identity));
    await assert.rejects(fb2Exporter.append!(nextBook, corrupt));
  }
  await assert.rejects(fb2Exporter.inspectExisting!(new Blob([Uint8Array.of(255)]), firstBook.title, identity), /UTF-8/);
});

test("FB2 reads split UTF-8, CRLF and tags through a stream without reading the whole file as text", async (t) => {
  const original = await fb2Exporter.export(firstBook);
  const source = (await original.text()).replace(/\n/g, "\r\n").replace(/<(section|binary) /g, "<$1\r\n");
  const bytes = new TextEncoder().encode("\ufeff" + source);
  const fragmented = new Blob([bytes]);
  t.mock.method(fragmented, "text", async () => { throw new Error("Нельзя читать всю книгу в строку."); });
  t.mock.method(fragmented, "arrayBuffer", async () => { throw new Error("Нельзя читать всю книгу в память."); });
  t.mock.method(fragmented, "stream", () => {
    let offset = 0;
    return new ReadableStream({
      pull(controller) {
        if (offset >= bytes.length) { controller.close(); return; }
        controller.enqueue(bytes.slice(offset, offset + 3));
        offset += 3;
      },
    });
  });
  const completed = await fb2Exporter.append!(nextBook, fragmented);
  assert.deepEqual(await fb2Exporter.inspectExisting!(completed, firstBook.title, identity), new Set([1, 2, 3, 4]));
  const xml = await completed.text();
  const originalXml = new TextDecoder().decode(bytes);
  const oldSection = /<section\s+id="chapter_1">[\s\S]*?<\/section>/.exec(originalXml)![0];
  assert.ok(xml.includes(oldSection));
});
