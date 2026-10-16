const DATABASE_NAME = "parserlib-append-files";
const STORE_NAME = "files";
const MAX_AGE_MS = 24 * 60 * 60 * 1000;

interface StoredFile {
  id: string;
  file: File;
  createdAt: number;
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(STORE_NAME, { keyPath: "id" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Не удалось открыть хранилище файлов."));
  });
}

function transactionCompleted(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error("Ошибка сохранения файла."));
    transaction.onabort = () => reject(transaction.error ?? new Error("Сохранение файла прервано."));
  });
}

export async function storeAppendFile(file: File): Promise<string> {
  const db = await openDatabase();
  const id = crypto.randomUUID();
  try {
    const transaction = db.transaction(STORE_NAME, "readwrite");
    const completed = transactionCompleted(transaction);
    const store = transaction.objectStore(STORE_NAME);
    const now = Date.now();
    store.put({ id, file, createdAt: now } satisfies StoredFile);

    const cursorRequest = store.openCursor();
    cursorRequest.onsuccess = () => {
      const cursor = cursorRequest.result;
      if (!cursor) return;
      const stored = cursor.value as StoredFile;
      if (stored.createdAt < now - MAX_AGE_MS) cursor.delete();
      cursor.continue();
    };

    await completed;
    return id;
  } finally {
    db.close();
  }
}

export async function takeAppendFile(id: string): Promise<File> {
  const db = await openDatabase();
  try {
    const transaction = db.transaction(STORE_NAME, "readwrite");
    const completed = transactionCompleted(transaction);
    const store = transaction.objectStore(STORE_NAME);
    const request = store.get(id);
    store.delete(id);
    await completed;
    const file = (request.result as StoredFile | undefined)?.file;
    if (!(file instanceof File)) throw new Error("Выбранный EPUB не найден. Выберите файл заново в popup.");
    return file;
  } finally {
    db.close();
  }
}

export async function removeAppendFile(id: string): Promise<void> {
  const db = await openDatabase();
  try {
    const transaction = db.transaction(STORE_NAME, "readwrite");
    const completed = transactionCompleted(transaction);
    transaction.objectStore(STORE_NAME).delete(id);
    await completed;
  } finally {
    db.close();
  }
}
