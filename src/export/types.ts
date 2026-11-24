import type { BookIdentity, DataChunk } from "../core/models";

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
  identity?: BookIdentity;
}

export interface ExportPageMetrics {
  totalPages: number;
  pagesWithoutCanvas: number;
}

export interface Exporter {
  readonly extension: "fb2" | "epub" | "pdf";
  export(book: Book, reportPages?: (metrics: ExportPageMetrics) => void): Promise<Blob>;
  inspectExisting?(file: Blob, title: string, identity?: BookIdentity): Promise<Set<number>>;
  append?(book: Book, file: Blob): Promise<Blob>;
}
