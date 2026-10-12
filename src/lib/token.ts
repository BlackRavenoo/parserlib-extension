import { ext } from "./browser";

export async function readFromTab(tabId: number, fn: () => string | null): Promise<string | null> {
  try {
    const results = await ext.scripting.executeScript({
      target: { tabId },
      func: fn,
    });
    for (const r of results) {
      if (typeof r.result === "string" && r.result.length > 0) return r.result;
    }
    return null;
  } catch {
    return null;
  }
}
