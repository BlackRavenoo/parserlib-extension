import assert from "node:assert/strict";
import test from "node:test";
import type { TestContext } from "node:test";
import { IDBFactory } from "fake-indexeddb";
import { runJob } from "../src/job/run";
import type { JobView } from "../src/job/run";
import { storeJobPlan } from "../src/lib/job-plan";
import type { JobPlan } from "../src/lib/job-plan";
import { storeAppendFile, takeAppendFile } from "../src/lib/append-file";
import { ext } from "../src/lib/browser";
import { getSource } from "../src/sources/registry";
import { getExporter } from "../src/export/registry";
import type { Book } from "../src/export/types";
import type { ChapterContent, ChapterRef } from "../src/sources/types";
import { mockSession, setGlobal } from "./helpers/extension";

const chapters: ChapterRef[] = [7, 9, 12].map((id) => ({
  id,
  title: `Том 2, Глава ${id}`,
  key: `number=${id}&volume=2&branch_id=4`,
  slug: "123--test",
}));

function content(chapter: ChapterRef): ChapterContent {
  return { chunks: [
    { kind: "text", text: chapter.title, styles: ["strong"], startsParagraph: true },
    { kind: "image", data: Uint8Array.of(chapter.id), mime: "image/png" },
  ] };
}

async function setup(t: TestContext, overrides: Partial<JobPlan> = {}) {
  const session = mockSession(t);
  const classes = new Set<string>();
  const view = {
    status: { textContent: "", classList: { add: (name: string) => { classes.add(name); } } },
    title: { textContent: "Загрузка…" },
    progress: { max: 1, value: 0, hidden: true },
  } satisfies JobView;
  const plan: JobPlan = {
    sourceKey: "ranobelib",
    token: "test-token",
    format: "epub",
    meta: { id: "123", title: "Книга: главы", author: "Автор" },
    chapters,
    ...overrides,
  };
  const id = await storeJobPlan(plan);
  const source = await getSource(plan.sourceKey);
  const exporter = await getExporter(plan.format);
  const fetchChapter = t.mock.method(source, "fetchChapter", async (chapter: ChapterRef) => content(chapter));
  const fetchTitle = t.mock.method(source, "fetchTitle");
  const fetchChapters = t.mock.method(source, "fetchChapters");
  const blob = new Blob(["готовая книга"], { type: "application/epub+zip" });
  const exportBook = t.mock.method(exporter, "export", async (_book: Book) => blob);
  const download = t.mock.method(ext.downloads, "download", async (_options: chrome.downloads.DownloadOptions) => 42);
  const createUrl = t.mock.method(URL, "createObjectURL", (_blob: Blob) => "blob:test-job");
  const revokeUrl = t.mock.method(URL, "revokeObjectURL", (_url: string) => {});
  const fetch = t.mock.fn<typeof globalThis.fetch>(async () => { throw new Error("Неожиданный сетевой запрос."); });
  setGlobal(t, "fetch", fetch);
  t.mock.method(console, "error", () => {});
  const warn = t.mock.method(console, "warn", () => {});
  t.after(() => {
    assert.equal(fetchTitle.mock.callCount(), 0);
    assert.equal(fetchChapters.mock.callCount(), 0);
  });
  return {
    plan, id, view, classes, session, source, exporter, blob,
    fetchChapter, exportBook, download, createUrl, revokeUrl, fetch, warn,
    run: () => runJob(id, view),
  };
}

async function setupAppend(t: TestContext, existing: number[], overrides: Partial<JobPlan> = {}) {
  const factory = new IDBFactory();
  setGlobal(t, "indexedDB", factory);
  const original = new File(["исходная книга"], "Книга.epub", { type: "application/epub+zip" });
  const appendFileId = await storeAppendFile(original);
  const job = await setup(t, {
    appendFileId,
    meta: { id: "123", title: "Книга: главы", author: "Автор", coverUrl: "https://cover.cdnlibs.org/test.jpg" },
    ...overrides,
  });
  const inspect = t.mock.method(job.exporter, "inspectExisting", async (_file: Blob, _title: string) => new Set(existing));
  const append = t.mock.method(job.exporter, "append", async (_book: Book, _file: Blob) => job.blob);
  return { ...job, original, inspect, append };
}

