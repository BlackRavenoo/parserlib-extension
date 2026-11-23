import { spawn } from "node:child_process";
import { once } from "node:events";
import { open } from "node:fs/promises";
import { createInterface } from "node:readline/promises";
import { text } from "node:stream/consumers";
import { setTimeout as delay } from "node:timers/promises";

const SAMPLE_INTERVAL_MS = 200;

const processId = Number(process.argv[2]);
if (process.platform !== "win32" && process.platform !== "linux") {
  console.error("Замер памяти поддерживается на Windows и Linux.");
  process.exit(1);
}
if (!Number.isInteger(processId) || processId < 1 || processId > 2 ** 31 - 1) {
  console.error("Запустите npm run profile:firefox -- PID, где PID указан в about:processes.");
  process.exit(1);
}

async function collectWindows(record, signal) {
  const collector = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", `
    $ErrorActionPreference = 'Stop'
    $target = [Diagnostics.Process]::GetProcessById(${processId})
    if ($target.ProcessName -ne 'firefox') { exit 2 }
    do {
      $target.Refresh()
      [Console]::WriteLine('{0} {1}', [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds(), $target.WorkingSet64)
    } until ($target.WaitForExit(${SAMPLE_INTERVAL_MS}))
  `], { windowsHide: true, stdio: ["ignore", "pipe", "ignore"] });
  const rows = createInterface({ input: collector.stdout });
  rows.on("line", (line) => record(...line.trim().split(" ").map(Number)));
  const abort = () => collector.kill();
  signal.addEventListener("abort", abort, { once: true });
  try {
    await once(collector, "close");
  } finally {
    rows.close();
    signal.removeEventListener("abort", abort);
  }
}

async function collectLinux(record, signal) {
  const status = await open(`/proc/${processId}/status`);
  try {
    while (!signal.aborted) {
      const content = await text(status.createReadStream({ start: 0, autoClose: false }));
      const rss = Number(/^VmRSS:[ \t]+(\d+)[ \t]+kB$/m.exec(content)?.[1]) * 1024;
      if (!Number.isSafeInteger(rss) || rss <= 0) {
        throw new Error("В /proc не найден рабочий набор процесса.");
      }
      record(Date.now(), rss);
      await delay(SAMPLE_INTERVAL_MS, undefined, { signal });
    }
  } finally {
    await status.close();
  }
}

const samples = [];
const firstSample = Promise.withResolvers();
const stopped = Promise.withResolvers();
const controller = new AbortController();
function record(time, bytes) {
  if (Number.isSafeInteger(time) && Number.isSafeInteger(bytes) && bytes > 0) {
    samples.push({ time, bytes });
    firstSample.resolve(true);
  }
}

const collect = process.platform === "linux" ? collectLinux : collectWindows;
let collectionError;
const collection = collect(record, controller.signal).catch((error) => {
  collectionError = error;
}).finally(() => stopped.resolve(false));

const terminal = createInterface({ input: process.stdin, output: process.stdout });
terminal.on("SIGINT", () => stopped.resolve(false));
terminal.once("close", () => stopped.resolve(false));
const number = new Intl.NumberFormat("ru", { maximumFractionDigits: 1 });
const format = (bytes) => `${number.format(bytes / 1024 ** 2)} МиБ`;

try {
  if (!await Promise.race([firstSample.promise, stopped.promise])) {
    throw new Error("Не удалось начать замеры. Проверьте PID процесса Firefox.");
  }
  console.log(`Замеряю рабочий набор процесса Firefox PID ${processId} каждые ${SAMPLE_INTERVAL_MS} мс.`);
  const interval = await Promise.race([
    terminal.question("После экспорта вставьте строку с двумя UTC-метками из вкладки загрузки: "),
    stopped.promise,
  ]);
  if (interval === false) throw new Error("Сбор замеров остановлен.");

  const timestamps = interval.trim().split(/\s+/);
  const [start, end] = timestamps.map((value) => Date.parse(value));
  if (timestamps.length !== 2 || timestamps.some((value) => !value.endsWith("Z")) ||
    !Number.isFinite(start) || !Number.isFinite(end) || end < start) {
    throw new Error("Ожидаются две UTC-метки со вкладки загрузки.");
  }

  const before = samples.findLast(({ time }) => time <= start);
  const during = samples.filter(({ time }) => time >= start && time <= end);
  if (!before || during.length === 0) {
    throw new Error("Для этого интервала нет замеров до или во время экспорта. Короткий экспорт может пройти между двумя замерами.");
  }
  const peak = during.reduce((max, { bytes }) => Math.max(max, bytes), 0);
  console.log(`Перед экспортом — ${format(before.bytes)}`);
  console.log(`Максимум от начала до конца экспорта — ${format(peak)}`);
  console.log(`Последний замер при экспорте — ${format(during.at(-1).bytes)}`);
  console.log(`Разница между пиком и началом — ${format(peak - before.bytes)} · замеров во время экспорта — ${during.length}`);
} catch (error) {
  console.error(error.message);
  if (collectionError && collectionError.name !== "AbortError") console.error(collectionError.message);
  process.exitCode = 1;
} finally {
  terminal.close();
  controller.abort();
  await collection;
}
