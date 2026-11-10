import { runJob } from "./run";

const statusEl = document.getElementById("status") as HTMLDivElement;
const titleEl = document.getElementById("title") as HTMLHeadingElement;
const barEl = document.getElementById("bar") as HTMLProgressElement;

const planId = new URLSearchParams(location.search).get("plan") ?? "";
runJob(planId, { status: statusEl, title: titleEl, progress: barEl }).catch((err: unknown) => {
  statusEl.classList.add("error");
  statusEl.textContent = `Ошибка: ${err instanceof Error ? err.message : String(err)}`;
});
