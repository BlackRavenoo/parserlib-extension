import type { DataChunk } from "../core/models";

export interface ChapterRef {
  id: number;
  title: string;
  key: string;
  slug: string;
}

export interface TitleMeta {
  id: string;
  title: string;
  author?: string;
  coverUrl?: string;
}

export interface ChapterContent {
  chunks: DataChunk[];
}

export interface Source {
  readonly key: string;
  readonly kind: "manga" | "novel";

  titleSlug(url: string): string | null;

  readonly titleInPage?: () => string | null;

  fetchTitle(url: string, token: string | null): Promise<{ meta: TitleMeta; chapters: ChapterRef[] }>;

  fetchChapter(chapter: ChapterRef, token: string | null): Promise<ChapterContent>;
}
