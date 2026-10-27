import assert from "node:assert/strict";
import test from "node:test";
import ranobelib from "../src/sources/ranobelib";
import type { ChapterRef } from "../src/sources/types";

const slug = "66993--kono-subarashii-sekai-ni-shukufuku-wo-yorimichi";
const titleUrl = `https://ranobelib.me/ru/book/${slug}?section=chapters`;
const apiBase = `https://api.cdnlibs.org/api/manga/${slug}`;
const chapter: ChapterRef = {
  id: 7,
  title: "Том 4, Глава 1 - Побочная история",
  key: "number=1&volume=4&branch_id=12",
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

test("RanobeLib recognizes book URLs and configures headers for API and images", async () => {
  assert.equal(ranobelib.key, "ranobelib");
  assert.equal(ranobelib.kind, "novel");
  assert.equal(ranobelib.requiresAuth, undefined);
  assert.equal(ranobelib.titleSlug(titleUrl), slug);
  assert.equal(ranobelib.titleSlug(`https://ranobelib.me/ru/${slug}`), slug);
  assert.equal(ranobelib.titleSlug(`https://mangalib.me/ru/book/${slug}`), null);
  assert.equal(ranobelib.titleSlug("https://ranobelib.me/ru/book/invalid"), null);

  const patch = ranobelib.requestPatch!(titleUrl);
  assert.deepEqual(patch.requestDomains, ["api.cdnlibs.org", "cover.cdnlibs.org"]);
  assert.deepEqual(patch.headers, [
    { header: "referer", operation: "set", value: "https://ranobelib.me/" },
    { header: "origin", operation: "set", value: "https://ranobelib.me" },
    { header: "sec-fetch-site", operation: "set", value: "cross-site" },
  ]);
  assert.deepEqual(patch.additionalRules?.[0]?.requestDomains, ["ranobelib.me"]);
  assert.deepEqual(patch.additionalRules?.[0]?.headers, [
    {
      header: "accept",
      operation: "set",
      value: "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
    },
    { header: "referer", operation: "set", value: titleUrl },
    { header: "sec-fetch-site", operation: "set", value: "same-origin" },
  ]);

  let requests = 0;
  await withFetch(async () => {
    requests++;
    throw new Error("Unexpected request");
  }, async () => {
    await assert.rejects(ranobelib.fetchTitle("https://ranobelib.me/other", null), /slug тайтла/);
    await assert.rejects(ranobelib.fetchChapters("https://ranobelib.me/other", null), /slug тайтла/);
  });
  assert.equal(requests, 0);
});

test("RanobeLib fetches metadata and chapter keys with its site headers", async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  await withFetch(async (input, init) => {
    const url = String(input);
    calls.push({ url, init });
    if (url === `${apiBase}?fields[]=teams&fields[]=authors`) {
      return jsonResponse({
        data: {
          id: 66993,
          rus_name: "",
          name: "KonoSuba",
          authors: [{ id: 1, rus_name: null, name: "Natsume Akatsuki" }],
          cover: { filename: "cover.jpg", default: "https://cover.cdnlibs.org/cover.jpg" },
        },
      });
    }
    if (url === `${apiBase}/chapters`) {
      return jsonResponse({
        data: [
          { id: 4159608, index: 7, item_number: 1, volume: "4", number: "1", number_secondary: "1", name: "Побочная история", branch_id: 12 },
          { id: 4159609, index: 8, item_number: 2, volume: "4", number: "1.5", number_secondary: "1.5", name: null, branch_id: null },
        ],
      });
    }
    throw new Error(`Unexpected request: ${url}`);
  }, async () => {
    const result = await ranobelib.fetchTitle(titleUrl, "secret-token");
    assert.deepEqual(result.meta, {
      id: "66993",
      title: "KonoSuba",
      author: "Natsume Akatsuki",
      coverUrl: "https://cover.cdnlibs.org/cover.jpg",
    });
    assert.deepEqual(result.chapters, [
      chapter,
      { id: 8, title: "Том 4, Глава 1.5", key: "number=1.5&volume=4", slug },
    ]);
  });

  assert.deepEqual(calls.map(({ url }) => url).sort(), [
    `${apiBase}?fields[]=teams&fields[]=authors`,
    `${apiBase}/chapters`,
  ].sort());
  for (const { init } of calls) {
    const headers = init?.headers as Record<string, string>;
    assert.equal(headers["Site-Id"], "3");
    assert.equal(headers["X-DL-Service"], "ranobelib");
    assert.equal(headers.Authorization, "Bearer secret-token");
  }
});

