import type { Source } from "./types";

type SourceLoader = () => Promise<{ default: Source }>;

const loaders: Record<string, SourceLoader> = {
  mangalib: () => import("./mangalib"),
  ranobelib: () => import("./ranobelib"),
  // To add a new source:
  //   1. create ./<key>.ts implementing Source;
  //   2. add an entry to loaders and to hostToKey below;
  //   3. add a token-capturing content script to manifest.json.
};

const hostToKey: Record<string, string> = {
  "mangalib.me": "mangalib",
  "mangalib.org": "mangalib",
  "ranobelib.me": "ranobelib",
};

export function resolveKeyByUrl(url: string): string | null {
  const host = new URL(url).hostname.replace(/^www\./, "");
  for (const [suffix, key] of Object.entries(hostToKey)) {
    if (host === suffix || host.endsWith("." + suffix)) return key;
  }
  return null;
}

const cache = new Map<string, Source>();

export async function getSource(key: string): Promise<Source> {
  const cached = cache.get(key);
  if (cached) return cached;

  const loader = loaders[key];
  if (!loader) throw new Error(`Неизвестный источник: ${key}`);

  const mod = await loader();
  cache.set(key, mod.default);
  return mod.default;
}

export async function getSourceByUrl(url: string): Promise<Source | null> {
  const key = resolveKeyByUrl(url);
  if (!key) return null;
  return getSource(key);
}

export function listSourceKeys(): string[] {
  return Object.keys(loaders);
}