test("job consumes its plan, preserves selected chapters and saves the exported book", async (t) => {
  const job = await setup(t);
  await job.run();

  assert.equal(job.session.stored.size, 0);
  assert.deepEqual(job.fetchChapter.mock.calls.map(({ arguments: args }) => args), chapters.map((chapter) => [chapter, "test-token"]));
  assert.deepEqual(job.exportBook.mock.calls[0]!.arguments, [{
    title: job.plan.meta.title,
    author: job.plan.meta.author,
    coverImage: undefined,
    chapters: chapters.map((chapter) => ({ id: chapter.id, title: chapter.title, chunks: content(chapter).chunks })),
  }]);
  assert.equal(job.exportBook.mock.callCount(), 1);
  assert.deepEqual(job.createUrl.mock.calls[0]!.arguments, [job.blob]);
  assert.deepEqual(job.download.mock.calls[0]!.arguments, [{
    url: "blob:test-job", filename: "Книга_ главы.epub", saveAs: false, conflictAction: "uniquify",
  }]);
  assert.deepEqual(job.revokeUrl.mock.calls.map(({ arguments: args }) => args), [["blob:test-job"]]);
  assert.equal(job.view.title.textContent, job.plan.meta.title);
  assert.deepEqual(job.view.progress, { max: 3, value: 3, hidden: false });
  assert.equal(job.view.status.textContent, "Готово, файл сохранён. Вкладку можно закрыть.");
  assert.equal(job.classes.has("error"), false);
  assert.equal(job.fetch.mock.callCount(), 0);
});

test("job waits for each chapter before fetching the next and exporting", { timeout: 5000 }, async (t) => {
  const job = await setup(t, { token: null });
  const entered = Promise.withResolvers<void>();
  const chapterReady = Promise.withResolvers<ChapterContent>();
  job.fetchChapter.mock.mockImplementation(async (chapter) => {
    if (chapter.id === chapters[0]!.id) {
      entered.resolve();
      return chapterReady.promise;
    }
    return content(chapter);
  });
  const pending = job.run();
  await entered.promise;
  assert.equal(job.fetchChapter.mock.callCount(), 1);
  assert.equal(job.exportBook.mock.callCount(), 0);
  assert.equal(job.download.mock.callCount(), 0);
  assert.deepEqual(job.view.progress, { max: 3, value: 0, hidden: false });
  chapterReady.resolve(content(chapters[0]!));
  await pending;
  assert.deepEqual(job.fetchChapter.mock.calls.map(({ arguments: args }) => args[1]), [null, null, null]);
});

test("job saves only completed chapters and stops fetching after a failure", async (t) => {
  const job = await setup(t);
  job.fetchChapter.mock.mockImplementation(async (chapter) => {
    if (chapter.id === 9) throw new Error("Нет доступа к главе.");
    return content(chapter);
  });
  await job.run();
  assert.deepEqual(job.fetchChapter.mock.calls.map(({ arguments: args }) => args[0].id), [7, 9]);
  assert.deepEqual(job.exportBook.mock.calls[0]!.arguments[0].chapters.map(({ id }) => id), [7]);
  assert.equal(job.download.mock.callCount(), 1);
  assert.equal(job.revokeUrl.mock.callCount(), 1);
  assert.deepEqual(job.view.progress, { max: 3, value: 1, hidden: false });
  assert.equal(job.classes.has("error"), true);
  assert.match(job.view.status.textContent, /Файл сохранён с главами 1–1 из 3/);
  assert.match(job.view.status.textContent, /На главе 2 загрузка остановилась: Нет доступа к главе\./);
});

test("job does not export or download when the first chapter fails", async (t) => {
  const job = await setup(t);
  job.fetchChapter.mock.mockImplementation(async () => { throw "Сеть недоступна."; });
  await assert.rejects(job.run(), /Первая глава не скачалась, сохранять нечего\. Причина: Сеть недоступна\./);
  assert.equal(job.fetchChapter.mock.callCount(), 1);
  assert.equal(job.exportBook.mock.callCount(), 0);
  assert.equal(job.createUrl.mock.callCount(), 0);
  assert.equal(job.download.mock.callCount(), 0);
});

test("job rejects a missing or already consumed plan without fetching chapters", async (t) => {
  const job = await setup(t);
  await assert.rejects(runJob("missing", job.view), /Не найдены параметры загрузки/);
  assert.equal(job.fetchChapter.mock.callCount(), 0);
  await job.run();
  await assert.rejects(job.run(), /Не найдены параметры загрузки/);
  assert.equal(job.fetchChapter.mock.callCount(), 3);
  assert.equal(job.download.mock.callCount(), 1);
});

test("job propagates export errors without creating a download URL", async (t) => {
  const job = await setup(t);
  const error = new Error("Не удалось собрать EPUB.");
  job.exportBook.mock.mockImplementation(async () => { throw error; });
  await assert.rejects(job.run(), (reason) => reason === error);
  assert.equal(job.createUrl.mock.callCount(), 0);
  assert.equal(job.download.mock.callCount(), 0);
  assert.equal(job.revokeUrl.mock.callCount(), 0);
  assert.doesNotMatch(job.view.status.textContent, /файл сохранён/i);
});

