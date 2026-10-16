import type { Exporter } from "./types";

type ExporterLoader = () => Promise<{ default: Exporter }>;

export interface ExportFormat {
  key: string;
  extension: Exporter["extension"];
  supportsAppend: boolean;
}

type FormatRegistration = ExportFormat & { load: ExporterLoader };

const formats: Record<string, FormatRegistration> = {
  fb2: { key: "fb2", extension: "fb2", supportsAppend: false, load: () => import("./fb2") },
  epub: { key: "epub", extension: "epub", supportsAppend: true, load: () => import("./epub") },
  pdf: { key: "pdf", extension: "pdf", supportsAppend: false, load: () => import("./pdf") },
};

export async function getExporter(format: string): Promise<Exporter> {
  const registration = formats[format];
  if (!registration) throw new Error(`Неизвестный формат экспорта: ${format}`);
  const mod = await registration.load();
  return mod.default;
}

export function getFormat(format: string): ExportFormat {
  const registration = formats[format];
  if (!registration) throw new Error(`Неизвестный формат экспорта: ${format}`);
  const { key, extension, supportsAppend } = registration;
  return { key, extension, supportsAppend };
}

export function listFormats(): ExportFormat[] {
  return Object.keys(formats).map(getFormat);
}
