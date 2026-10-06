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
  let sanitized = name.replace(/[<>:"/\\|?*\x00-\x1f]/g, replacement);

  sanitized = sanitized.replace(/[. ]+$/, "");
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i.test(sanitized)) {
    sanitized = replacement + sanitized;
  }

  return sanitized || replacement;
}

const XML_ILLEGAL = /[\x00-\x08\x0b\x0c\x0e-\x1f\ud800-\udfff￾￿]/g;

export function escapeXml(s: string): string {
  return s
    .replace(XML_ILLEGAL, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
