import { ext } from "../lib/browser";
import { listFormats } from "../export/registry";

const urlInput = document.getElementById("url") as HTMLInputElement;
const formatSelect = document.getElementById("format") as HTMLSelectElement;
const startButton = document.getElementById("start") as HTMLButtonElement;
const statusEl = document.getElementById("status") as HTMLDivElement;

for (const format of listFormats()) {
  const option = document.createElement("option");
  option.value = format;
  option.textContent = format.toUpperCase();
  formatSelect.append(option);
}

ext.tabs
  .queryActive()
  .then((tab) => {
    if (tab?.url) urlInput.value = tab.url;
  })
  .catch(() => {});

startButton.addEventListener("click", () => {
  const url = urlInput.value.trim();
  if (!url) {
    statusEl.textContent = "Вставь ссылку на тайтл.";
    return;
  }

  const params = new URLSearchParams({ url, format: formatSelect.value });
  ext.tabs.create({ url: chrome.runtime.getURL(`job/index.html?${params}`) });
  window.close();
});
