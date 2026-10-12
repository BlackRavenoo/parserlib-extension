import { ext } from "./browser";
import type { ChapterRef, TitleMeta } from "../sources/types";

export interface PopupData {
  identity: string;
  meta: TitleMeta;
  chapters: ChapterRef[];
}

const CACHE_KEY_PREFIX = "popup-data:";

export async function tokenFingerprint(token: string | null): Promise<string> {
  const bytes = new TextEncoder().encode(token ?? "");
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function getPopupData(tabId: number): Promise<PopupData | null> {
  const key = `${CACHE_KEY_PREFIX}${tabId}`;
  const stored = await ext.storage.session.get([key]);
  const value = stored[key];
  if (!value || typeof value !== "object") return null;

  const data = value as Partial<PopupData>;
  if (
    typeof data.identity !== "string" ||
    !data.meta || typeof data.meta.title !== "string" ||
    !Array.isArray(data.chapters)
  ) return null;
  return data as PopupData;
}

export async function storePopupData(tabId: number, data: PopupData): Promise<void> {
  await ext.storage.session.set({ [`${CACHE_KEY_PREFIX}${tabId}`]: data });
}
