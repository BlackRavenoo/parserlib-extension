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

async function run(url: string, format: string): Promise<void> {
  const source = await getSourceByUrl(url);
  if (!source) throw new Error("Не найден источник для этой ссылки");

  const token = await takeToken(source.key);
  console.info(token ? "[parserlib] авторизованная загрузка" : "[parserlib] анонимная загрузка");

  setStatus("Получаю список глав…");
  const { meta, chapters } = await source.fetchTitle(url, token);
  titleEl.textContent = meta.title;

  const ordered = [...chapters].sort((a, b) => a.id - b.id);

  const bookChapters: BookChapter[] = [];

  for (let i = 0; i < ordered.length; i++) {
    const chapterRef = ordered[i]!;
    setStatus(`Скачиваю главы: ${i + 1}/${ordered.length}`, i, ordered.length);

    const content = await source.fetchChapter(chapterRef, token);

    bookChapters.push({ id: chapterRef.id, title: chapterRef.title, chunks: content.chunks });
  }

  setStatus("Собираю файл…", ordered.length, ordered.length);

  let coverImage: { data: Uint8Array; mime: string } | undefined;
  if (meta.coverUrl) {
    try {
      const res = await fetch(meta.coverUrl);
      if (res.ok) {
        coverImage = {
          data: new Uint8Array(await res.arrayBuffer()),
          mime: res.headers.get("content-type") ?? "image/jpeg",
        };
      }
    } catch {
      // ...
    }
  }

  const book: Book = { title: meta.title, author: meta.author, coverImage, chapters: bookChapters };
  const exporter = await getExporter(format);
  const blob = await exporter.export(book);

  const objectUrl = URL.createObjectURL(blob);
  await ext.downloads.download({
    url: objectUrl,
    filename: `${sanitizeFilename(meta.title)}.${exporter.extension}`,
    saveAs: false,
  });

  setStatus("Готово, файл сохранён. Вкладку можно закрыть.", ordered.length, ordered.length);
}

const params = new URLSearchParams(location.search);
const url = params.get("url") ?? "";
const format = params.get("format") ?? "fb2";

patchApiHeaders().finally(() => {
  run(url, format).catch((err: Error) => {
    setStatus(`Ошибка: ${err.message}`);
  });
});
