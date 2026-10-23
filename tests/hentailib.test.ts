import assert from "node:assert/strict";
import test from "node:test";
import hentailib from "../src/sources/hentailib";
import type { ChapterRef } from "../src/sources/types";

const titleUrl = "https://hentailib.me/ru/manga/2032--sun-ken-rock?section=chapters";
const slug = "2032--sun-ken-rock";
const apiBase = `https://hapi.hentaicdn.org/api/manga/${slug}`;
const chapter: ChapterRef = {
  id: 7,
  title: "Том 1, Глава 1.1 - Начало",
  key: "number=1.1&volume=1&branch_id=42",
  slug,
};

async function withFetch<T>(mock: typeof fetch, run: () => Promise<T>): Promise<T> {
  const original = globalThis.fetch;
  globalThis.fetch = mock;
  try {
    return await run();
  } finally {
    globalThis.fetch = original;
  }
}

function jsonResponse(data: unknown): Response {
  return new Response(JSON.stringify(data), { headers: { "content-type": "application/json" } });
}

test("HentaiLib recognizes its title URLs and requires authentication", async () => {
  assert.equal(hentailib.key, "hentailib");
  assert.equal(hentailib.kind, "manga");
  assert.equal(hentailib.requiresAuth, true);
  assert.equal(hentailib.titleSlug(titleUrl), slug);
  assert.equal(hentailib.titleSlug(`https://www.hentailib.me/ru/${slug}`), slug);
  assert.equal(hentailib.titleSlug(`https://mangalib.me/ru/manga/${slug}`), null);
  assert.equal(hentailib.titleSlug("https://hentailib.me/ru/manga/invalid"), null);

  let requests = 0;
  await withFetch(async () => {
    requests++;
    throw new Error("Unexpected request");
  }, async () => {
    await assert.rejects(hentailib.fetchTitle(titleUrl, null), /нужна авторизация/);
    await assert.rejects(hentailib.fetchChapters(titleUrl, null), /нужна авторизация/);
    await assert.rejects(hentailib.fetchChapter(chapter, null), /нужна авторизация/);
    await assert.rejects(hentailib.fetchTitle("https://hentailib.me/other", "token"), /slug тайтла/);
  });
  assert.equal(requests, 0);
});

test("HentaiLib request patch covers the API and image hosts", () => {
  const patch = hentailib.requestPatch!(titleUrl);
  assert.deepEqual(patch.requestDomains, ["hapi.hentaicdn.org", "cover.hentaicdn.org"]);
  assert.deepEqual(patch.headers, [
    { header: "referer", operation: "set", value: "https://hentailib.me/" },
    { header: "origin", operation: "set", value: "https://hentailib.me" },
    { header: "sec-fetch-site", operation: "set", value: "cross-site" },
  ]);
  assert.deepEqual(patch.additionalRules?.[0]?.requestDomains, ["img3h.hentaicdn.org"]);
  assert.deepEqual(patch.additionalRules?.[0]?.headers, [
    {
      header: "accept",
      operation: "set",
      value: "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
    },
    { header: "referer", operation: "set", value: "https://hentailib.me/" },
    { header: "sec-fetch-site", operation: "set", value: "cross-site" },
  ]);
});