test("job releases its object URL when the browser rejects the download", async (t) => {
  const job = await setup(t);
  const error = new Error("Сохранение запрещено.");
  job.download.mock.mockImplementation(async () => { throw error; });
  await assert.rejects(job.run(), (reason) => reason === error);
  assert.deepEqual(job.revokeUrl.mock.calls.map(({ arguments: args }) => args), [["blob:test-job"]]);
  assert.doesNotMatch(job.view.status.textContent, /файл сохранён/i);
});

test("job keeps the object URL until the browser finishes accepting the download", { timeout: 5000 }, async (t) => {
  const job = await setup(t);
  const entered = Promise.withResolvers<void>();
  const accepted = Promise.withResolvers<number>();
  job.download.mock.mockImplementation(async () => {
    entered.resolve();
    return accepted.promise;
  });
  const pending = job.run();
  await entered.promise;
  assert.equal(job.revokeUrl.mock.callCount(), 0);
  assert.doesNotMatch(job.view.status.textContent, /файл сохранён/i);
  accepted.resolve(42);
  await pending;
  assert.equal(job.revokeUrl.mock.callCount(), 1);
  assert.match(job.view.status.textContent, /Готово, файл сохранён/);
});

test("job appends missing chapters including gaps and passes the original EPUB to the exporter", async (t) => {
  const job = await setupAppend(t, [9]);
  await job.run();
  assert.deepEqual(job.fetchChapter.mock.calls.map(({ arguments: args }) => args), [chapters[0], chapters[2]].map((chapter) => [chapter, "test-token"]));
  assert.equal(job.inspect.mock.callCount(), 1);
  const [file, title] = job.inspect.mock.calls[0]!.arguments;
  assert.equal(title, job.plan.meta.title);
  assert.equal(await file.text(), await job.original.text());
  assert.equal(job.append.mock.callCount(), 1);
  const [book, appendedFile] = job.append.mock.calls[0]!.arguments;
  assert.equal(appendedFile, file);
  assert.deepEqual(book.chapters.map(({ id }) => id), [7, 12]);
  assert.equal(job.exportBook.mock.callCount(), 0);
  assert.equal(job.fetch.mock.callCount(), 0);
  assert.equal(job.download.mock.callCount(), 1);
  assert.deepEqual(job.view.progress, { max: 2, value: 2, hidden: false });
  await assert.rejects(takeAppendFile(job.plan.appendFileId!), /Выбранный EPUB не найден/);
});

test("job skips export and download when every selected chapter is already in the EPUB", async (t) => {
  const job = await setupAppend(t, [7, 9, 12]);
  await job.run();
  assert.equal(job.fetchChapter.mock.callCount(), 0);
  assert.equal(job.exportBook.mock.callCount(), 0);
  assert.equal(job.append.mock.callCount(), 0);
  assert.equal(job.createUrl.mock.callCount(), 0);
  assert.equal(job.download.mock.callCount(), 0);
  assert.equal(job.fetch.mock.callCount(), 0);
  assert.deepEqual(job.view.progress, { max: 3, value: 3, hidden: false });
  assert.equal(job.view.status.textContent, "Все выбранные главы уже есть в файле. Новый файл не требуется.");
  assert.equal(job.classes.has("error"), false);
});

test("job appends completed new chapters when a later new chapter fails", async (t) => {
  const job = await setupAppend(t, [7]);
  job.fetchChapter.mock.mockImplementation(async (chapter) => {
    if (chapter.id === 12) throw new Error("Ошибка иллюстрации.");
    return content(chapter);
  });
  await job.run();
  assert.deepEqual(job.append.mock.calls[0]!.arguments[0].chapters.map(({ id }) => id), [9]);
  assert.equal(job.exportBook.mock.callCount(), 0);
  assert.equal(job.download.mock.callCount(), 1);
  assert.equal(job.revokeUrl.mock.callCount(), 1);
  assert.equal(job.classes.has("error"), true);
  assert.match(job.view.status.textContent, /Файл сохранён с 1 новыми главами из 2/);
  assert.match(job.view.status.textContent, /На главе 2 загрузка остановилась: Ошибка иллюстрации\./);
  assert.deepEqual(job.view.progress, { max: 2, value: 1, hidden: false });
});

