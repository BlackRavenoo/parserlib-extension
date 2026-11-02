import assert from "node:assert/strict";
import test from "node:test";
import type { TestContext } from "node:test";
import { IDBDatabase, IDBFactory, IDBObjectStore } from "fake-indexeddb";
import { removeAppendFile, storeAppendFile, takeAppendFile } from "../src/lib/append-file";
import { setGlobal } from "./helpers/globals";

const databaseName = "parserlib-append-files";
const day = 24 * 60 * 60 * 1000;
const file = new File([new Uint8Array([0x50, 0x4b, 3, 4, 0, 255])], "Книга.epub", {
  type: "application/epub+zip",
  lastModified: 123456789,
});
const missingFile = /Выбранный EPUB не найден/;

function useDatabase(t: TestContext): IDBFactory {
  const factory = new IDBFactory();
  setGlobal(t, "indexedDB", factory);
  t.after(() => new Promise<void>((resolve, reject) => {
    const request = factory.deleteDatabase(databaseName);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error("Соединение с хранилищем файлов не закрыто."));
  }));
  return factory;
}

function openDatabase(factory: IDBFactory, version = 1): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = factory.open(databaseName, version);
    request.onupgradeneeded = () => {
      request.result.createObjectStore("files", { keyPath: "id" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function readRecords(factory: IDBFactory): Promise<unknown[]> {
  const db = await openDatabase(factory);
  try {
    return await new Promise((resolve, reject) => {
      const transaction = db.transaction("files", "readonly");
      const request = transaction.objectStore("files").getAll();
      transaction.oncomplete = () => resolve(request.result);
      transaction.onabort = () => reject(transaction.error);
    });
  } finally {
    db.close();
  }
}

function abortAfterRequest(t: TestContext, method: "put" | "get" | "delete") {
  const original = IDBObjectStore.prototype[method];
  return t.mock.method(IDBObjectStore.prototype, method, function (this: IDBObjectStore, ...args: unknown[]) {
    const request: IDBRequest = Reflect.apply(original, this, args);
    request.addEventListener("success", () => this.transaction.abort());
    return request;
  });
}

test("append files preserve binary content and File metadata and can only be taken once", async (t) => {
  useDatabase(t);
  const id = await storeAppendFile(file);
  const taken = await takeAppendFile(id);

  assert.ok(taken instanceof File);
  assert.notEqual(taken, file);
  assert.equal(taken.name, file.name);
  assert.equal(taken.type, file.type);
  assert.equal(taken.lastModified, file.lastModified);
  assert.deepEqual(await taken.bytes(), await file.bytes());
  await assert.rejects(takeAppendFile(id), missingFile);
});

test("concurrent consumers cannot take the same append file twice", async (t) => {
  const factory = useDatabase(t);
  const id = await storeAppendFile(file);
  const results = await Promise.allSettled([takeAppendFile(id), takeAppendFile(id)]);

  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  const rejected = results.find((result) => result.status === "rejected");
  assert.ok(rejected?.status === "rejected");
  assert.match(rejected.reason.message, missingFile);
  assert.deepEqual(await readRecords(factory), []);
});

test("append file IDs are independent and removal is idempotent", async (t) => {
  useDatabase(t);
  const first = await storeAppendFile(file);
  const otherFile = new File(["Другая книга"], "Другая.epub");
  const second = await storeAppendFile(otherFile);
  assert.notEqual(first, second);

  await removeAppendFile(first);
  await removeAppendFile(first);
  await assert.rejects(takeAppendFile(first), missingFile);
  assert.equal(await (await takeAppendFile(second)).text(), await otherFile.text());
});

test("missing append files produce a recoverable error even in a new database", async (t) => {
  const factory = useDatabase(t);
  await assert.rejects(takeAppendFile("missing"), missingFile);
  await removeAppendFile("missing");
  assert.deepEqual(await readRecords(factory), []);
});

test("malformed append file records are rejected and consumed", async (t) => {
  const factory = useDatabase(t);
  const db = await openDatabase(factory);
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction("files", "readwrite");
      const store = transaction.objectStore("files");
      store.put({ id: "blob", file: new Blob(["EPUB"]), createdAt: Date.now() });
      store.put({ id: "empty", createdAt: Date.now() });
      transaction.oncomplete = () => resolve();
      transaction.onabort = () => reject(transaction.error);
    });
  } finally {
    db.close();
  }

  await assert.rejects(takeAppendFile("blob"), missingFile);
  await assert.rejects(takeAppendFile("empty"), missingFile);
  assert.deepEqual(await readRecords(factory), []);
});

