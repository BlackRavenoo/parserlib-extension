import type { ChapterRef } from "../sources/types";

export interface ChapterVolume {
  id: string;
  count: number;
}

export function chapterVolumes(chapters: ChapterRef[]): ChapterVolume[] {
  const volumes = new Map<string, ChapterVolume>();
  for (const chapter of chapters) {
    const volume = volumes.get(chapter.volume);
    if (volume) volume.count++;
    else volumes.set(chapter.volume, { id: chapter.volume, count: 1 });
  }
  return [...volumes.values()];
}
