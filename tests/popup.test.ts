import assert from "node:assert/strict";
import test from "node:test";
import { ext } from "../src/lib/browser";
import { getSource } from "../src/sources/registry";
import type { ChapterRef } from "../src/sources/types";
import type { JobPlan } from "../src/lib/job-plan";
import { IDBFactory } from "fake-indexeddb";
import { takeAppendFile } from "../src/lib/append-file";
import { mockSession, setGlobal } from "./helpers/extension";

class Element {
  value = "";
  textContent = "";
  title = "";
  disabled = false;
  hidden = false;
  checked = false;
  required = false;
  accept = "";
  files: File[] = [];
  children: Element[] = [];
  classes = new Set<string>();
  classList = { add: (name: string) => this.classes.add(name), remove: (name: string) => this.classes.delete(name) };
  listeners = new Map<string, (event: { preventDefault(): void }) => unknown>();
  append(child: Element): void {
    this.children.push(child);
    if (this.children.length === 1) this.value = child.value;
  }
  replaceChildren(): void { this.children = []; this.value = ""; }
  addEventListener(type: string, listener: (event: { preventDefault(): void }) => unknown): void { this.listeners.set(type, listener); }
  async trigger(type: string): Promise<void> { await this.listeners.get(type)?.({ preventDefault() {} }); }
}

test("popup enables FB2 append, filters file types and transfers the chosen file to the job", { timeout: 5000 }, async (t) => {
  const session = mockSession(t);
  const elements = Object.fromEntries([
    "settings-form", "format", "start", "source", "status", "range-from", "range-to", "chapter-count",
    "append-option", "append-enabled", "append-file-row", "append-file",
  ].map((id) => [id, new Element()]));
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
    { id: 7, title: "Том 1, Глава 1.5", slug: "123--test", key: "number=1.5&volume=1&branch_id=41", branchId: 41, branchName: "Первая команда" },
    { id: 7, title: "Том 1, Глава 1.5", slug: "123--test", key: "number=1.5&volume=1&branch_id=42", branchId: 42, branchName: "Вторая команда" },
    { id: 8, title: "Том 1, Глава 2", slug: "123--test", key: "number=2&volume=1&branch_id=41", branchId: 41, branchName: "Первая команда" },
  ];
  const chaptersFetched = Promise.withResolvers<void>();
  const fetchChapters = t.mock.method(source, "fetchChapters", async () => {
    chaptersFetched.resolve();
    return chapters;
  });
  const fetchTitle = t.mock.method(source, "fetchTitle");
  const create = t.mock.method(ext.tabs, "create", async () => { throw new Error("Не удалось открыть вкладку."); });
  await import("../src/popup/popup");
  await chaptersFetched.promise;
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(fetchChapters.mock.callCount(), 1);
  assert.equal(fetchTitle.mock.callCount(), 0);
  assert.equal(element("start").disabled, false);
  create.mock.mockImplementation(async () => ({ id: 6 }) as chrome.tabs.Tab);
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
  assert.equal(await (await takeAppendFile(fb2Plan.appendFileId!)).text(), "исходный FB2");
  assert.equal(close.mock.callCount(), 1);
  element("format").value = "epub";
  await element("format").trigger("change");
  assert.equal(element("append-file").accept, ".epub");
  element("format").value = "pdf";
  await element("format").trigger("change");
  assert.equal(element("append-option").hidden, true);
  assert.equal(element("append-enabled").checked, false);
});
