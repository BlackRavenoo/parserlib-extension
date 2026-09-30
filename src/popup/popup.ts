import { ext } from "../lib/browser";
import { listFormats } from "../export/registry";
import { resolveKeyByUrl } from "../sources/registry";
import { readTokenFromTab, stashToken } from "../lib/token";

const formatSelect = document.getElementById("format") as HTMLSelectElement;
const startButton = document.getElementById("start") as HTMLButtonElement;
const sourceEl = document.getElementById("source") as HTMLDivElement;

const SOURCE_LABELS: Record<string, string> = {
  mangalib: "MangaLib",
  ranobelib: "RanobeLib",
};

for (const format of listFormats()) {
  const option = document.createElement("option");
  option.value = format;
  option.textContent = format.toUpperCase();
  formatSelect.append(option);
}

let currentUrl: string | null = null;
let currentKey: string | null = null;
let currentTabId: number | null = null;

ext.tabs
  .queryActive()
  .then((tab) => {
    const url = tab?.url;
    if (!url || tab?.id == null) {
      sourceEl.textContent = "Не вижу адрес страницы.";
      return;
    }

    const key = resolveKeyByUrl(url);
    if (!key) {
      sourceEl.textContent = "Эта страница не поддерживается. Открой тайтл.";
      return;
    }

    currentUrl = url;
    currentKey = key;
    currentTabId = tab.id;
    sourceEl.textContent = `${SOURCE_LABELS[key] ?? key}: ${new URL(url).pathname}`;
    startButton.disabled = false;
  })
  .catch(() => {
    sourceEl.textContent = "Не удалось прочитать адрес вкладки.";
  });

startButton.addEventListener("click", async () => {
  if (!currentUrl || !currentKey || currentTabId == null) return;

  startButton.disabled = true;
  sourceEl.textContent = "Читаю авторизацию…";

  const token = await readTokenFromTab(currentTabId);
  await stashToken(currentKey, token);

  const params = new URLSearchParams({ url: currentUrl, format: formatSelect.value });
  ext.tabs.create({ url: chrome.runtime.getURL(`job/index.html?${params}`) });
  window.close();
});
