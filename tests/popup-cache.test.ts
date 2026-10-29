import assert from "node:assert/strict";
import test from "node:test";
import { getPopupData, storePopupData, tokenFingerprint } from "../src/lib/popup-cache";
import type { PopupData } from "../src/lib/popup-cache";
import { mockSession } from "./helpers/extension";

const data: PopupData = {
  identity: "test-page-identity",
  meta: { id: "123", title: "Тестовая книга", author: "Автор" },
  chapters: [{ id: 1, title: "Том 1, Глава 1", key: "number=1&volume=1", slug: "123--test" }],
};

test("popup cache preserves title metadata and chapters independently for each tab", async (t) => {
  mockSession(t);
  const other = { ...data, identity: "other-page", meta: { id: "456", title: "Другая книга" } };
  assert.equal(await getPopupData(1), null);
  await storePopupData(1, data);
  await storePopupData(2, other);

  assert.deepEqual(await getPopupData(1), data);
  assert.deepEqual(await getPopupData(2), other);
  assert.equal(await getPopupData(3), null);
  assert.deepEqual(await getPopupData(1), data);
});

test("popup cache replaces old page data without changing the cache of other tabs", async (t) => {
  mockSession(t);
  await storePopupData(1, data);
  await storePopupData(2, data);
  const updated = { ...data, identity: "reloaded-page", chapters: [] };
  await storePopupData(1, updated);

  assert.deepEqual(await getPopupData(1), updated);
  assert.deepEqual(await getPopupData(2), data);
});

test("popup cache rejects corrupted entries and incomplete metadata", async (t) => {
  const { stored } = mockSession(t);
  for (const value of [
    null, false, 1, "invalid", [], {},
    { ...data, identity: 123 },
    { ...data, meta: null },
    { ...data, meta: {} },
    { ...data, meta: { title: 12 } },
    { ...data, chapters: null },
    { ...data, chapters: {} },
  ]) {
    stored.set("popup-data:1", value);
    assert.equal(await getPopupData(1), null, JSON.stringify(value));
  }
});

test("popup cache propagates storage failures", async (t) => {
  const { get, set } = mockSession(t);
  const error = new Error("Storage unavailable");
  get.mock.mockImplementation(async () => { throw error; });
  set.mock.mockImplementation(async () => { throw error; });
  await assert.rejects(getPopupData(1), (reason) => reason === error);
  await assert.rejects(storePopupData(1, data), (reason) => reason === error);
});

test("token fingerprints are stable SHA-256 hashes and change when the token changes", async () => {
  assert.equal(await tokenFingerprint(null), "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
  assert.equal(await tokenFingerprint(""), await tokenFingerprint(null));
  assert.equal(await tokenFingerprint("abc"), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  assert.equal(await tokenFingerprint("test-token"), await tokenFingerprint("test-token"));
  assert.notEqual(await tokenFingerprint("test-token"), await tokenFingerprint("updated-token"));
});
