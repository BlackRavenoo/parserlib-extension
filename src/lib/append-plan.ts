import type { ChapterRef } from "../sources/types";

export function chaptersToAppend(chapters: ChapterRef[], existingIds: Set<number>): ChapterRef[] {
  return chapters.filter((chapter) => !existingIds.has(chapter.id));
}
