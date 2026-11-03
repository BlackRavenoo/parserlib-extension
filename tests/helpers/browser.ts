import assert from "node:assert/strict";
import test from "node:test";
import type { TestContext } from "node:test";
import { setGlobal } from "./globals";

type Extension = typeof import("../../src/lib/browser").ext;
type BrowserKind = "Chrome" | "Firefox";

function createApi(t: TestContext) {
  return {
    runtime: {} as { lastError?: { message: string } },
    storage: { session: { get: t.mock.fn(), set: t.mock.fn(), remove: t.mock.fn() } },
    tabs: { query: t.mock.fn(), create: t.mock.fn() },
    scripting: { executeScript: t.mock.fn() },
    downloads: { download: t.mock.fn() },
  };
}

type Api = ReturnType<typeof createApi>;
interface Operation {
  name: string;
  method: (api: Api) => Api["tabs"]["query"];
  invoke: (ext: Extension) => Promise<unknown>;
  args: unknown[];
  result: unknown;
  expected: unknown;
  promiseInChrome?: boolean;
  checkErrors?: boolean;
}

const stored = { "job-plan:test": { token: "test-token" } };
const items = { "job-plan:test": { token: "new-token" } };
const tab = { id: 42, url: "https://ranobelib.me/ru/book/test" };
const createOptions = { url: "job/index.html?id=test", active: true };
const downloadOptions = { url: "blob:test", filename: "Книга.epub", saveAs: true };
const injection = { target: { tabId: 42 }, func: (value: string) => value, args: ["test-token"] };
const scriptResults = [{ frameId: 0, result: "test-token" }, { frameId: 1, result: null }];

const operations: Operation[] = [
  ...["job-plan:test", ["job-plan:test", "popup-cache:42"], null].map((keys, index) => ({
    name: `storage.session.get(${JSON.stringify(keys)})`,
    method: (api: Api) => api.storage.session.get,
    invoke: (ext: Extension) => ext.storage.session.get(keys),
    args: [keys], result: stored, expected: stored, checkErrors: index === 0,
  })),
  {
    name: "storage.session.set", method: (api) => api.storage.session.set,
    invoke: (ext) => ext.storage.session.set(items),
    args: [items], result: undefined, expected: undefined,
  },
  ...["job-plan:test", ["job-plan:test", "popup-cache:42"]].map((keys, index) => ({
    name: `storage.session.remove(${JSON.stringify(keys)})`,
    method: (api: Api) => api.storage.session.remove,
    invoke: (ext: Extension) => ext.storage.session.remove(keys),
    args: [keys], result: undefined, expected: undefined, checkErrors: index === 0,
  })),
  {
    name: "tabs.queryActive", method: (api) => api.tabs.query,
    invoke: (ext) => ext.tabs.queryActive(),
    args: [{ active: true, currentWindow: true }], result: [tab, { id: 43 }], expected: tab,
  },
  {
    name: "tabs.queryActive with no active tab", method: (api) => api.tabs.query,
    invoke: (ext) => ext.tabs.queryActive(),
    args: [{ active: true, currentWindow: true }], result: [], expected: undefined, checkErrors: false,
  },
  {
    name: "tabs.create", method: (api) => api.tabs.create,
    invoke: (ext) => ext.tabs.create(createOptions),
    args: [createOptions], result: tab, expected: tab,
  },
  {
    name: "downloads.download", method: (api) => api.downloads.download,
    invoke: (ext) => ext.downloads.download(downloadOptions),
    args: [downloadOptions], result: 0, expected: 0,
  },
  {
    name: "scripting.executeScript", method: (api) => api.scripting.executeScript,
    invoke: (ext) => ext.scripting.executeScript(injection),
    args: [injection], result: scriptResults, expected: scriptResults, promiseInChrome: true,
  },
];

export function testBrowser(kind: BrowserKind): void {
  async function setup(t: TestContext) {
    const api = createApi(t);
    setGlobal(t, "chrome", kind === "Chrome" ? api : undefined);
    setGlobal(t, "browser", kind === "Firefox" ? api : undefined);
    const { ext } = await import("../../src/lib/browser");
    return { api, ext };
  }

  for (const operation of operations) {
    test(`${kind} shim forwards arguments and waits for ${operation.name}`, async (t) => {
      const { api, ext } = await setup(t);
      const method = operation.method(api);
      const usesPromise = kind === "Firefox" || operation.promiseInChrome;
      const deferred = Promise.withResolvers<unknown>();
      if (usesPromise) method.mock.mockImplementation(() => deferred.promise);

      let settled = false;
      const pending = operation.invoke(ext).then((value) => { settled = true; return value; });
      await Promise.resolve();
      assert.equal(settled, false);
      assert.equal(method.mock.callCount(), 1);
      const args = method.mock.calls[0]!.arguments;
      assert.deepEqual(usesPromise ? args : args.slice(0, -1), operation.args);
      if (usesPromise) {
        deferred.resolve(operation.result);
      } else {
        assert.equal(args.length, operation.args.length + 1);
        const callback = args.at(-1);
        assert.equal(typeof callback, "function");
        callback(operation.result);
      }
      assert.equal(await pending, operation.expected);
    });
  }

  for (const operation of operations.filter((operation) => operation.checkErrors !== false)) {
    test(`${kind} shim rejects errors from ${operation.name}`, async (t) => {
      const { api, ext } = await setup(t);
      const method = operation.method(api);
      const error = new Error("Браузер отклонил операцию");
      const usesPromise = kind === "Firefox" || operation.promiseInChrome;
      const deferred = Promise.withResolvers<unknown>();
      if (usesPromise) method.mock.mockImplementation(() => deferred.promise);
      const pending = operation.invoke(ext);
      const rejected = assert.rejects(pending, (reason: unknown) => {
        if (usesPromise) assert.equal(reason, error);
        else {
          assert.ok(reason instanceof Error);
          assert.equal(reason.message, error.message);
        }
        return true;
      });

      if (usesPromise) deferred.reject(error);
      else {
        const callback = method.mock.calls[0]!.arguments.at(-1);
        api.runtime.lastError = { message: error.message };
        try {
          callback(undefined);
        } finally {
          delete api.runtime.lastError;
        }
      }
      await rejected;
    });
  }
}