test("RanobeLib can fetch chapter lists without a token", async () => {
  await withFetch(async (input, init) => {
    assert.equal(String(input), `${apiBase}/chapters`);
    const headers = init?.headers as Record<string, string>;
    assert.equal(headers["Site-Id"], "3");
    assert.equal(headers.Authorization, undefined);
    return jsonResponse({ data: [] });
  }, async () => {
    assert.deepEqual(await ranobelib.fetchChapters(titleUrl, null), []);
  });
});

test("RanobeLib keeps ProseMirror text and attachment images in source order", async () => {
  const imageUrl = "https://ranobelib.me/uploads/ranobe/66993/chapters/4159608/illustration.png";
  const imageRequests: Array<{ url: string; init?: RequestInit }> = [];
  await withFetch(async (input, init) => {
    const url = String(input);
    if (url === `${apiBase}/chapter?${chapter.key}`) {
      const headers = init?.headers as Record<string, string>;
      assert.equal(headers["Site-Id"], "3");
      assert.equal(headers.Authorization, "Bearer secret-token");
      return jsonResponse({
        data: {
          id: 4159608,
          attachments: [{ name: "illustration", url: "/uploads/ranobe/66993/chapters/4159608/illustration.png" }],
          content: {
            type: "doc",
            content: [
              { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Начало" }] },
              { type: "heading", attrs: { level: 3 }, content: [{ type: "text", text: "Часть 1" }] },
              { type: "paragraph", content: [
                { type: "text", text: "Текст " },
                { type: "text", text: "с курсивом", marks: [{ type: "italic" }] },
                { type: "text", text: " и " },
                { type: "text", text: "жирный", marks: [{ type: "bold" }] },
              ] },
              { type: "image", attrs: { images: [{ image: "missing" }, { image: "illustration" }] } },
              { type: "paragraph", content: [{ type: "text", text: "Конец" }] },
            ],
          },
        },
      });
    }
    imageRequests.push({ url, init });
    assert.equal(url, imageUrl);
    return new Response(Uint8Array.of(1, 2, 3).buffer, { headers: { "content-type": "image/png" } });
  }, async () => {
    assert.deepEqual((await ranobelib.fetchChapter(chapter, "secret-token")).chunks, [
      { kind: "text", text: "Начало", styles: [], startsParagraph: true, headingLevel: 2 },
      { kind: "text", text: "Часть 1", styles: [], startsParagraph: true, headingLevel: 3 },
      { kind: "text", text: "Текст ", styles: [], startsParagraph: true },
      { kind: "text", text: "с курсивом", styles: ["emphasis"], startsParagraph: false },
      { kind: "text", text: " и ", styles: [], startsParagraph: false },
      { kind: "text", text: "жирный", styles: ["strong"], startsParagraph: false },
      { kind: "image", data: Uint8Array.of(1, 2, 3), mime: "image/png" },
      { kind: "text", text: "Конец", styles: [], startsParagraph: true },
    ]);
  });
  assert.equal(imageRequests.length, 1);
  assert.deepEqual(imageRequests[0]?.init?.headers, {});
  assert.equal(imageRequests[0]?.init?.credentials, "include");
});

class TestNode {
  static readonly TEXT_NODE = 3;
  nodeType = 1;
  nodeValue: string | null = null;
  constructor(readonly childNodes: TestNode[] = []) {}
}

class TestText extends TestNode {
  override nodeType = TestNode.TEXT_NODE;
  constructor(text: string) {
    super();
    this.nodeValue = text;
  }
}

class TestElement extends TestNode {
  constructor(readonly tagName: string, children: TestNode[] = []) {
    super(children);
  }
}

class TestParagraph extends TestElement {}
class TestHeading extends TestElement {}
class TestBreak extends TestElement {}
class TestImage extends TestElement {
  constructor(private readonly src: string) {
    super("IMG");
  }
  getAttribute(name: string): string | null {
    return name === "src" ? this.src : null;
  }
}

async function withDom<T>(nodes: TestElement[], run: () => Promise<T>): Promise<T> {
  class TestDOMParser {
    parseFromString(_html: string, mime: string) {
      assert.equal(mime, "text/html");
      return { body: { querySelectorAll: () => nodes } };
    }
  }
  const classes = {
    Node: TestNode,
    Element: TestElement,
    HTMLParagraphElement: TestParagraph,
    HTMLHeadingElement: TestHeading,
    HTMLImageElement: TestImage,
    HTMLBRElement: TestBreak,
    DOMParser: TestDOMParser,
  };
  const previous = Object.keys(classes).map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)] as const);
  for (const [name, value] of Object.entries(classes)) {
    Object.defineProperty(globalThis, name, { configurable: true, value });
  }
  try {
    return await run();
  } finally {
    for (const [name, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else Reflect.deleteProperty(globalThis, name);
    }
  }
}

