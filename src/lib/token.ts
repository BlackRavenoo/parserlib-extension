import { ext } from "./browser";

export async function readTokenFromTab(tabId: number): Promise<string | null> {
  try {
    const results = await ext.scripting.executeScript({
      target: { tabId },
      func: () => {
        const raw = localStorage.getItem("auth");
        if (!raw) return null;
        try {
          const session = JSON.parse(raw);
          const token = session?.token?.access_token;
          return typeof token === "string" && token.length > 0 ? token : null;
        } catch {
          return null;
        }
      },
    });
    for (const r of results) {
      if (typeof r.result === "string" && r.result.length > 0) return r.result;
    }
    return null;
  } catch {
    return null;
  }
}

const TOKEN_KEY_PREFIX = "token:";

export async function stashToken(sourceKey: string, token: string | null): Promise<void> {
  const key = `${TOKEN_KEY_PREFIX}${sourceKey}`;
  if (token) {
    await ext.storage.session.set({ [key]: token });
  } else {
    await ext.storage.session.remove(key);
  }
}

export async function takeToken(sourceKey: string): Promise<string | null> {
  const key = `${TOKEN_KEY_PREFIX}${sourceKey}`;
  const stored = await ext.storage.session.get([key]);
  const value = stored[key];
  await ext.storage.session.remove(key);
  return typeof value === "string" ? value : null;
}
