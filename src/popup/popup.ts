import { ext } from "../lib/browser";
import { patchApiHeaders } from "../lib/headers";
import { removeJobPlan, storeJobPlan } from "../lib/job-plan";
import { removeAppendFile, storeAppendFile } from "../lib/append-file";
import { getPopupData, storePopupData, tokenFingerprint } from "../lib/popup-cache";
import { getFormat, listFormats } from "../export/registry";
import { getSourceByUrl, resolveKeyByUrl } from "../sources/registry";
import { readFromTab } from "../lib/token";
import type { ChapterRef, TitleMeta } from "../sources/types";

const form = document.getElementById("settings-form") as HTMLFormElement;
const formatSelect = document.getElementById("format") as HTMLSelectElement;
const startButton = document.getElementById("start") as HTMLButtonElement;
const sourceEl = document.getElementById("source") as HTMLDivElement;
const statusEl = document.getElementById("status") as HTMLDivElement;
const fromInput = document.getElementById("range-from") as HTMLSelectElement;
const toInput = document.getElementById("range-to") as HTMLSelectElement;
const chapterCountEl = document.getElementById("chapter-count") as HTMLParagraphElement;
const appendOption = document.getElementById("append-option") as HTMLDivElement;
const appendEnabled = document.getElementById("append-enabled") as HTMLInputElement;
const appendFileRow = document.getElementById("append-file-row") as HTMLDivElement;
const appendFileInput = document.getElementById("append-file") as HTMLInputElement;

const SOURCE_LABELS: Record<string, string> = {
  mangalib: "MangaLib",
  ranobelib: "RanobeLib",
};

for (const format of listFormats()) {
  const option = document.createElement("option");
  option.value = format.key;
  option.textContent = format.key.toUpperCase();
  formatSelect.append(option);
}

function updateAppendControls(): void {
  const format = getFormat(formatSelect.value);
  appendOption.hidden = !format.supportsAppend;
  if (!format.supportsAppend) appendEnabled.checked = false;
  appendFileRow.hidden = !appendEnabled.checked;
  appendFileInput.disabled = !appendEnabled.checked;
  appendFileInput.required = appendEnabled.checked;
  startButton.textContent = appendEnabled.checked ? "Докачать" : "Скачать";
}

formatSelect.addEventListener("change", updateAppendControls);
appendEnabled.addEventListener("change", updateAppendControls);
updateAppendControls();

let currentUrl: string | null = null;
let currentKey: string | null = null;
let currentMeta: TitleMeta | null = null;
let currentChapters: ChapterRef[] = [];
let currentToken: string | null = null;

function showError(error: unknown): void {
  statusEl.classList.add("error");
  statusEl.textContent = `Ошибка: ${error instanceof Error ? error.message : String(error)}`;
}

function showSettings(meta: TitleMeta, chapters: ChapterRef[]): void {
  currentMeta = meta;
  currentChapters = chapters;

  const fillSelect = (select: HTMLSelectElement, selectedIndex: number): void => {
    select.replaceChildren();
    chapters.forEach((chapter, index) => {
      const option = document.createElement("option");
      option.value = String(index);
      option.textContent = chapter.title;
      option.title = chapter.title;
      select.append(option);
    });
    select.value = String(selectedIndex);
    select.disabled = false;
  };

  fillSelect(fromInput, 0);
  fillSelect(toInput, chapters.length - 1);
  chapterCountEl.textContent = `Найдено глав: ${chapters.length}`;
  statusEl.classList.remove("error");
  statusEl.textContent = "Выберите начальную и конечную главу.";
  startButton.disabled = false;
}

