import { ext } from "../lib/browser";
import { takeJobPlan } from "../lib/job-plan";
import { takeAppendFile } from "../lib/append-file";
import { chaptersToAppend } from "../lib/append-plan";
import { getSource } from "../sources/registry";
import { getExporter, getFormat } from "../export/registry";
import type { Book, BookChapter, ExportPageMetrics } from "../export/types";
import { sanitizeFilename } from "../export/helpers";

export interface JobMetrics {
  imageBytes: number;
  originalFileBytes?: number;
  assembly?: {
    startedAt: number;
    finishedAt: number;
    durationMs: number;
    outputBytes?: number;
    pageMetrics?: ExportPageMetrics;
  };
}

export interface JobView {
  status: Pick<HTMLDivElement, "textContent"> & { classList: Pick<DOMTokenList, "add"> };
  title: Pick<HTMLHeadingElement, "textContent">;
  progress: Pick<HTMLProgressElement, "max" | "value" | "hidden">;
  showMetrics(metrics: JobMetrics): void;
}

export async function runJob(planId: string, view: JobView): Promise<void> {
  const { status: statusEl, title: titleEl, progress: barEl } = view;

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

  const plan = await takeJobPlan(planId);
  if (!plan) throw new Error("Не найдены параметры загрузки. Вернитесь в popup и запустите её снова.");
  const showMetrics = plan.showMetrics === true;
  if (plan.branchId !== undefined && plan.chapters.some((chapter) => {
    const requestedBranch = new URLSearchParams(chapter.key).get("branch_id");
    return (chapter.branchId ?? null) !== plan.branchId ||
      requestedBranch !== (plan.branchId === null ? null : String(plan.branchId));
  })) {
    throw new Error("План содержит главы другой ветки перевода. Запустите загрузку заново.");
  }

  titleEl.textContent = plan.meta.title;
  const source = await getSource(plan.sourceKey);
  const format = getFormat(plan.format);
  const exporter = await getExporter(plan.format);
  setStatus("Подготавливаю загрузку…");
  barEl.hidden = false;

  let appendFile: File | undefined;
  const identity = plan.branchId === undefined ? undefined : {
    sourceKey: plan.sourceKey,
    titleId: plan.meta.id,
    branchId: plan.branchId,
  };
  let chapters = plan.chapters;
  if (plan.appendFileId) {
    if (!format.supportsAppend || !exporter.inspectExisting || !exporter.append) {
      throw new Error(`Формат ${format.key.toUpperCase()} не поддерживает докачку.`);
    }
    appendFile = await takeAppendFile(plan.appendFileId);
    const existingIds = await exporter.inspectExisting(appendFile, plan.meta.title, identity);
    chapters = chaptersToAppend(plan.chapters, existingIds);
    if (chapters.length === 0) {
      barEl.max = plan.chapters.length;
      barEl.value = plan.chapters.length;
      setStatus("Все выбранные главы уже есть в файле. Новый файл не требуется.");
      return;
    }
  }

  const bookChapters: BookChapter[] = [];
  let imageBytes = 0;
  let failure: Error | null = null;

  for (let i = 0; i < chapters.length; i++) {
    const chapterRef = chapters[i]!;
    setStatus(`Скачиваю главы: ${i + 1}/${chapters.length}`, i, chapters.length);

    try {
      const content = await source.fetchChapter(chapterRef, plan.token);
      bookChapters.push({ id: chapterRef.id, title: chapterRef.title, chunks: content.chunks });
      if (showMetrics) {
        for (const chunk of content.chunks) {
          if (chunk.kind === "image") imageBytes += chunk.data.byteLength;
        }
      }
    } catch (err) {
      failure = err instanceof Error ? err : new Error(String(err));
      console.error(`[parserlib] глава ${chapterRef.id} не скачана`, failure);
      break;
    }
    if (showMetrics) view.showMetrics({ imageBytes, originalFileBytes: appendFile?.size });
  }

  if (failure && bookChapters.length === 0) {
    throw new Error(
      appendFile
        ? `Первая новая глава не скачалась, исходный файл не изменён. Причина: ${failure.message}`
        : `Первая глава не скачалась, сохранять нечего. Причина: ${failure.message}`
    );
  }

  const downloaded = bookChapters.length;

  let coverImage: { data: Uint8Array; mime: string } | undefined;
  if (!appendFile && plan.meta.coverUrl) {
    setStatus("Скачиваю обложку…", downloaded, chapters.length);
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
    ...(identity && { identity }),
  };
  imageBytes += coverImage?.data.byteLength ?? 0;
  const metrics = { imageBytes, originalFileBytes: appendFile?.size };
  if (showMetrics) view.showMetrics(metrics);
  setStatus(
    failure ? `Скачано глав: ${downloaded} из ${chapters.length}. Собираю файл…` : "Собираю файл…",
    downloaded,
    chapters.length
  );

  let blob: Blob | undefined;
  let pageMetrics: ExportPageMetrics | undefined;
  const reportPages = (value: ExportPageMetrics) => { pageMetrics = value; };
  const started = showMetrics ? performance.now() : undefined;
  try {
    blob = appendFile ? await exporter.append!(book, appendFile) : await exporter.export(book, showMetrics ? reportPages : undefined);
  } finally {
    if (started !== undefined) {
      const finished = performance.now();
      view.showMetrics({
        ...metrics,
        assembly: {
          startedAt: performance.timeOrigin + started,
          finishedAt: performance.timeOrigin + finished,
          durationMs: finished - started,
          outputBytes: blob?.size,
          ...(pageMetrics && { pageMetrics }),
        },
      });
    }
  }

  setStatus("Сохраняю файл…", downloaded, chapters.length);
  const objectUrl = URL.createObjectURL(blob);
  try {
    const downloadId = await ext.downloads.download({
      url: objectUrl,
      filename: `${sanitizeFilename(plan.meta.title)}.${exporter.extension}`,
      saveAs: false,
      conflictAction: "uniquify",
    });
    await ext.downloads.waitForCompletion(downloadId);
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
