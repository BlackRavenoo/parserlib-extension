import { HttpClient } from "../lib/http";
import type { HttpClientConfig } from "../lib/http";

const API_URL = "https://api.cdnlibs.org/api/manga";

export const IMAGE_HOSTS = ["https://img2.mixlib.me", "https://img3.cdnlibs.org"];

const CDNLIBS_LIMITS: HttpClientConfig = {
  anonymous: {
    requestsPerMinute: 90,
    rateLimitRetries: 2,
    rateLimitRetryDelaySeconds: 5,
  },
  authenticated: {
    requestsPerMinute: 125,
    rateLimitRetries: 8,
    rateLimitRetryDelaySeconds: 5,
  },
  serverRetries: 3,
  serverRetryDelaySeconds: 1,
};

const sharedHttp = new HttpClient(CDNLIBS_LIMITS);

export interface SiteHeaders {
  siteId: string;
  service: string;
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

export interface AuthorRow {
  id: number;
  name: string;
  rus_name: string | null;
}

export interface MangaRow {
  id: number;
  name: string;
  rus_name: string;
  authors?: AuthorRow[];
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

export interface Attachment {
  name: string;
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
  attachments?: Attachment[];
}

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function excerpt(value: unknown): string {
  const text = typeof value === "string" ? value : JSON.stringify(value) ?? String(value);
  return text.length > 200 ? `${text.slice(0, 200)}…` : text;
}

function apiError(what: string, slug: string, raw: unknown): Error {
  return new Error(
    `${what} для «${slug}»: ответ API не содержит ожидаемых данных. Ответ: ${excerpt(raw)}`
  );
}

export class CdnlibsApi {
  setAuth(token: string | null): void {
    sharedHttp.setAuth(token);
  }

  private async getJson(url: string, site: SiteHeaders): Promise<any> {
    return JSON.parse(
      new TextDecoder().decode(await sharedHttp.requestBytes(url, buildHeaders(site)))
    );
  }

  async getManga(site: SiteHeaders, slug: string): Promise<MangaRow> {
    const raw = await this.getJson(`${API_URL}/${slug}?fields[]=teams&fields[]=authors`, site);
    if (!raw?.data || typeof raw.data !== "object") {
      throw apiError("Не удалось получить описание работы", slug, raw);
    }
    return raw.data as MangaRow;
  }

  async getChapters(site: SiteHeaders, slug: string): Promise<ChapterRow[]> {
    const raw = await this.getJson(`${API_URL}/${slug}/chapters`, site);
    if (!Array.isArray(raw?.data)) {
      throw apiError("Не удалось получить список глав", slug, raw);
    }
    return raw.data as ChapterRow[];
  }

  async getChapterData(site: SiteHeaders, slug: string, key: string): Promise<ChapterDataRow> {
    const raw = await this.getJson(`${API_URL}/${slug}/chapter?${key}`, site);
    if (!raw?.data || typeof raw.data !== "object") {
      throw apiError("Не удалось получить содержимое главы", slug, raw);
    }
    return raw.data as ChapterDataRow;
  }

  async getImageByPath(site: SiteHeaders, path: string): Promise<{ data: Uint8Array; mime: string }> {
    const cleanPath = path.replace(/^\/+/, "/");
    let lastError: unknown;

    for (const host of IMAGE_HOSTS) {
      try {
        return await sharedHttp.requestBinary(`${host}${cleanPath}`, buildHeaders(site));
      } catch (err) {
        lastError = err;
        continue;
      }
    }

    throw lastError instanceof Error
      ? lastError
      : new Error("Не удалось скачать картинку: не настроено ни одного хоста");
  }

  async getImageByUrl(site: SiteHeaders, url: string): Promise<{ data: Uint8Array; mime: string }> {
    return sharedHttp.requestBinary(url, buildHeaders(site));
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
