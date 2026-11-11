import assert from "node:assert/strict";
import test from "node:test";
import { removeJobPlan, storeJobPlan, takeJobPlan } from "../src/lib/job-plan";
import type { JobPlan } from "../src/lib/job-plan";
import { mockSession } from "./helpers/extension";

const plan: JobPlan = {
  sourceKey: "ranobelib",
  token: "test-token",
  format: "epub",
  meta: { id: "123", title: "Тестовая книга" },
  chapters: [{ id: 1, title: "Том 1, Глава 1", key: "number=1&volume=1", slug: "123--test" }],
  appendFileId: "existing-epub",
};

test("job plans preserve download parameters and are removed after being taken", async (t) => {
  const { stored } = mockSession(t);
  const id = await storeJobPlan(plan);
  assert.deepEqual(await takeJobPlan(id), plan);
  assert.equal(stored.size, 0);
  assert.equal(await takeJobPlan(id), null);
});

test("job plans have independent IDs and deleting one leaves other downloads intact", async (t) => {
  mockSession(t);
  const first = await storeJobPlan(plan);
  const anonymous = { ...plan, token: null, format: "fb2", appendFileId: undefined };
  const second = await storeJobPlan(anonymous);
  assert.notEqual(first, second);

  await removeJobPlan(first);
  await removeJobPlan(first);
  assert.equal(await takeJobPlan(first), null);
  assert.deepEqual(await takeJobPlan(second), anonymous);
});

test("job plans return null for absent or primitive entries and remove malformed entries", async (t) => {
  const { stored } = mockSession(t);
  assert.equal(await takeJobPlan("missing"), null);
  for (const value of [null, false, 12, "broken"]) {
    stored.set("job-plan:broken", value);
    assert.equal(await takeJobPlan("broken"), null);
    assert.equal(stored.has("job-plan:broken"), false);
  }
});

test("job plans propagate storage write errors instead of returning a usable ID", async (t) => {
  const { set, stored } = mockSession(t);
  const error = new Error("Storage quota exceeded");
  set.mock.mockImplementation(async () => { throw error; });
  await assert.rejects(storeJobPlan(plan), (reason) => reason === error);
  assert.equal(stored.size, 0);
});

test("job plans do not delete unread data when the storage read fails", async (t) => {
  const { get, remove } = mockSession(t);
  const error = new Error("Storage unavailable");
  get.mock.mockImplementation(async () => { throw error; });
  await assert.rejects(takeJobPlan("id"), (reason) => reason === error);
  assert.equal(remove.mock.callCount(), 0);
});

test("job plans propagate deletion errors instead of handing out a retained token", async (t) => {
  const { remove } = mockSession(t);
  const id = await storeJobPlan(plan);
  const error = new Error("Cannot remove plan");
  remove.mock.mockImplementation(async () => { throw error; });
  await assert.rejects(takeJobPlan(id), (reason) => reason === error);
  await assert.rejects(removeJobPlan(id), (reason) => reason === error);
});
