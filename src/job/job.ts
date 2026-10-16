import { ext } from "../lib/browser";
import { takeJobPlan } from "../lib/job-plan";
import { takeAppendFile } from "../lib/append-file";
import { chaptersToAppend } from "../lib/append-plan";
import { getSource } from "../sources/registry";
import { getExporter, getFormat } from "../export/registry";
import type { Book, BookChapter } from "../export/types";
import { sanitizeFilename } from "../export/types";

const statusEl = document.getElementById("status") as HTMLDivElement;
const titleEl = document.getElementById("title") as HTMLHeadingElement;
const barEl = document.getElementById("bar") as HTMLProgressElement;

function setStatus(text: string, done?: number, total?: number): void {
  statusEl.textContent = text;
  if (done !== undefined && total) {
    barEl.max = total;
    barEl.value = done;
  }
}

function showError(message: string): void {
  statusEl.classList.add("error");
  statusEl.textContent = message;
}

async function run(planId: string): Promise<void> {
  const plan = await takeJobPlan(planId);
  if (!plan) throw new Error("Не найдены параметры загрузки. Вернитесь в popup и запустите её снова.");

  titleEl.textContent = plan.meta.title;
  const source = await getSource(plan.sourceKey);
  const format = getFormat(plan.format);
  const exporter = await getExporter(plan.format);
  setStatus("Подготавливаю загрузку…");
  barEl.hidden = false;

  let appendFile: File | undefined;
  let chapters = plan.chapters;
  if (plan.appendFileId) {
    if (!format.supportsAppend || !exporter.inspectExisting || !exporter.append) {
      throw new Error(`Формат ${format.key.toUpperCase()} не поддерживает докачку.`);
    }
    appendFile = await takeAppendFile(plan.appendFileId);
    const existingIds = await exporter.inspectExisting(appendFile, plan.meta.title);
    chapters = chaptersToAppend(plan.chapters, existingIds);
    if (chapters.length === 0) {
      barEl.max = plan.chapters.length;
      barEl.value = plan.chapters.length;
      setStatus("Все выбранные главы уже есть в EPUB. Новый файл не требуется.");
      return;
    }
  }

  const bookChapters: BookChapter[] = [];
  let failure: Error | null = null;

  for (let i = 0; i < chapters.length; i++) {
    const chapterRef = chapters[i]!;
    setStatus(`Скачиваю главы: ${i + 1}/${chapters.length}`, i, chapters.length);

    try {
      const content = await source.fetchChapter(chapterRef, plan.token);
      bookChapters.push({ id: chapterRef.id, title: chapterRef.title, chunks: content.chunks });
    } catch (err) {
      failure = err instanceof Error ? err : new Error(String(err));
      console.error(`[parserlib] глава ${chapterRef.id} не скачана`, failure);
      break;
    }
  }

  if (failure && bookChapters.length === 0) {
    throw new Error(
      appendFile
        ? `Первая новая глава не скачалась, исходный EPUB не изменён. Причина: ${failure.message}`
        : `Первая глава не скачалась, сохранять нечего. Причина: ${failure.message}`
    );
  }

  const downloaded = bookChapters.length;
  setStatus(
    failure
      ? `Скачано глав: ${downloaded} из ${chapters.length}. Собираю файл…`
      : "Собираю файл…",
    downloaded,
    chapters.length
  );

  let coverImage: { data: Uint8Array; mime: string } | undefined;
  if (!appendFile && plan.meta.coverUrl) {
    try {
      const res = await fetch(plan.meta.coverUrl);
      if (res.ok) {
        coverImage = {
          data: new Uint8Array(await res.arrayBuffer()),
          mime: res.headers.get("content-type") ?? "image/jpeg",
        };
      } else {
        console.warn(`[parserlib] обложка не скачалась: HTTP ${res.status}`);
      }
    } catch (err) {
      console.warn("[parserlib] обложка не скачалась", err);
    }
  }

  const book: Book = {
    title: plan.meta.title,
    author: plan.meta.author,
    coverImage,
    chapters: bookChapters,
  };
  const blob = appendFile ? await exporter.append!(book, appendFile) : await exporter.export(book);

  const objectUrl = URL.createObjectURL(blob);
  try {
    await ext.downloads.download({
      url: objectUrl,
      filename: `${sanitizeFilename(plan.meta.title)}.${exporter.extension}`,
      saveAs: false,
      conflictAction: "uniquify",
    });
  } finally {
    URL.revokeObjectURL(objectUrl);
  }

  barEl.max = chapters.length;
  barEl.value = downloaded;

  if (failure) {
    showError(
      appendFile
        ? `Случилась ошибка. Файл сохранён с ${downloaded} новыми главами из ${chapters.length}. ` +
          `На главе ${downloaded + 1} загрузка остановилась: ${failure.message}\n`
        : `Случилась ошибка. Файл сохранён с главами 1–${downloaded} из ${chapters.length}. ` +
          `На главе ${downloaded + 1} загрузка остановилась: ${failure.message}\n`
    );
    return;
  }

  setStatus("Готово, файл сохранён. Вкладку можно закрыть.", chapters.length, chapters.length);
}

const planId = new URLSearchParams(location.search).get("plan") ?? "";
run(planId).catch((err: unknown) => {
  showError(`Ошибка: ${err instanceof Error ? err.message : String(err)}`);
});
