import type { Exporter } from "./types";

type ExporterLoader = () => Promise<{ default: Exporter }>;

const loaders: Record<string, ExporterLoader> = {
  fb2: () => import("./fb2"),
  epub: () => import("./epub"),
};

export async function getExporter(format: string): Promise<Exporter> {
  const loader = loaders[format];
  if (!loader) throw new Error(`Неизвестный формат экспорта: ${format}`);
  const mod = await loader();
  return mod.default;
}

export function listFormats(): string[] {
  return Object.keys(loaders);
}
