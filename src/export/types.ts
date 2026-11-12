import type { DataChunk } from "../core/models";
import type { BookIdentity } from "../core/models";

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

export interface Exporter {
  readonly extension: "fb2" | "epub" | "pdf";
  export(book: Book): Promise<Blob>;
  inspectExisting?(file: Blob, title: string, identity?: BookIdentity): Promise<Set<number>>;
  append?(book: Book, file: Blob): Promise<Blob>;
}

export function isBookIdentity(value: unknown): value is BookIdentity {
  if (!value || typeof value !== "object") return false;
  const identity = value as Partial<BookIdentity>;
  return typeof identity.sourceKey === "string" && identity.sourceKey.length > 0 &&
    typeof identity.titleId === "string" && identity.titleId.length > 0 &&
    (identity.branchId === null || (typeof identity.branchId === "number" && Number.isSafeInteger(identity.branchId) && identity.branchId > 0));
}

export function sanitizeFilename(name: string, replacement = "_"): string {
  let sanitized = name.replace(/[<>:"/\\|?*\x00-\x1f]/g, replacement);

  sanitized = sanitized.replace(/[. ]+$/, "");
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i.test(sanitized)) {
    sanitized = replacement + sanitized;
  }

  return sanitized || replacement;
}

const XML_ILLEGAL = /[\x00-\x08\x0b\x0c\x0e-\x1f\ud800-\udfff￾￿]/gu;

export function escapeXml(s: string): string {
  return s
    .replace(XML_ILLEGAL, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
