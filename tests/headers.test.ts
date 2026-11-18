import assert from "node:assert/strict";
import test from "node:test";
import type { TestContext } from "node:test";
import { patchApiHeaders } from "../src/lib/headers";
import mangalib from "../src/sources/mangalib";
import ranobelib from "../src/sources/ranobelib";
import { setGlobal } from "./helpers/extension";

const mangaUrl = "https://mangalib.org/ru/manga/123--test";
const ranobeUrl = "https://ranobelib.me/ru/book/123--test";

function setup(t: TestContext) {
  const order: string[] = [];
  const updateDynamicRules = t.mock.fn(async (_options: unknown) => { order.push("dynamic"); });
  const updateSessionRules = t.mock.fn(async (_options: unknown) => { order.push("session"); });
  const dnr = { updateDynamicRules, updateSessionRules };
  setGlobal(t, "chrome", { declarativeNetRequest: dnr });
  t.mock.method(console, "info", () => {});
  const warn = t.mock.method(console, "warn", () => {});
  return { dnr, order, warn };
}

test("headers replace legacy dynamic rules with session rules restricted to extension API requests", async (t) => {
  const { dnr, order } = setup(t);
  assert.equal(await patchApiHeaders(mangalib, mangaUrl), true);
  assert.deepEqual(order, ["dynamic", "session"]);
  assert.deepEqual(dnr.updateDynamicRules.mock.calls[0]?.arguments, [{ removeRuleIds: [1, 2] }]);
  assert.deepEqual(dnr.updateSessionRules.mock.calls[0]?.arguments, [{
    removeRuleIds: [1, 2],
    addRules: [{
      id: 1,
      priority: 1,
      action: {
        type: "modifyHeaders",
        requestHeaders: [
          { header: "referer", operation: "set", value: "https://mangalib.org/" },
          { header: "origin", operation: "set", value: "https://mangalib.org" },
          { header: "sec-fetch-site", operation: "set", value: "cross-site" },
        ],
      },
      condition: {
        requestDomains: ["api.cdnlibs.org", "cover.cdnlibs.org"],
        resourceTypes: ["xmlhttprequest"],
        excludedInitiatorDomains: ["mangalib.me", "mangalib.org", "hentailib.me", "ranobelib.me"],
      },
    }],
  }]);
});

test("headers install the extra RanobeLib image rule and remove it when switching sources", async (t) => {
  const { dnr } = setup(t);
  assert.equal(await patchApiHeaders(ranobelib, ranobeUrl), true);
  const options = dnr.updateSessionRules.mock.calls[0]?.arguments[0] as {
    addRules: chrome.declarativeNetRequest.Rule[];
  };
  assert.deepEqual(options.addRules.map(({ id }) => id), [1, 2]);
  const imageRule = options.addRules[1]!;
  assert.deepEqual(imageRule.condition.requestDomains, ["ranobelib.me"]);
  assert.deepEqual(imageRule.condition.resourceTypes, ["xmlhttprequest"]);
  assert.deepEqual(imageRule.action.requestHeaders, [
    { header: "accept", operation: "set", value: "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8" },
    { header: "referer", operation: "set", value: ranobeUrl },
    { header: "sec-fetch-site", operation: "set", value: "same-origin" },
  ]);

  assert.equal(await patchApiHeaders(mangalib, mangaUrl), true);
  const replacement = dnr.updateSessionRules.mock.calls[1]?.arguments[0] as {
    removeRuleIds: number[];
    addRules: chrome.declarativeNetRequest.Rule[];
  };
  assert.deepEqual(replacement.removeRuleIds, [1, 2]);
  assert.deepEqual(replacement.addRules.map(({ id }) => id), [1]);
});

test("headers clear both sets of rules for sources that need no header overrides", async (t) => {
  const { dnr } = setup(t);
  assert.equal(await patchApiHeaders({ ...mangalib, requestPatch: undefined }, mangaUrl), true);
  assert.deepEqual(dnr.updateDynamicRules.mock.calls[0]?.arguments, [{ removeRuleIds: [1, 2] }]);
  assert.deepEqual(dnr.updateSessionRules.mock.calls[0]?.arguments, [{ removeRuleIds: [1, 2] }]);
});

test("headers report unavailable declarativeNetRequest instead of claiming success", async (t) => {
  const { warn, dnr } = setup(t);
  Reflect.deleteProperty(chrome, "declarativeNetRequest");
  assert.equal(await patchApiHeaders(mangalib, mangaUrl), false);
  assert.equal(dnr.updateDynamicRules.mock.callCount(), 0);
  assert.equal(warn.mock.callCount(), 1);
});

test("headers stop if removing legacy dynamic rules fails", async (t) => {
  const { dnr, warn } = setup(t);
  const error = new Error("Dynamic rules unavailable");
  dnr.updateDynamicRules.mock.mockImplementation(async () => { throw error; });
  assert.equal(await patchApiHeaders(mangalib, mangaUrl), false);
  assert.equal(dnr.updateSessionRules.mock.callCount(), 0);
  assert.equal(warn.mock.calls[0]?.arguments[1], error);
});

test("headers return false when the browser rejects a session rule", async (t) => {
  const { dnr, warn } = setup(t);
  const error = new Error("Invalid header operation");
  dnr.updateSessionRules.mock.mockImplementation(async () => { throw error; });
  assert.equal(await patchApiHeaders(ranobelib, ranobeUrl), false);
  assert.equal(dnr.updateDynamicRules.mock.callCount(), 1);
  assert.equal(warn.mock.calls[0]?.arguments[1], error);
});

test("headers reject excess rules before installing a partial set", async (t) => {
  const { dnr, warn } = setup(t);
  const patch = mangalib.requestPatch!(mangaUrl);
  const source = { ...mangalib, requestPatch: () => ({ ...patch, additionalRules: [patch, patch] }) };
  assert.equal(await patchApiHeaders(source, mangaUrl), false);
  assert.equal(dnr.updateSessionRules.mock.callCount(), 0);
  assert.match(String(warn.mock.calls[0]?.arguments[1]), /Слишком много правил/);
});
