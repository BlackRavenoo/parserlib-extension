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
    },
  },
  runtime: {
    onMessage: (
      handler: (msg: unknown, sender: chrome.runtime.MessageSender) => void | Promise<unknown>
    ): void => {
      chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
        const result = handler(msg, sender);
        if (result instanceof Promise) {
          result.then(sendResponse);
          return true;
        }
        return undefined;
      });
    },
  },
  tabs: {
    queryActive: (): Promise<chrome.tabs.Tab | undefined> =>
      hasNativeBrowser
        ? browser!.tabs.query({ active: true, currentWindow: true }).then((t) => t[0])
        : promisify((cb) => chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => cb(tabs[0]))),
    create: (options: chrome.tabs.CreateProperties): Promise<chrome.tabs.Tab> =>
      hasNativeBrowser
        ? browser!.tabs.create(options)
        : promisify((cb) => chrome.tabs.create(options, cb)),
  },
  downloads: {
    download: (options: chrome.downloads.DownloadOptions): Promise<number> =>
      hasNativeBrowser
        ? browser!.downloads.download(options)
        : promisify((cb) => chrome.downloads.download(options, cb)),
  },
};
