import assert from "node:assert/strict";
import test from "node:test";
import mangalib from "../src/sources/mangalib";
import type { ChapterRef } from "../src/sources/types";

const titleUrl = "https://mangalib.org/ru/manga/89959--yeokdagp-yeongji-sulgyesa?section=chapters";
const slug = "89959--yeokdagp-yeongji-sulgyesa";
const apiBase = `https://api.cdnlibs.org/api/manga/${slug}`;
const chapter: ChapterRef = {
  id: 7,
  title: "Том 1, Глава 1.5 - Начало",
  key: "number=1.5&volume=1&branch_id=42",
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

test("MangaLib recognizes title URLs and rejects invalid links before requesting", async () => {
  assert.equal(mangalib.key, "mangalib");
  assert.equal(mangalib.kind, "manga");
  assert.equal(mangalib.titleSlug(titleUrl), slug);
  assert.equal(mangalib.titleSlug(`https://mangalib.me/ru/${slug}`), slug);
  assert.equal(mangalib.titleSlug(`https://hentailib.me/ru/manga/${slug}`), null);
  assert.equal(mangalib.titleSlug("https://mangalib.org/ru/manga/invalid"), null);

  let requests = 0;
  await withFetch(async () => {
    requests++;
    throw new Error("Unexpected request");
  }, async () => {
    await assert.rejects(mangalib.fetchTitle("https://mangalib.org/other", null), /slug тайтла/);
    await assert.rejects(mangalib.fetchChapters("https://mangalib.org/other", null), /slug тайтла/);
  });
  assert.equal(requests, 0);
});

test("MangaLib request patch sets the page origin for API and cover requests", () => {
  const patch = mangalib.requestPatch!(titleUrl);
  assert.deepEqual(patch.requestDomains, ["api.cdnlibs.org", "cover.cdnlibs.org"]);
  assert.deepEqual(patch.headers, [
    { header: "referer", operation: "set", value: "https://mangalib.org/" },
    { header: "origin", operation: "set", value: "https://mangalib.org" },
    { header: "sec-fetch-site", operation: "set", value: "cross-site" },
  ]);
  assert.equal(patch.additionalRules, undefined);
});

test("MangaLib fetches metadata and chapters with site headers and branch keys", async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  await withFetch(async (input, init) => {
    const url = String(input);
    calls.push({ url, init });
    if (url === `${apiBase}?fields[]=teams&fields[]=authors`) {
      return jsonResponse({
        data: {
          id: 89959,
          rus_name: "Архитектор",
          name: "The Architect",
          authors: [{ id: 1, rus_name: "Автор", name: "Author" }],
          cover: { filename: "cover.jpg", md: "https://cover.cdnlibs.org/cover.jpg" },
        },
      });
    }
    if (url === `${apiBase}/chapters`) {
      return jsonResponse({
        data: [
          { id: 101, index: 7, item_number: 1, volume: "1", number: "1.5", number_secondary: "1.5", name: "Начало", branch_id: 42 },
          { id: 102, index: 8, item_number: 2, volume: "1", number: "2", number_secondary: "2", name: null, branch_id: null },
        ],
      });
    }
    throw new Error(`Unexpected request: ${url}`);
  }, async () => {
    const result = await mangalib.fetchTitle(titleUrl, "secret-token");
    assert.deepEqual(result.meta, {
      id: "89959",
      title: "Архитектор",
      author: "Автор",
      coverUrl: "https://cover.cdnlibs.org/cover.jpg",
    });
    assert.deepEqual(result.chapters, [
      chapter,
      { id: 8, title: "Том 1, Глава 2", key: "number=2&volume=1", slug },
    ]);
  });

  assert.deepEqual(calls.map(({ url }) => url).sort(), [
    `${apiBase}?fields[]=teams&fields[]=authors`,
    `${apiBase}/chapters`,
  ].sort());
  for (const { init } of calls) {
    const headers = init?.headers as Record<string, string>;
    assert.equal(headers["Site-Id"], "1");
    assert.equal(headers["X-DL-Service"], "mangalib");
    assert.equal(headers.Authorization, "Bearer secret-token");
  }
});

test("MangaLib can fetch chapter lists without an auth token", async () => {
  await withFetch(async (input, init) => {
    assert.equal(String(input), `${apiBase}/chapters`);
    const headers = init?.headers as Record<string, string>;
    assert.equal(headers["Site-Id"], "1");
    assert.equal(headers.Authorization, undefined);
    return jsonResponse({ data: [] });
  }, async () => {
    assert.deepEqual(await mangalib.fetchChapters(titleUrl, null), []);
  });
});

test("MangaLib downloads pages in ID order and tries the second CDN after a 404", async () => {
  const imageRequests: string[] = [];
  const secondPath = "/uploads/manga/second.png";
  const firstPath = "/uploads/manga/first.jpg";
  await withFetch(async (input, init) => {
    const url = String(input);
    if (url === `${apiBase}/chapter?${chapter.key}`) {
      return jsonResponse({
        data: { id: 101, pages: [{ id: 20, url: `/${secondPath}` }, { id: 10, url: firstPath }] },
      });
    }
    imageRequests.push(url);
    const headers = init?.headers as Record<string, string>;
    assert.equal(headers["Site-Id"], "1");
    assert.equal(headers["X-DL-Service"], "mangalib");
    assert.equal(headers.Authorization, "Bearer secret-token");
    if (url === `https://img2.mixlib.me${secondPath}`) return new Response("missing", { status: 404 });
    if (url === `https://img3.cdnlibs.org${secondPath}`) {
      return new Response(Uint8Array.of(2).buffer, { headers: { "content-type": "image/png" } });
    }
    if (url === `https://img2.mixlib.me${firstPath}`) {
      return new Response(Uint8Array.of(1).buffer, { headers: { "content-type": "image/jpeg" } });
    }
    throw new Error(`Unexpected request: ${url}`);
  }, async () => {
    assert.deepEqual((await mangalib.fetchChapter(chapter, "secret-token")).chunks, [
      { kind: "image", data: Uint8Array.of(1), mime: "image/jpeg" },
      { kind: "image", data: Uint8Array.of(2), mime: "image/png" },
    ]);
  });

  assert.deepEqual(imageRequests, [
    `https://img2.mixlib.me${secondPath}`,
    `https://img2.mixlib.me${firstPath}`,
    `https://img3.cdnlibs.org${secondPath}`,
  ]);
});

test("MangaLib rejects empty chapters and malformed chapter lists", async () => {
  await withFetch(async (input) => {
    if (String(input) === `${apiBase}/chapter?${chapter.key}`) {
      return jsonResponse({ data: { id: 101, pages: [] } });
    }
    throw new Error(`Unexpected request: ${input}`);
  }, async () => {
    await assert.rejects(mangalib.fetchChapter(chapter, null), /не содержит ни одной страницы/);
  });

  await withFetch(async (input) => {
    assert.equal(String(input), `${apiBase}/chapters`);
    return jsonResponse({ data: null });
  }, async () => {
    await assert.rejects(mangalib.fetchChapters(titleUrl, null), /список глав/);
  });
});
