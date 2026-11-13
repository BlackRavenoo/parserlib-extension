import type { ChapterRef } from "../sources/types";

export interface TranslationBranch {
  id: number | null;
  name: string;
  chapters: ChapterRef[];
}

export function translationBranches(chapters: ChapterRef[]): TranslationBranch[] {
  const branches = new Map<number | null, TranslationBranch>();
  for (const chapter of chapters) {
    const id = chapter.branchId ?? null;
    let branch = branches.get(id);
    if (!branch) {
      branch = { id, name: id === null ? "Основной перевод" : `Ветка ${id}`, chapters: [] };
      branches.set(id, branch);
    }
    if (chapter.branchName) branch.name = chapter.branchName;
    branch.chapters.push(chapter);
  }
  const result = [...branches.values()];
  const names = result.map((branch) => branch.name);
  for (const branch of result) {
    branch.chapters.sort((a, b) => a.id - b.id);
    if (names.filter((name) => name === branch.name).length > 1) {
      branch.name += branch.id === null ? " (основной перевод)" : ` (ветка ${branch.id})`;
    }
  }
  return result;
}
