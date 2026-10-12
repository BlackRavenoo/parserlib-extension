import { ext } from "../lib/browser";
import { takeJobPlan } from "../lib/job-plan";
import { getSource } from "../sources/registry";
import { getExporter } from "../export/registry";
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

  const source = await getSource(plan.sourceKey);
  titleEl.textContent = plan.meta.title;
  setStatus("Подготавливаю загрузку…");
  barEl.hidden = false;

  const bookChapters: BookChapter[] = [];
  let failure: Error | null = null;

  for (let i = 0; i < plan.chapters.length; i++) {
    const chapterRef = plan.chapters[i]!;
    setStatus(`Скачиваю главы: ${i + 1}/${plan.chapters.length}`, i, plan.chapters.length);

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
    throw new Error(`Первая глава не скачалась, сохранять нечего. Причина: ${failure.message}`);
  }

  const downloaded = bookChapters.length;
  setStatus(
    failure
      ? `Скачано глав: ${downloaded} из ${plan.chapters.length}. Собираю файл…`
      : "Собираю файл…",
    downloaded,
    plan.chapters.length
  );

  let coverImage: { data: Uint8Array; mime: string } | undefined;
  if (plan.meta.coverUrl) {
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
  const exporter = await getExporter(plan.format);
  const blob = await exporter.export(book);

  const objectUrl = URL.createObjectURL(blob);
  try {
    await ext.downloads.download({
      url: objectUrl,
      filename: `${sanitizeFilename(plan.meta.title)}.${exporter.extension}`,
      saveAs: false,
    });
  } finally {
    URL.revokeObjectURL(objectUrl);
  }

  barEl.max = plan.chapters.length;
  barEl.value = downloaded;

  if (failure) {
    showError(
      `Случилась ошибка. Файл сохранён с главами 1–${downloaded} из ${plan.chapters.length}. ` +
        `На главе ${downloaded + 1} загрузка остановилась: ${failure.message}\n`
    );
    return;
  }

  setStatus("Готово, файл сохранён. Вкладку можно закрыть.", plan.chapters.length, plan.chapters.length);
}

const planId = new URLSearchParams(location.search).get("plan") ?? "";
run(planId).catch((err: unknown) => {
  showError(`Ошибка: ${err instanceof Error ? err.message : String(err)}`);
});
