type ChromeLike = typeof chrome;

declare const browser: ChromeLike | undefined;

const hasNativeBrowser = typeof browser !== "undefined";

function promisify<T>(fn: (cb: (result: T) => void) => void): Promise<T> {
  return new Promise((resolve, reject) => {
    fn((result) => {
      const err = chrome.runtime.lastError;
      if (err) reject(new Error(err.message));
      else resolve(result);
    });
  });
}

function waitForDownload(id: number): Promise<void> {
  const downloads = (hasNativeBrowser ? browser! : chrome).downloads;
  let removeListeners: (() => void) | undefined;

  return new Promise<void>((resolve, reject) => {
    function checkState(state: string | undefined, error?: string): void {
      if (state === "complete") resolve();
      if (state === "interrupted") {
        reject(new Error(error ? `Сохранение файла прервано (${error}).` : "Сохранение файла прервано."));
      }
    }

    function onChanged(delta: chrome.downloads.DownloadDelta): void {
      if (delta.id === id) checkState(delta.state?.current, delta.error?.current);
    }

    function onErased(erasedId: number): void {
      if (erasedId === id) reject(new Error("Запись о сохранении файла удалена из истории загрузок."));
    }

    removeListeners = () => {
      downloads.onChanged.removeListener(onChanged);
      downloads.onErased.removeListener(onErased);
    };
    downloads.onChanged.addListener(onChanged);
    downloads.onErased.addListener(onErased);

    const search = hasNativeBrowser
      ? downloads.search({ id })
      : promisify<chrome.downloads.DownloadItem[]>((cb) => downloads.search({ id }, cb));
    void search.then(([item]) => {
      if (item) checkState(item.state, item.error);
      else reject(new Error("Браузер не нашёл запись о сохранении файла."));
    }, reject);
  }).finally(() => removeListeners?.());
}

export const ext = {
  storage: {
    local: {
      get: (key: string): Promise<Record<string, unknown>> =>
        hasNativeBrowser
          ? browser!.storage.local.get(key)
          : promisify((cb) => chrome.storage.local.get(key, cb)),
      set: (items: Record<string, unknown>): Promise<void> =>
        hasNativeBrowser
          ? browser!.storage.local.set(items)
          : promisify((cb) => chrome.storage.local.set(items, () => cb(undefined))),
    },
    session: {
      get: (keys: string[] | string | null): Promise<Record<string, unknown>> =>
        hasNativeBrowser
          ? browser!.storage.session.get(keys)
          : promisify((cb) => chrome.storage.session.get(keys, cb)),
      set: (items: Record<string, unknown>): Promise<void> =>
        hasNativeBrowser
          ? browser!.storage.session.set(items)
          : promisify((cb) => chrome.storage.session.set(items, () => cb(undefined))),
      remove: (keys: string[] | string): Promise<void> =>
        hasNativeBrowser
          ? browser!.storage.session.remove(keys)
          : promisify((cb) => chrome.storage.session.remove(keys, () => cb(undefined))),
    },
  },
  tabs: {
    queryActive: (): Promise<chrome.tabs.Tab | undefined> =>
      hasNativeBrowser
        ? browser!.tabs.query({ active: true, currentWindow: true }).then((t) => t[0])
        : promisify<chrome.tabs.Tab[]>((cb) => chrome.tabs.query({ active: true, currentWindow: true }, cb))
          .then((tabs) => tabs[0]),
    create: (options: chrome.tabs.CreateProperties): Promise<chrome.tabs.Tab> =>
      hasNativeBrowser
        ? browser!.tabs.create(options)
        : promisify((cb) => chrome.tabs.create(options, cb)),
  },
  scripting: {
    executeScript: (injection: chrome.scripting.ScriptInjection<any[], any>): Promise<chrome.scripting.InjectionResult[]> =>
      hasNativeBrowser
        ? browser!.scripting.executeScript(injection)
        : chrome.scripting.executeScript(injection),
  },
  downloads: {
    download: (options: chrome.downloads.DownloadOptions): Promise<number> =>
      hasNativeBrowser
        ? browser!.downloads.download(options)
        : promisify((cb) => chrome.downloads.download(options, cb)),
    waitForCompletion: waitForDownload,
  },
};