test("RanobeLib preserves HTML text styles, line breaks, and inline illustrations", async () => {
  const nodes = [
    new TestHeading("H2", [new TestText(" Заголовок ")]),
    new TestParagraph("P", [
      new TestText("До "),
      new TestElement("EM", [new TestText("курсива")]),
      new TestBreak("BR"),
      new TestElement("STRONG", [new TestText("жирный")]),
    ]),
    new TestImage("/uploads/ranobe/66993/chapters/4159608/picture.jpg"),
    new TestParagraph("P", [new TestText("После")]),
  ];
  const imageUrl = "https://ranobelib.me/uploads/ranobe/66993/chapters/4159608/picture.jpg";

  await withDom(nodes, async () => {
    await withFetch(async (input, init) => {
      const url = String(input);
      if (url === `${apiBase}/chapter?${chapter.key}`) {
        return jsonResponse({ data: { id: 4159608, content: "<h2>Заголовок</h2><p>Текст</p><img>" } });
      }
      assert.equal(url, imageUrl);
      assert.deepEqual(init?.headers, {});
      assert.equal(init?.credentials, "include");
      return new Response(Uint8Array.of(9).buffer, { headers: { "content-type": "image/jpeg" } });
    }, async () => {
      assert.deepEqual((await ranobelib.fetchChapter(chapter, null)).chunks, [
        { kind: "text", text: "Заголовок", styles: [], startsParagraph: true, headingLevel: 2 },
        { kind: "text", text: "До ", styles: [], startsParagraph: true },
        { kind: "text", text: "курсива", styles: ["emphasis"], startsParagraph: false },
        { kind: "text", text: "\n", styles: [], startsParagraph: false },
        { kind: "text", text: "жирный", styles: ["strong"], startsParagraph: false },
        { kind: "image", data: Uint8Array.of(9), mime: "image/jpeg" },
        { kind: "text", text: "После", styles: [], startsParagraph: true },
      ]);
    });
  });
});

test("RanobeLib rejects missing, empty, and unrecognized chapter content", async () => {
  for (const content of [null, 42, { type: "doc", content: [] }]) {
    await withFetch(async (input) => {
      assert.equal(String(input), `${apiBase}/chapter?${chapter.key}`);
      return jsonResponse({ data: { id: 4159608, content } });
    }, async () => {
      await assert.rejects(
        ranobelib.fetchChapter(chapter, null),
        content && typeof content === "object" ? /не содержит ни текста, ни иллюстраций/ : /не удалось распознать формат/
      );
    });
  }

  await withFetch(async (input) => {
    assert.equal(String(input), `${apiBase}/chapters`);
    return jsonResponse({ data: null });
  }, async () => {
    await assert.rejects(ranobelib.fetchChapters(titleUrl, null), /список глав/);
  });
});
