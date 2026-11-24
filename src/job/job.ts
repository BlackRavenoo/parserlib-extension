import { runJob } from "./run";
import type { JobMetrics } from "./run";

const statusEl = document.getElementById("status") as HTMLDivElement;
const titleEl = document.getElementById("title") as HTMLHeadingElement;
const barEl = document.getElementById("bar") as HTMLProgressElement;
const metricsEl = document.getElementById("metrics") as HTMLParagraphElement;
const formatNumber = new Intl.NumberFormat("ru", { maximumFractionDigits: 3 });

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} Б`;
  if (bytes < 1024 ** 2) return `${formatNumber.format(bytes / 1024)} КиБ`;
  if (bytes < 1024 ** 3) return `${formatNumber.format(bytes / 1024 ** 2)} МиБ`;
  return `${formatNumber.format(bytes / 1024 ** 3)} ГиБ`;
}

function showMetrics({ imageBytes, originalFileBytes, assembly }: JobMetrics): void {
  const lines = [`Данные изображений — ${formatBytes(imageBytes)}`];
  if (originalFileBytes !== undefined) lines.push(`Исходный файл — ${formatBytes(originalFileBytes)}`);
  if (assembly) {
    const duration = assembly.durationMs < 1 ? "< 1 мс"
      : assembly.durationMs < 1000 ? `${formatNumber.format(assembly.durationMs)} мс`
      : `${formatNumber.format(assembly.durationMs / 1000)} с`;
    lines.push(`Время экспорта — ${duration}`);
    if (assembly.outputBytes !== undefined) lines.push(`Размер результата — ${formatBytes(assembly.outputBytes)}`);
    if (assembly.pageMetrics) {
      const { totalPages, pagesWithoutCanvas } = assembly.pageMetrics;
      lines.push(`Страниц PDF без canvas — ${pagesWithoutCanvas} из ${totalPages}`);
    }
    lines.push(
      "Интервал экспорта (UTC)",
      `${new Date(assembly.startedAt).toISOString()} ${new Date(assembly.finishedAt).toISOString()}`
    );
  }
  metricsEl.textContent = lines.join("\n");
  metricsEl.hidden = false;
}

const planId = new URLSearchParams(location.search).get("plan") ?? "";
runJob(planId, { status: statusEl, title: titleEl, progress: barEl, showMetrics }).catch((err: unknown) => {
  statusEl.classList.add("error");
  statusEl.textContent = `Ошибка: ${err instanceof Error ? err.message : String(err)}`;
});
