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

export const ext = {
  storage: {
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
        : promisify((cb) => chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => cb(tabs[0]))),
    query: (info: chrome.tabs.QueryInfo): Promise<chrome.tabs.Tab[]> =>
      hasNativeBrowser
        ? browser!.tabs.query(info)
        : promisify((cb) => chrome.tabs.query(info, cb)),
    get: (tabId: number): Promise<chrome.tabs.Tab> =>
      hasNativeBrowser
        ? browser!.tabs.get(tabId)
        : promisify((cb) => chrome.tabs.get(tabId, cb)),
    create: (options: chrome.tabs.CreateProperties): Promise<chrome.tabs.Tab> =>
      hasNativeBrowser
        ? browser!.tabs.create(options)
        : promisify((cb) => chrome.tabs.create(options, cb)),
    remove: (tabId: number): Promise<void> =>
      hasNativeBrowser
        ? browser!.tabs.remove(tabId)
        : promisify((cb) => chrome.tabs.remove(tabId, () => cb(undefined))),
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
  },
};
