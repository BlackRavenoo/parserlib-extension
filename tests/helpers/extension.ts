import type { TestContext } from "node:test";
import { ext } from "../../src/lib/browser";

export function setGlobal(t: TestContext, name: string, value: unknown): void {
  const previous = Object.getOwnPropertyDescriptor(globalThis, name);
  Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  t.after(() => {
    if (previous) Object.defineProperty(globalThis, name, previous);
    else Reflect.deleteProperty(globalThis, name);
  });
}

export function mockSession(t: TestContext) {
  const stored = new Map<string, unknown>();
  const get = t.mock.method(ext.storage.session, "get", async (keys: string[] | string | null) => {
    const selected = keys === null ? [...stored.keys()] : typeof keys === "string" ? [keys] : keys;
    return Object.fromEntries(selected.filter((key) => stored.has(key)).map((key) => [key, structuredClone(stored.get(key))]));
  });
  const set = t.mock.method(ext.storage.session, "set", async (items: Record<string, unknown>) => {
    for (const [key, value] of Object.entries(items)) stored.set(key, structuredClone(value));
  });
  const remove = t.mock.method(ext.storage.session, "remove", async (keys: string[] | string) => {
    for (const key of typeof keys === "string" ? [keys] : keys) stored.delete(key);
  });
  return { stored, get, set, remove };
}
