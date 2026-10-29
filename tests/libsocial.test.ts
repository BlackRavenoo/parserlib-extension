import assert from "node:assert/strict";
import test from "node:test";
import { libSocialTitle, libSocialToken } from "../src/sources/libsocial";
import { setGlobal } from "./helpers/extension";

test("LibSocial reads the access token from the site's auth session", (t) => {
  const getItem = t.mock.fn(() => JSON.stringify({ token: { access_token: "test-token" } }));
  setGlobal(t, "localStorage", { getItem });
  assert.equal(libSocialToken(), "test-token");
  assert.deepEqual(getItem.mock.calls[0]?.arguments, ["auth"]);
});

test("LibSocial treats absent, malformed, and incomplete auth sessions as anonymous", (t) => {
  const getItem = t.mock.fn<() => string | null>(() => null);
  setGlobal(t, "localStorage", { getItem });
  for (const raw of [null, "", "{invalid", "null", "{}", '{"token":null}',
    '{"token":{"access_token":""}}', '{"token":{"access_token":123}}']) {
    getItem.mock.mockImplementation(() => raw);
    assert.equal(libSocialToken(), null, raw ?? "missing auth");
  }
});

test("LibSocial prefers the trimmed DOM heading without querying metadata", (t) => {
  const querySelector = t.mock.fn(() => ({ textContent: "  Название книги\n" }));
  setGlobal(t, "document", { querySelector });
  assert.equal(libSocialTitle(), "Название книги");
  assert.deepEqual(querySelector.mock.calls.map(({ arguments: args }) => args), [["h1.anx_anz"]]);
});

test("LibSocial extracts titles from Open Graph metadata when the heading is missing or empty", (t) => {
  let heading: { textContent: string } | null = null;
  let ogTitle: string | null = null;
  setGlobal(t, "document", {
    querySelector: (selector: string) => {
      if (selector === "h1.anx_anz") return heading;
      assert.equal(selector, 'meta[property="og:title"]');
      return ogTitle === null ? null : { getAttribute: () => ogTitle };
    },
  });
  for (const [value, expected] of [
    ["MangaLib · Название · Читать 10 глав", "Название"],
    ["RanobeLib · Книга · Подзаголовок", "Книга · Подзаголовок"],
    ["  Название без префикса  ", "Название без префикса"],
    ["MangaLib · Название", "Название"],
    [" · ", " · "],
    ["", null],
    [null, null],
  ]) {
    ogTitle = value;
    assert.equal(libSocialTitle(), expected);
  }
  heading = { textContent: " \n " };
  ogTitle = "MangaLib · Название";
  assert.equal(libSocialTitle(), "Название");
});