test("job does not rewrite the EPUB if the first new chapter fails", async (t) => {
  const job = await setupAppend(t, [7]);
  job.fetchChapter.mock.mockImplementation(async () => { throw new Error("Нет доступа."); });
  await assert.rejects(job.run(), /Первая новая глава не скачалась, исходный файл не изменён\. Причина: Нет доступа\./);
  assert.equal(job.fetchChapter.mock.callCount(), 1);
  assert.equal(job.append.mock.callCount(), 0);
  assert.equal(job.exportBook.mock.callCount(), 0);
  assert.equal(job.download.mock.callCount(), 0);
});

test("job rejects append for formats that do not support it before fetching chapters", async (t) => {
  const job = await setup(t, { format: "fb2", appendFileId: "existing-file" });
  await assert.rejects(job.run(), /Формат FB2 не поддерживает докачку/);
  assert.equal(job.fetchChapter.mock.callCount(), 0);
  assert.equal(job.exportBook.mock.callCount(), 0);
  assert.equal(job.download.mock.callCount(), 0);
});

test("job rejects an unavailable append file before fetching chapters", async (t) => {
  const job = await setupAppend(t, []);
  await takeAppendFile(job.plan.appendFileId!);
  await assert.rejects(job.run(), /Выбранный EPUB не найден/);
  assert.equal(job.inspect.mock.callCount(), 0);
  assert.equal(job.fetchChapter.mock.callCount(), 0);
  assert.equal(job.append.mock.callCount(), 0);
  assert.equal(job.download.mock.callCount(), 0);
});

test("job stops if EPUB inspection fails instead of downloading or replacing its content", async (t) => {
  const job = await setupAppend(t, []);
  const error = new Error("Название книги не совпадает.");
  job.inspect.mock.mockImplementation(async () => { throw error; });
  await assert.rejects(job.run(), (reason) => reason === error);
  assert.equal(job.fetchChapter.mock.callCount(), 0);
  assert.equal(job.append.mock.callCount(), 0);
  assert.equal(job.download.mock.callCount(), 0);
});

for (const mime of ["image/png", null]) {
  test(`job includes cover bytes with ${mime ?? "default MIME"} in the exported book`, async (t) => {
    const job = await setup(t, { meta: { id: "123", title: "Книга", coverUrl: "https://cover.cdnlibs.org/test.jpg" } });
    job.fetch.mock.mockImplementation(async () => new Response(Uint8Array.of(1, 2, 3), {
      headers: mime ? { "content-type": mime } : {},
    }));
    await job.run();
    assert.deepEqual(job.fetch.mock.calls[0]!.arguments, [job.plan.meta.coverUrl]);
    assert.deepEqual(job.exportBook.mock.calls[0]!.arguments[0].coverImage, {
      data: Uint8Array.of(1, 2, 3), mime: mime ?? "image/jpeg",
    });
    assert.equal(job.warn.mock.callCount(), 0);
  });
}

for (const failure of ["http", "network", "body"] as const) {
  test(`job still saves chapters after a cover ${failure} failure`, async (t) => {
    const job = await setup(t, { meta: { id: "123", title: "Книга", coverUrl: "https://cover.cdnlibs.org/test.jpg" } });
    job.fetch.mock.mockImplementation(async () => {
      if (failure === "network") throw new Error("Обложка недоступна.");
      if (failure === "http") return new Response(null, { status: 404 });
      const response = new Response(Uint8Array.of(1));
      t.mock.method(response, "arrayBuffer", async () => { throw new Error("Обрыв ответа обложки."); });
      return response;
    });
    await job.run();
    assert.equal(job.exportBook.mock.calls[0]!.arguments[0].coverImage, undefined);
    assert.equal(job.download.mock.callCount(), 1);
    assert.equal(job.warn.mock.callCount(), 1);
    assert.equal(job.classes.has("error"), false);
    assert.match(job.view.status.textContent, /Готово, файл сохранён/);
  });
}

test("job page reads the plan ID from its URL and displays startup failures in the DOM", async (t) => {
  const job = await setup(t);
  const elements = { status: job.view.status, title: job.view.title, bar: job.view.progress };
  setGlobal(t, "document", { getElementById: (id: keyof typeof elements) => elements[id] });
  setGlobal(t, "location", { search: `?plan=${encodeURIComponent(job.id)}` });
  job.fetchChapter.mock.mockImplementation(async () => { throw new Error("Нет доступа."); });
  await import("../src/job/job");
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(job.session.stored.size, 0);
  assert.equal(job.view.title.textContent, job.plan.meta.title);
  assert.equal(job.classes.has("error"), true);
  assert.equal(job.view.status.textContent, "Ошибка: Первая глава не скачалась, сохранять нечего. Причина: Нет доступа.");
  assert.equal(job.download.mock.callCount(), 0);
});
