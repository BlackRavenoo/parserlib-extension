import assert from "node:assert/strict";
import test from "node:test";
import { ext } from "../src/lib/browser";
import { getSource } from "../src/sources/registry";
import type { ChapterRef } from "../src/sources/types";
import type { JobPlan } from "../src/lib/job-plan";
import { IDBFactory } from "fake-indexeddb";
import { takeAppendFile } from "../src/lib/append-file";
import { mockSession, setGlobal } from "./helpers/extension";
import { Element, popupElements } from "./helpers/popup";
import { tokenFingerprint } from "../src/lib/popup-cache";

test("popup requires a translation, resets its range, and stores only the selected branch in the job plan", { timeout: 5000 }, async (t) => {
  const session = mockSession(t);
  t.mock.method(ext.storage.local, "get", async () => ({}));
  const saveSettings = t.mock.method(ext.storage.local, "set", async (_items: Record<string, unknown>) => {});
  const elements = popupElements();
  const element = (id: string) => elements[id]!;
  setGlobal(t, "document", {
    getElementById: element,
    createElement: () => new Element(),
  });
  const close = t.mock.fn();
  setGlobal(t, "window", { close });
  setGlobal(t, "chrome", {
    runtime: { getURL: (path: string) => `chrome-extension://test/${path}` },
    declarativeNetRequest: { updateDynamicRules: async () => {}, updateSessionRules: async () => {} },
  });
  t.mock.method(console, "info", () => {});
  t.mock.method(ext.tabs, "queryActive", async () => ({ id: 5, url: "https://ranobelib.me/ru/123--test" }) as chrome.tabs.Tab);
  const source = await getSource("ranobelib");
  t.mock.method(ext.scripting, "executeScript", async (options) => [{
    frameId: 0,
    result: options.func === source.titleInPage ? "Книга" : options.func === source.tokenInPage ? "test-token" : "123456",
  }]);
  const chapters: ChapterRef[] = [
    { id: 7, title: "Том 1, Глава 1.1", volume: "1", slug: "123--test", key: "number=1.1&volume=1&branch_id=41", branchId: 41, branchName: "Первая команда" },
    { id: 7, title: "Том 3, Глава 1.5", volume: "3", slug: "123--test", key: "number=1.5&volume=3&branch_id=42", branchId: 42, branchName: "Вторая команда" },
    { id: 8, title: "Том 1, Глава 1.5", volume: "1", slug: "123--test", key: "number=1.5&volume=1&branch_id=41", branchId: 41, branchName: "Первая команда" },
    { id: 9, title: "Том 2, Глава 2", volume: "2", slug: "123--test", key: "number=2&volume=2&branch_id=41", branchId: 41 },
    { id: 10, title: "Том 10, Глава 1", volume: "10", slug: "123--test", key: "number=1&volume=10&branch_id=41", branchId: 41 },
    { id: 11, title: "Дополнение", volume: "", slug: "123--test", key: "number=1&volume=&branch_id=41", branchId: 41 },
  ];
  const chaptersFetched = Promise.withResolvers<void>();
  const fetchChapters = t.mock.method(source, "fetchChapters", async () => {
    chaptersFetched.resolve();
    return chapters;
  });
  const fetchTitle = t.mock.method(source, "fetchTitle");
  const create = t.mock.method(ext.tabs, "create", async () => { throw new Error("Не удалось открыть вкладку."); });
  session.stored.set("popup-data:5", {
    identity: JSON.stringify(["branches-v1", "ranobelib", "123--test", "123456", await tokenFingerprint("test-token")]),
    meta: { id: "123", title: "Старый кэш" },
    chapters: [{ id: 1, title: "Глава без поля тома", slug: "123--test", key: "number=1&volume=1" }],
  });
  await import("../src/popup/popup");
  await chaptersFetched.promise;
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(fetchChapters.mock.callCount(), 1);
  assert.equal(fetchTitle.mock.callCount(), 0);
  assert.equal(element("branch").value, "");
  assert.equal(element("volumes").disabled, true);
  assert.equal(element("start").disabled, true);
  await element("settings-form").trigger("submit");
  assert.match(element("status").textContent, /Выберите ветку/);
  assert.equal(create.mock.callCount(), 0);

  element("branch").value = "41";
  await element("branch").trigger("change");
  assert.equal(element("range-to").value, "4");
  assert.equal(element("range-from").children[0]!.textContent, "Том 1, Глава 1.1");
  const volumeCheckbox = (volume: string) => element("volume-list").children
    .map((label) => label.children[0]!).find((input) => input.value === volume)!;
  assert.deepEqual(element("volume-list").children.map((label) => label.children[1]!.textContent), [
    "Том 1 — глав: 2", "Том 2 — глав: 1", "Том 10 — глав: 1", "Без тома — глав: 1",
  ]);
  assert.equal(element("volumes-all").checked, true);
  assert.equal(element("volumes").disabled, false);
  for (const volume of ["2", ""]) {
    volumeCheckbox(volume).checked = false;
    await volumeCheckbox(volume).trigger("change");
  }
  assert.equal(element("volumes-all").checked, false);
  assert.equal(element("volumes-all").indeterminate, true);
  assert.equal(element("chapter-count").textContent, "Найдено глав: 3");
  assert.deepEqual(element("range-from").children.map((option) => option.textContent), [
    chapters[0]!.title, chapters[2]!.title, chapters[4]!.title,
  ]);
  element("range-from").value = "1";
  await element("settings-form").trigger("submit");
  const filteredPlan = session.set.mock.calls.map(({ arguments: [items] }) => Object.entries(items))
    .flat().find(([key]) => key.startsWith("job-plan:"))![1] as JobPlan;
  assert.deepEqual(filteredPlan.chapters, [chapters[2], chapters[4]]);
  assert.equal(filteredPlan.branchId, 41);
  assert.equal(filteredPlan.showMetrics, undefined);
  assert.equal([...session.stored.keys()].some((key) => key.startsWith("job-plan:")), false);
  element("volumes-all").checked = false;
  await element("volumes-all").trigger("change");
  assert.equal(element("start").disabled, true);
  assert.equal(element("range-from").disabled, true);
  assert.equal(element("range-to").disabled, true);
  assert.equal(element("volumes-all").indeterminate, false);
  const callsBeforeEmpty = create.mock.callCount();
  await element("settings-form").trigger("submit");
  assert.equal(create.mock.callCount(), callsBeforeEmpty);
  assert.match(element("status").textContent, /хотя бы один том/);
  volumeCheckbox("2").checked = true;
  await volumeCheckbox("2").trigger("change");
  assert.equal(element("range-from").value, "0");
  assert.equal(element("range-to").value, "0");
  assert.equal(element("range-from").children[0]!.textContent, chapters[3]!.title);
  element("volumes-all").checked = true;
  await element("volumes-all").trigger("change");
  assert.equal(element("range-to").value, "4");
  assert.equal(element("volumes-all").indeterminate, false);
  element("range-from").value = "1";
  element("branch").value = "42";
  await element("branch").trigger("change");
  assert.equal(element("range-from").value, "0");
  assert.equal(element("range-to").value, "0");
  assert.equal(element("chapter-count").textContent, "Найдено глав: 1");
  assert.equal(element("volume-list").children.length, 1);
  assert.equal(volumeCheckbox("3").checked, true);
  assert.equal(element("volumes-all").checked, true);
  assert.equal(element("start").disabled, false);

  await element("settings-form").trigger("submit");
  assert.match(element("status").textContent, /Не удалось открыть вкладку/);
  assert.equal([...session.stored.keys()].some((key) => key.startsWith("job-plan:")), false);
  assert.equal(element("start").disabled, false);
  assert.equal(close.mock.callCount(), 0);
  create.mock.mockImplementation(async () => ({ id: 6 }) as chrome.tabs.Tab);
  assert.equal(element("show-metrics").checked, false);
  await element("settings-toggle").trigger("click");
  assert.equal(element("preferences").hidden, false);
  assert.equal(element("download-view").hidden, true);
  assert.equal(element("settings-toggle").attributes.get("aria-expanded"), "true");
  element("show-metrics").checked = true;
  await element("show-metrics").trigger("change");
  assert.deepEqual(saveSettings.mock.calls[0]?.arguments, [{ "show-export-metrics": true }]);
  saveSettings.mock.mockImplementationOnce(async () => { throw new Error("Хранилище недоступно."); });
  element("show-metrics").checked = false;
  await element("show-metrics").trigger("change");
  assert.equal(element("show-metrics").checked, true);
  assert.match(element("preferences-status").textContent, /Не удалось сохранить/);
  await element("settings-toggle").trigger("click");
  assert.equal(element("download-view").hidden, false);
  assert.equal(element("preferences").hidden, true);
  await element("settings-form").trigger("submit");
  const plan = [...session.stored.entries()].find(([key]) => key.startsWith("job-plan:"))![1] as JobPlan;
  assert.equal(plan.branchId, 42);
  assert.deepEqual(plan.chapters, [chapters[1]]);
  assert.equal(plan.token, "test-token");
  assert.equal(plan.showMetrics, true);
  assert.equal(close.mock.callCount(), 1);
  assert.equal(fetchChapters.mock.callCount(), 1);
  const cache = session.stored.get("popup-data:5") as { chapters: ChapterRef[]; identity: string };
  assert.equal(cache.chapters.length, 6);
  assert.match(cache.identity, /volumes-v1/);

  assert.equal(element("append-option").hidden, false);
  assert.equal(element("append-file").accept, ".fb2");
  setGlobal(t, "indexedDB", new IDBFactory());
  element("append-enabled").checked = true;
  await element("append-enabled").trigger("change");
  element("append-file").files = [new File(["проверка"], "Книга.epub")];
  const createdBefore = create.mock.callCount();
  await element("settings-form").trigger("submit");
  assert.equal(create.mock.callCount(), createdBefore);
  assert.match(element("status").textContent, /Выберите существующий файл/);
  element("append-file").files = [new File(["исходный FB2"], "Книга.fb2")];
  await element("settings-form").trigger("submit");
  const fb2Plan = [...session.stored.values()].find((value) => (value as JobPlan).appendFileId) as JobPlan;
  assert.equal(fb2Plan.format, "fb2");
  assert.equal(fb2Plan.branchId, 42);
  assert.equal(await (await takeAppendFile(fb2Plan.appendFileId!)).text(), "исходный FB2");
  element("format").value = "epub";
  await element("format").trigger("change");
  assert.equal(element("append-file").accept, ".epub");
  element("format").value = "pdf";
  await element("format").trigger("change");
  assert.equal(element("append-option").hidden, true);
  assert.equal(element("append-enabled").checked, false);
});
