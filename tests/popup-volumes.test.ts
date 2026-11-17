import assert from "node:assert/strict";
import test from "node:test";
import { ext } from "../src/lib/browser";
import { tokenFingerprint } from "../src/lib/popup-cache";
import { getSource } from "../src/sources/registry";
import type { ChapterRef } from "../src/sources/types";
import type { JobPlan } from "../src/lib/job-plan";
import { mockSession, setGlobal } from "./helpers/extension";
import { Element, popupElements } from "./helpers/popup";

test("popup restores volumes from cache and submits complete selected volumes in chapter order without another API call", { timeout: 5000 }, async (t) => {
  const session = mockSession(t);
  const elements = popupElements();
  const element = (id: string) => elements[id]!;
  setGlobal(t, "document", { getElementById: element, createElement: () => new Element() });
  const closed = Promise.withResolvers<void>();
  setGlobal(t, "window", { close: () => closed.resolve() });
  setGlobal(t, "chrome", {
    runtime: { getURL: (path: string) => `chrome-extension://test/${path}` },
    declarativeNetRequest: { updateDynamicRules: async () => {}, updateSessionRules: async () => {} },
  });
  t.mock.method(console, "info", () => {});
  t.mock.method(ext.tabs, "queryActive", async () => ({ id: 5, url: "https://ranobelib.me/ru/123--test" }) as chrome.tabs.Tab);
  const source = await getSource("ranobelib");
  t.mock.method(ext.scripting, "executeScript", async (options) => [{
    frameId: 0,
    result: options.func === source.titleInPage ? "Книга" : options.func === source.tokenInPage ? null : "123456",
  }]);
  const chapters: ChapterRef[] = [
    { id: 1, title: "Первая", volume: "2", key: "number=1.1&volume=2", slug: "123--test", branchId: null },
    { id: 2, title: "Вторая", volume: "2", key: "number=1.5&volume=2", slug: "123--test", branchId: null },
    { id: 3, title: "Третья", volume: "10", key: "number=1&volume=10", slug: "123--test", branchId: null },
    { id: 4, title: "Четвёртая", volume: "11", key: "number=1&volume=11", slug: "123--test", branchId: null },
  ];
  session.stored.set("popup-data:5", {
    identity: JSON.stringify(["volumes-v1", "ranobelib", "123--test", "123456", await tokenFingerprint(null)]),
    meta: { id: "123", title: "Название из кэша" },
    chapters: chapters.toReversed(),
  });
  const fetchChapters = t.mock.method(source, "fetchChapters", async () => { throw new Error("Лишний запрос списка глав."); });
  const fetchTitle = t.mock.method(source, "fetchTitle", async () => { throw new Error("Лишний запрос метаданных."); });
  t.mock.method(ext.tabs, "create", async () => ({ id: 6 }) as chrome.tabs.Tab);
  const cacheRead = Promise.withResolvers<void>();
  session.get.mock.mockImplementation(async () => {
    cacheRead.resolve();
    return { "popup-data:5": structuredClone(session.stored.get("popup-data:5")) };
  });
  await import("../src/popup/popup");
  await cacheRead.promise;
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(element("branch").value, "default");
  assert.equal(element("volumes-all").checked, true);
  assert.equal(element("range-to").value, "3");
  assert.equal(element("chapter-count").textContent, "Найдено глав: 4");
  const volumeTen = element("volume-list").children.map((label) => label.children[0]!).find((input) => input.value === "10")!;
  volumeTen.checked = false;
  await volumeTen.trigger("change");
  assert.deepEqual(element("range-from").children.map((option) => option.textContent), ["Первая", "Вторая", "Четвёртая"]);
  await element("settings-form").trigger("submit");
  await closed.promise;
  const plan = [...session.stored.entries()].find(([key]) => key.startsWith("job-plan:"))![1] as JobPlan;
  assert.deepEqual(plan.chapters, [chapters[0], chapters[1], chapters[3]]);
  assert.equal(plan.meta.title, "Книга");
  assert.equal(plan.branchId, null);
  assert.equal(fetchChapters.mock.callCount(), 0);
  assert.equal(fetchTitle.mock.callCount(), 0);
});
