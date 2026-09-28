import { HttpClient } from "../lib/http";

export const API_URL = "https://api.cdnlibs.org/api/manga";

export const IMAGE_HOSTS = ["https://img2.mixlib.me", "https://img3.mixlib.me"];

export interface MangaRow {
  id: number;
  name: string;
  rus_name: string;
  cover?: { filename: string | null; default?: string; md?: string };
}

export interface ChapterRow {
  id: number;
  index: number;
  item_number: number;
  volume: string;
  number: string;
  number_secondary: string;
  name: string | null;
}

export interface PageRow {
  id: number;
  url: string;
}

export interface ChapterDataRow {
  id: number;
  volume: string;
  number: string;
  number_secondary: string;
  name: string | null;
  pages?: PageRow[];
  content?: unknown;
}

export interface SiteHeaders {
  siteId: string;
  service: string;
  origin: string;
}

export function buildHeaders(site: SiteHeaders): Record<string, string> {
  return {
    Accept: "*/*",
    "Accept-Language": "ru,en-US;q=0.9,en;q=0.8",
    "Site-Id": site.siteId,
    "X-DL-Service": site.service,
    "Content-Type": "application/json",
    "Client-Time-Zone": "Europe/Moscow",
  };
}

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

export class CdnlibsApi {
  readonly http: HttpClient;

  constructor(
    site: SiteHeaders,
    httpOptions: { retries?: number; retryDelaySeconds?: number } = {}
  ) {
    this.http = new HttpClient(buildHeaders(site), httpOptions);
  }

  setAuth(token: string | null): void {
    this.http.setAuth(token);
  }

  private async getJson(url: string): Promise<any> {
    return JSON.parse(new TextDecoder().decode(await this.http.requestBytes(url)));
  }

  async getManga(slug: string): Promise<MangaRow> {
    const raw = await this.getJson(`${API_URL}/${slug}?fields[]=teams`);
    return raw?.data;
  }

  async getChapters(slug: string): Promise<ChapterRow[]> {
    const raw = await this.getJson(`${API_URL}/${slug}/chapters`);
    return asArray(raw?.data) as ChapterRow[];
  }

  async getChapterData(slug: string, key: string): Promise<ChapterDataRow> {
    const raw = await this.getJson(`${API_URL}/${slug}/chapter?${key}`);
    return raw?.data ?? {};
  }

  async getImageByPath(path: string): Promise<{ data: Uint8Array; mime: string }> {
    const cleanPath = path.replace(/^\/+/, "/");
    let lastError: unknown;

    for (const host of IMAGE_HOSTS) {
      try {
        return await this.http.requestBinary(`${host}${cleanPath}`);
      } catch (err) {
        lastError = err;
        continue;
      }
    }

    throw lastError instanceof Error
      ? lastError
      : new Error("Не удалось скачать картинку: не настроено ни одного хоста");
  }

  async getImageByUrl(url: string): Promise<{ data: Uint8Array; mime: string }> {
    return this.http.requestBinary(url);
  }
}

export function chapterTitle(row: { volume: string; number: string; name: string | null }): string {
  const base = `Том ${asString(row.volume)}, Глава ${asString(row.number)}`;
  const name = asString(row.name);
  return name ? `${base} - ${name}` : base;
}

export function chapterKey(row: { volume: string; number: string }): string {
  return `number=${encodeURIComponent(asString(row.number))}&volume=${encodeURIComponent(
    asString(row.volume)
  )}`;
}