async function initialize(): Promise<void> {
  const tab = await ext.tabs.queryActive();
  const url = tab?.url;
  if (!url || tab?.id == null) {
    sourceEl.textContent = "Не вижу адрес страницы.";
    return;
  }

  const key = resolveKeyByUrl(url);
  const source = key ? await getSourceByUrl(url) : null;
  if (!key || !source || !source.titleSlug(url)) {
    sourceEl.textContent = "На этой странице нечего скачивать.";
    return;
  }

  currentUrl = url;
  currentKey = key;
  const label = SOURCE_LABELS[key] ?? key;
  const slug = source.titleSlug(url)!;
  const [domTitle, token, documentTimeOrigin] = await Promise.all([
    source.titleInPage ? readFromTab(tab.id, source.titleInPage) : Promise.resolve(null),
    source.tokenInPage ? readFromTab(tab.id, source.tokenInPage) : Promise.resolve(null),
    readFromTab(tab.id, () => String(performance.timeOrigin)),
  ]);
  sourceEl.textContent = domTitle ? `${label}: ${domTitle}` : `${label}: загружаю название…`;
  form.hidden = false;
  currentToken = token;

  const fingerprint = await tokenFingerprint(token);
  const identity = documentTimeOrigin
    ? JSON.stringify([slug, documentTimeOrigin, fingerprint])
    : null;

  if (!(await patchApiHeaders(source, url))) {
    throw new Error("Не удалось настроить заголовки запроса. Перезагрузите расширение и попробуйте снова.");
  }

  const cached = identity ? await getPopupData(tab.id) : null;
  if (cached && cached.identity === identity) {
    const meta = domTitle ? { ...cached.meta, title: domTitle } : cached.meta;
    sourceEl.textContent = `${label}: ${meta.title}`;
    showSettings(meta, cached.chapters);
    return;
  }

  statusEl.textContent = "Загружаю список глав…";

  let meta: TitleMeta;
  let chapters: ChapterRef[];
  if (domTitle) {
    meta = { id: slug.split("--", 1)[0]!, title: domTitle };
    chapters = await source.fetchChapters(url, token);
  } else {
    ({ meta, chapters } = await source.fetchTitle(url, token));
    sourceEl.textContent = `${label}: ${meta.title}`;
  }
  currentMeta = meta;
  currentChapters = chapters.sort((a, b) => a.id - b.id);
  if (currentChapters.length === 0) {
    throw new Error("У этой работы нет глав для скачивания.");
  }

  showSettings(meta, currentChapters);
  if (identity) await storePopupData(tab.id, { identity, meta, chapters: currentChapters });
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!currentUrl || !currentKey || !currentMeta) return;

  const fromIndex = Number(fromInput.value);
  const toIndex = Number(toInput.value);
  if (!Number.isInteger(fromIndex) || !Number.isInteger(toIndex) || fromIndex < 0 || toIndex >= currentChapters.length || fromIndex > toIndex) {
    showError("Начальная глава должна идти в списке раньше конечной.");
    return;
  }
  const selected = currentChapters.slice(fromIndex, toIndex + 1);
  const format = getFormat(formatSelect.value);
  const appendFile = format.supportsAppend && appendEnabled.checked ? appendFileInput.files?.[0] : null;
  if (appendEnabled.checked && (!appendFile || !appendFile.name.toLowerCase().endsWith(`.${format.extension}`))) {
    showError("Выберите существующий файл.");
    return;
  }

  startButton.disabled = true;
  statusEl.classList.remove("error");
  statusEl.textContent = "Готовлю загрузку…";
  let appendFileId: string | undefined;
  let planId: string | undefined;
  try {
    if (appendFile) appendFileId = await storeAppendFile(appendFile);
    planId = await storeJobPlan({
      sourceKey: currentKey,
      token: currentToken,
      format: formatSelect.value,
      meta: currentMeta,
      chapters: selected,
      ...(appendFileId && { appendFileId }),
    });
    await ext.tabs.create({ url: chrome.runtime.getURL(`job/index.html?plan=${encodeURIComponent(planId)}`) });
    window.close();
  } catch (error) {
    await Promise.allSettled([
      ...(appendFileId ? [removeAppendFile(appendFileId)] : []),
      ...(planId ? [removeJobPlan(planId)] : []),
    ]);
    showError(error);
    startButton.disabled = false;
  }
});

initialize().catch(showError);
