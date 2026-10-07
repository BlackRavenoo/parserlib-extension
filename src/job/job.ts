import { ext } from "../lib/browser";
import { patchApiHeaders } from "../lib/headers";
import { takeToken } from "../lib/token";
import { getSourceByUrl } from "../sources/registry";
import { getExporter } from "../export/registry";
import type { Book, BookChapter } from "../export/types";
import { sanitizeFilename } from "../export/types";

const statusEl = document.getElementById("status") as HTMLDivElement;
const titleEl = document.getElementById("title") as HTMLHeadingElement;
const barEl = document.getElementById("bar") as HTMLProgressElement;

function setStatus(text: string, done?: number, total?: number) {
  statusEl.textContent = text;
  if (done !== undefined && total) {
    barEl.max = total;
    barEl.value = done;
  }
}

function showError(message: string) {
  statusEl.classList.add("error");
  statusEl.textContent = message;
}

async function run(url: string, format: string): Promise<void> {
  const source = await getSourceByUrl(url);
  if (!source) throw new Error("Не найден источник для этой ссылки");

  const headersOk = await patchApiHeaders(source);
  if (!headersOk) {
    throw new Error(
      "Не удалось настроить заголовки запроса. " +
        "Загрузка невозможна. Перезагрузите расширение и попробуйте снова."
    );
  }

  const token = await takeToken(source.key);

  setStatus(
    token
      ? "Авторизованная загрузка. Получаю список глав…"
      : "Анонимная загрузка. Получаю список глав…"
  );

  const { meta, chapters } = await source.fetchTitle(url, token);
  titleEl.textContent = meta.title;

  const ordered = [...chapters].sort((a, b) => a.id - b.id);
  if (ordered.length === 0) {
    throw new Error("У этой работы нет ни одной главы — скачивать нечего.");
  }

  const bookChapters: BookChapter[] = [];
  let failure: Error | null = null;

  for (let i = 0; i < ordered.length; i++) {
    const chapterRef = ordered[i]!;
    setStatus(`Скачиваю главы: ${i + 1}/${ordered.length}`, i, ordered.length);

    try {
      const content = await source.fetchChapter(chapterRef, token);
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
      ? `Скачано глав: ${downloaded} из ${ordered.length}. Собираю файл…`
      : "Собираю файл…",
    downloaded,
    ordered.length
  );

  let coverImage: { data: Uint8Array; mime: string } | undefined;
  if (meta.coverUrl) {
    try {
      const res = await fetch(meta.coverUrl);
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

  const book: Book = { title: meta.title, author: meta.author, coverImage, chapters: bookChapters };
  const exporter = await getExporter(format);
  const blob = await exporter.export(book);

  const objectUrl = URL.createObjectURL(blob);
  try {
    await ext.downloads.download({
      url: objectUrl,
      filename: `${sanitizeFilename(meta.title)}.${exporter.extension}`,
      saveAs: false,
    });
  } finally {
    URL.revokeObjectURL(objectUrl);
  }

  barEl.max = ordered.length;
  barEl.value = downloaded;

  if (failure) {
    showError(
      `Случилась ошибка. Файл сохранён с главами 1–${downloaded} из ${ordered.length}. ` +
        `На главе ${downloaded + 1} загрузка остановилась: ${failure.message}\n`
    );
    return;
  }

  setStatus("Готово, файл сохранён. Вкладку можно закрыть.", ordered.length, ordered.length);
}

const params = new URLSearchParams(location.search);
const url = params.get("url") ?? "";
const format = params.get("format") ?? "fb2";

run(url, format).catch((err: unknown) => {
  showError(`Ошибка: ${err instanceof Error ? err.message : String(err)}`);
});