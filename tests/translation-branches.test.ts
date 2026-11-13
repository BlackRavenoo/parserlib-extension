import assert from "node:assert/strict";
import test from "node:test";
import { chapterRefs } from "../src/sources/cdnlibs";
import type { ChapterRow } from "../src/sources/cdnlibs";
import mangalib from "../src/sources/mangalib";
import ranobelib from "../src/sources/ranobelib";
import hentailib from "../src/sources/hentailib";
import { translationBranches } from "../src/popup/branches";
import { setGlobal } from "./helpers/globals";

const slug = "123--test";
const row: ChapterRow = {
  id: 100, index: 7, item_number: 1, volume: "2", number: "1.5", number_secondary: "1", name: "Начало",
  branches: [
    { id: 100, branch_id: 41, teams: [{ name: "Первая команда" }] },
    { id: 200, branch_id: 42, teams: [{ name: "Вторая команда" }, { name: "Соавторы" }] },
  ],
};

for (const [source, host, siteId] of [
  [mangalib, "mangalib.me", "1"],
  [ranobelib, "ranobelib.me", "3"],
  [hentailib, "hentailib.me", "4"],
] as const) {
  test(`${source.key} expands nested translations and keeps the chapter index within each branch`, async (t) => {
    setGlobal(t, "fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      assert.match(String(input), new RegExp(`/${slug}/chapters$`));
      assert.equal((init?.headers as Record<string, string>)["Site-Id"], siteId);
      return Response.json({ data: [row, { ...row, id: 300, index: 8, number: "2", branches: [row.branches![0]] }] });
    });
    const chapters = await source.fetchChapters(`https://${host}/ru/${slug}`, "test-token");
    assert.equal(chapters.length, 3);
    assert.deepEqual(chapters.map(({ id, branchId, key }) => [id, branchId, key]), [
      [7, 41, "number=1.5&volume=2&branch_id=41"],
      [7, 42, "number=1.5&volume=2&branch_id=42"],
      [8, 41, "number=2&volume=2&branch_id=41"],
    ]);
    const branches = translationBranches(chapters);
    assert.deepEqual(branches.map(({ id, name, chapters }) => [id, name, chapters.length]), [
      [41, "Первая команда", 2], [42, "Вторая команда, Соавторы", 1],
    ]);
    assert.equal(branches[1]!.chapters[0]!.title, "Том 2, Глава 1.5 - Начало");
  });
}

test("branches with the same teams remain distinct and never inherit another branch's chapters", () => {
  const chapters = chapterRefs([
    { ...row, branches: row.branches!.map((branch) => ({ ...branch, teams: [{ name: "Команда" }] })) },
    { ...row, index: 2, branch_id: null, branches: undefined },
  ], slug);
  const branches = translationBranches(chapters.reverse());
  assert.equal(branches.length, 3);
  assert.equal(new Set(branches.map(({ name }) => name)).size, 3);
  assert.deepEqual(branches.map(({ chapters }) => chapters.length), [1, 1, 1]);
  assert.equal(branches.find(({ id }) => id === null)!.chapters[0]!.key, "number=1.5&volume=2");
});

test("flat responses, null branches and empty chapter lists stay supported", () => {
  assert.deepEqual(chapterRefs([], slug), []);
  assert.deepEqual(chapterRefs([{ ...row, branches: [] }], slug), []);
  assert.deepEqual(translationBranches([]), []);
  const refs = chapterRefs([
    { ...row, branches: undefined, branch_id: 41 },
    { ...row, index: 8, branches: [{ id: 300, branch_id: null, teams: [] }] },
  ], slug);
  assert.deepEqual(refs.map(({ branchId, branchName }) => [branchId, branchName]), [[41, undefined], [null, undefined]]);
  assert.deepEqual(translationBranches(refs).map(({ name }) => name), ["Ветка 41", "Основной перевод"]);
});

test("invalid or duplicate branch IDs fail instead of mixing translations", () => {
  for (const branchId of [undefined, -1, 0, 1.5, "42"]) {
    assert.throws(() => chapterRefs([{ ...row, branches: [{ id: 100, branch_id: branchId as number }] }], slug), /некорректную ветку/);
  }
  assert.throws(() => chapterRefs([{ ...row, branches: [row.branches![0]!, row.branches![0]!] }], slug), /несколько переводов/);
});

test("a chapter response from another translation or without its requested branch is rejected", async (t) => {
  const chapter = chapterRefs([row], slug)[0]!;
  let returnedBranch: number | undefined = 42;
  const fetch = t.mock.fn(async () => Response.json({ data: { branch_id: returnedBranch, content: "Текст" } }));
  setGlobal(t, "fetch", fetch);
  await assert.rejects(ranobelib.fetchChapter(chapter, null), /другой ветки/);
  returnedBranch = undefined;
  await assert.rejects(ranobelib.fetchChapter(chapter, null), /другой ветки/);
  assert.equal(fetch.mock.callCount(), 2);
});