test("HentaiLib fetches title and chapters from its API with site headers", async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  await withFetch(async (input, init) => {
    const url = String(input);
    calls.push({ url, init });
    if (url === `${apiBase}?fields[]=teams&fields[]=authors`) {
      return jsonResponse({
        data: {
          id: 2032,
          rus_name: "Скала Кен",
          name: "Sun Ken Rock",
          authors: [{ id: 1, rus_name: null, name: "Boichi" }],
          cover: { filename: "cover.jpg", default: "https://cover.hentaicdn.org/cover.jpg" },
        },
      });
    }
    if (url === `${apiBase}/chapters`) {
      return jsonResponse({
        data: [
          {
            id: 80844,
            index: 7,
            item_number: 1,
            volume: "1",
            number: "1.1",
            number_secondary: "1.1",
            name: "Начало",
            branch_id: 42,
          },
          {
            id: 80845,
            index: 8,
            item_number: 2,
            volume: "1",
            number: "2",
            number_secondary: "2",
            name: null,
            branch_id: null,
          },
        ],
      });
    }
    throw new Error(`Unexpected request: ${url}`);
  }, async () => {
    const result = await hentailib.fetchTitle(titleUrl, "secret-token");
    assert.deepEqual(result.meta, {
      id: "2032",
      title: "Скала Кен",
      author: "Boichi",
      coverUrl: "https://cover.hentaicdn.org/cover.jpg",
    });
    assert.deepEqual(result.chapters, [
      { id: 7, title: "Том 1, Глава 1.1 - Начало", key: "number=1.1&volume=1&branch_id=42", slug },
      { id: 8, title: "Том 1, Глава 2", key: "number=2&volume=1", slug },
    ]);
  });

  assert.deepEqual(calls.map(({ url }) => url).sort(), [
    `${apiBase}?fields[]=teams&fields[]=authors`,
    `${apiBase}/chapters`,
  ].sort());
  for (const { init } of calls) {
    const headers = init?.headers as Record<string, string>;
    assert.equal(headers["Site-Id"], "4");
    assert.equal(headers["X-DL-Service"], "hentailib");
    assert.equal(headers.Authorization, "Bearer secret-token");
  }
});

test("HentaiLib downloads images in page order without sending the API token", async () => {
  const imageRequests: Array<{ url: string; init?: RequestInit }> = [];
  const images = new Map([
    ["https://img3h.hentaicdn.org//manga/sun-ken-rock/second.png", { byte: 2, mime: "image/png" }],
    ["https://img3h.hentaicdn.org/manga/sun-ken-rock/first.jpg", { byte: 1, mime: "image/jpeg" }],
    ["https://other.example/third.webp", { byte: 3, mime: "image/webp" }],
  ]);

  await withFetch(async (input, init) => {
    const url = String(input);
    if (url === `${apiBase}/chapter?${chapter.key}`) {
      return jsonResponse({
        data: {
          id: 80844,
          pages: [
            { id: 20, url: "//manga/sun-ken-rock/second.png" },
            { id: 10, url: "manga/sun-ken-rock/first.jpg" },
            { id: 30, url: "https://other.example/third.webp" },
          ],
        },
      });
    }
    imageRequests.push({ url, init });
    const image = images.get(url);
    if (!image) throw new Error(`Unexpected image: ${url}`);
    return new Response(Uint8Array.of(image.byte).buffer, {
      headers: { "content-type": image.mime },
    });
  }, async () => {
    const result = await hentailib.fetchChapter(chapter, "secret-token");
    assert.deepEqual(result.chunks, [
      { kind: "image", data: Uint8Array.of(1), mime: "image/jpeg" },
      { kind: "image", data: Uint8Array.of(2), mime: "image/png" },
      { kind: "image", data: Uint8Array.of(3), mime: "image/webp" },
    ]);
  });

  assert.deepEqual(imageRequests.map(({ url }) => url), [...images.keys()]);
  for (const { init } of imageRequests) {
    assert.deepEqual(init?.headers, {});
    assert.equal(init?.credentials, "include");
  }
});

test("HentaiLib rejects empty and incomplete chapters", async () => {
  await withFetch(async (input) => {
    if (String(input) === `${apiBase}/chapter?${chapter.key}`) {
      return jsonResponse({ data: { id: 80844, pages: [] } });
    }
    throw new Error(`Unexpected request: ${input}`);
  }, async () => {
    await assert.rejects(hentailib.fetchChapter(chapter, "token"), /не содержит ни одной страницы/);
  });

  await withFetch(async (input) => {
    if (String(input) === `${apiBase}/chapter?${chapter.key}`) {
      return jsonResponse({ data: { id: 80844, pages: [{ id: 1, url: "/missing.jpg" }] } });
    }
    return new Response("missing", { status: 404 });
  }, async () => {
    await assert.rejects(hentailib.fetchChapter(chapter, "token"), /статусом 404/);
  });
});
