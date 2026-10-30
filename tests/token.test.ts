import assert from "node:assert/strict";
import test from "node:test";
import { ext } from "../src/lib/browser";
import { readFromTab } from "../src/lib/token";

test("tab reads inject the supplied function into the selected tab", async (t) => {
  const fn = () => "page-token";
  const execute = t.mock.method(ext.scripting, "executeScript", async () => [{ frameId: 0, result: "page-token" }]);

  assert.equal(await readFromTab(42, fn), "page-token");
  assert.deepEqual(execute.mock.calls[0]?.arguments, [{ target: { tabId: 42 }, func: fn }]);
});

test("tab reads ignore empty and non-string results and choose the first usable string", async (t) => {
  const values = [null, undefined, "", 123, {}, "first-result", "second-result"];
  t.mock.method(ext.scripting, "executeScript", async () => values.map((result, frameId) => ({ frameId, result })));
  assert.equal(await readFromTab(1, () => null), "first-result");
});

test("tab reads return null when no frame contains a usable value", async (t) => {
  const execute = t.mock.method(ext.scripting, "executeScript", async () => []);
  assert.equal(await readFromTab(1, () => null), null);
  execute.mock.mockImplementation(async () => [{ frameId: 0, result: "" }]);
  assert.equal(await readFromTab(1, () => null), null);
});

test("tab reads return null when the tab is closed or script access is denied", async (t) => {
  t.mock.method(ext.scripting, "executeScript", async () => { throw new Error("Cannot access contents of the page"); });
  assert.equal(await readFromTab(1, () => null), null);
});
