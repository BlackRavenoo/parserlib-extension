import type { DataChunk } from "../core/models";

export interface BookChapter {
  id: number;
  title: string;
  chunks: DataChunk[];
}

export interface Book {
  title: string;
  author?: string;
  coverImage?: { data: Uint8Array; mime: string };
  chapters: BookChapter[];
}

export interface Exporter {
  readonly extension: "fb2" | "epub" | "pdf";
  export(book: Book): Promise<Blob>;
}

export function sanitizeFilename(name: string, replacement = "_"): string {
  const sanitized = name.replace(/[<>:"/\\|?*\x00-\x1f]/g, replacement);
  return sanitized || replacement;
}