test("saving an append file removes only records strictly older than a day", async (t) => {
  useDatabase(t);
  let now = 1000;
  t.mock.method(Date, "now", () => now);
  const expired = await storeAppendFile(file);
  now += 1;
  const boundary = await storeAppendFile(file);
  now += 1;
  const fresh = await storeAppendFile(file);
  now = 1001 + day;
  const newest = await storeAppendFile(file);

  await assert.rejects(takeAppendFile(expired), missingFile);
  for (const id of [boundary, fresh, newest]) {
    assert.deepEqual(await (await takeAppendFile(id)).bytes(), await file.bytes());
  }
});

test("aborting an append file write rolls back both the file and expired-record cleanup", async (t) => {
  const factory = useDatabase(t);
  let now = 1000;
  t.mock.method(Date, "now", () => now);
  const expired = await storeAppendFile(file);
  now += day + 1;
  const original = IDBObjectStore.prototype.openCursor;
  const cursorMock = t.mock.method(IDBObjectStore.prototype, "openCursor", function (this: IDBObjectStore, ...args: unknown[]) {
    const request: IDBRequest<IDBCursorWithValue | null> = Reflect.apply(original, this, args);
    request.addEventListener("success", () => {
      if (!request.result) this.transaction.abort();
    });
    return request;
  });

  await assert.rejects(storeAppendFile(file), /Сохранение файла прервано/);
  cursorMock.mock.restore();
  const records = await readRecords(factory);
  assert.equal(records.length, 1);
  assert.deepEqual(await (await takeAppendFile(expired)).bytes(), await file.bytes());
});

test("an aborted append file read does not return or consume the file", async (t) => {
  useDatabase(t);
  const id = await storeAppendFile(file);
  const getMock = abortAfterRequest(t, "get");

  await assert.rejects(takeAppendFile(id), /Сохранение файла прервано/);
  getMock.mock.restore();
  assert.deepEqual(await (await takeAppendFile(id)).bytes(), await file.bytes());
});

test("an aborted append file removal leaves the file available", async (t) => {
  useDatabase(t);
  const id = await storeAppendFile(file);
  const deleteMock = abortAfterRequest(t, "delete");

  await assert.rejects(removeAppendFile(id), /Сохранение файла прервано/);
  deleteMock.mock.restore();
  assert.deepEqual(await (await takeAppendFile(id)).bytes(), await file.bytes());
});

const operations = {
  store: () => storeAppendFile(file),
  take: (id: string) => takeAppendFile(id),
  remove: (id: string) => removeAppendFile(id),
};

for (const [name, operation] of Object.entries(operations)) {
  test(`append file ${name} waits for rollback and preserves the transaction error`, async (t) => {
    const factory = useDatabase(t);
    const id = await storeAppendFile(file);
    const original = IDBDatabase.prototype.transaction;
    let aborted = false;
    const transactionMock = t.mock.method(IDBDatabase.prototype, "transaction", function (this: IDBDatabase, ...args: unknown[]) {
      const transaction: IDBTransaction = Reflect.apply(original, this, args);
      transaction.addEventListener("abort", () => { aborted = true; });
      const store = transaction.objectStore("files");
      store.add({ id: "conflict" });
      store.add({ id: "conflict" });
      return transaction;
    });

    await assert.rejects(operation(id), { name: "ConstraintError" });
    assert.equal(aborted, true);
    transactionMock.mock.restore();
    assert.equal((await readRecords(factory)).length, 1);
    assert.deepEqual(await (await takeAppendFile(id)).bytes(), await file.bytes());
  });

  test(`append file ${name} propagates database opening errors`, async (t) => {
    const factory = useDatabase(t);
    const db = await openDatabase(factory, 2);
    db.close();
    await assert.rejects(operation("unused"), { name: "VersionError" });
  });

  test(`append file ${name} closes its connection when transaction creation throws`, async (t) => {
    useDatabase(t);
    const id = await storeAppendFile(file);
    const error = new DOMException("Хранилище недоступно.", "InvalidStateError");
    const closeMock = t.mock.method(IDBDatabase.prototype, "close");
    t.mock.method(IDBDatabase.prototype, "transaction", () => { throw error; });

    await assert.rejects(operation(id), (reason) => reason === error);
    assert.equal(closeMock.mock.callCount(), 1);
  });
}
