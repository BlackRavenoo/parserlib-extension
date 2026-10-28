import assert from "node:assert/strict";
import test from "node:test";
import type { TestContext } from "node:test";
import { setImmediate } from "node:timers/promises";
import { HttpClient, RequestsBlockedByRateLimit } from "../src/lib/http";
import type { HttpClientConfig } from "../src/lib/http";

const url = "https://example.test/resource";
const config: HttpClientConfig = {
  anonymous: { requestsPerMinute: 120, rateLimitRetries: 2, rateLimitRetryDelaySeconds: 2 },
  authenticated: { requestsPerMinute: 240, rateLimitRetries: 3, rateLimitRetryDelaySeconds: 1 },
  serverRetries: 2,
  serverRetryDelaySeconds: 1,
};

function response(status = 200, headers?: HeadersInit): Response {
  return new Response(Uint8Array.of(1, 2, 255).buffer, { status, headers });
}

function setup(t: TestContext, settings: HttpClientConfig = config) {
  t.mock.timers.enable({ apis: ["Date", "setTimeout"], now: 0 });
  const replies: Array<Response | Error> = [];
  const calls: Array<{ url: string; init?: RequestInit; time: number }> = [];
  t.mock.method(globalThis, "fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), init, time: Date.now() });
    const next = replies.shift();
    if (!next) throw new Error(`Unexpected request: ${input}`);
    if (next instanceof Error) throw next;
    return next;
  });
  return { client: new HttpClient(settings), replies, calls };
}

async function advance(t: TestContext, ms: number): Promise<void> {
  t.mock.timers.tick(ms);
  await setImmediate();
}

test("HTTP returns binary bytes and MIME and forwards request headers and credentials", async (t) => {
  const { client, replies, calls } = setup(t);
  replies.push(response(200, { "content-type": "image/webp" }));
  const headers = { Accept: "image/*", "Site-Id": "3" };

  assert.deepEqual(await client.requestBinary(url, headers, { credentials: "include" }), {
    data: Uint8Array.of(1, 2, 255),
    mime: "image/webp",
  });
  assert.equal(calls[0]?.url, url);
  assert.deepEqual(calls[0]?.init, { headers, credentials: "include" });
});

test("HTTP uses the fallback MIME and exposes raw bytes through requestBytes", async (t) => {
  const { client, replies } = setup(t);
  replies.push(response(), response());

  assert.equal((await client.requestBinary(url, {})).mime, "image/jpeg");
  assert.deepEqual(await client.requestBytes(url, {}), Uint8Array.of(1, 2, 255));
});

test("HTTP applies auth changes and can omit the API token for image requests", async (t) => {
  const { client, replies, calls } = setup(t);
  replies.push(response(), response(), response(), response());
  const headers = { Accept: "*/*" };

  client.setAuth("first-token");
  await client.requestBytes(url, headers);
  await client.requestBinary(url, headers, { includeAuth: false, credentials: "include" });
  client.setAuth("second-token");
  await client.requestBytes(url, headers);
  client.setAuth(null);
  await client.requestBytes(url, headers);

  assert.deepEqual(calls.map(({ init }) => init?.headers), [
    { Accept: "*/*", Authorization: "Bearer first-token" },
    { Accept: "*/*" },
    { Accept: "*/*", Authorization: "Bearer second-token" },
    { Accept: "*/*" },
  ]);
  assert.equal(calls[1]?.init?.credentials, "include");
  assert.deepEqual(headers, { Accept: "*/*" });
});

test("HTTP retries server errors with increasing delays before succeeding", async (t) => {
  const { client, replies, calls } = setup(t);
  replies.push(response(500), response(502), response());
  const pending = client.requestBytes(url, {});
  await setImmediate();
  assert.equal(calls.length, 1);

  await advance(t, 999);
  assert.equal(calls.length, 1);
  await advance(t, 1);
  assert.equal(calls.length, 2);
  await advance(t, 1999);
  assert.equal(calls.length, 2);
  await advance(t, 1);

  assert.deepEqual(await pending, Uint8Array.of(1, 2, 255));
  assert.deepEqual(calls.map(({ time }) => time), [0, 1000, 3000]);
});

test("HTTP retries transport failures and reports an exhausted network retry budget", async (t) => {
  const { client, replies, calls } = setup(t);
  replies.push(new TypeError("Network failure"), response());
  const pending = client.requestBytes(url, {});
  await setImmediate();
  await advance(t, 1000);
  assert.deepEqual(await pending, Uint8Array.of(1, 2, 255));

  replies.push(new TypeError("Network failure"), new TypeError("Network failure"), new TypeError("Network failure"));
  const rejected = assert.rejects(client.requestBytes(url, {}), {
    message: `Сеть недоступна: ${url}`,
  });
  await setImmediate();
  await advance(t, 1000);
  await advance(t, 2000);
  await rejected;
  assert.equal(calls.length, 5);
});

test("HTTP shares the server retry budget between transport failures and server errors", async (t) => {
  const { client, replies, calls } = setup(t, { ...config, serverRetries: 1 });
  replies.push(new TypeError("Network failure"), response(503), response());
  const rejected = assert.rejects(client.requestBytes(url, {}), {
    message: `Запрос провалился со статусом 503: ${url}`,
  });
  await setImmediate();
  await advance(t, 1000);
  await rejected;
  assert.equal(calls.length, 2);

  assert.deepEqual(await client.requestBytes(url, {}), Uint8Array.of(1, 2, 255));
});

test("HTTP does not retry permanent client errors or errors when retries are disabled", async (t) => {
  const { client, replies, calls } = setup(t, {
    ...config,
    serverRetries: 0,
    anonymous: { ...config.anonymous, rateLimitRetries: 0 },
  });
  for (const status of [400, 404, 422, 500]) {
    replies.push(response(status));
    await assert.rejects(client.requestBytes(url, {}), {
      message: `Запрос провалился со статусом ${status}: ${url}`,
    });
  }
  replies.push(new TypeError("Network failure"));
  await assert.rejects(client.requestBytes(url, {}), /Сеть недоступна/);
  assert.equal(calls.length, 5);
  assert.ok(calls.every(({ time }) => time === 0));
});

for (const [header, delay] of [["2.5", 2500], ["0", 0], ["600", 120_000]] as const) {
  test(`HTTP honors Retry-After ${header} with a delay of ${delay} ms`, async (t) => {
    const { client, replies, calls } = setup(t);
    replies.push(response(429, { "retry-after": header }), response());
    const pending = client.requestBytes(url, {});
    await setImmediate();
    assert.equal(calls.length, 1);
    if (delay > 0) {
      await advance(t, delay - 1);
      assert.equal(calls.length, 1);
      await advance(t, 1);
    } else {
      await advance(t, 0);
    }

    assert.deepEqual(await pending, Uint8Array.of(1, 2, 255));
    assert.deepEqual(calls.map(({ time }) => time), [0, delay]);
  });
}

test("HTTP falls back to increasing delays for missing or invalid Retry-After values", async (t) => {
  const { client, replies, calls } = setup(t, {
    ...config,
    anonymous: { ...config.anonymous, rateLimitRetries: 3 },
  });
  replies.push(
    response(429),
    response(429, { "retry-after": "invalid" }),
    response(429, { "retry-after": "-1" }),
    response()
  );
  const pending = client.requestBytes(url, {});
  await setImmediate();
  for (const delay of [2000, 4000, 6000]) {
    const count = calls.length;
    await advance(t, delay - 1);
    assert.equal(calls.length, count);
    await advance(t, 1);
  }

  assert.deepEqual(await pending, Uint8Array.of(1, 2, 255));
  assert.deepEqual(calls.map(({ time }) => time), [0, 2000, 6000, 12_000]);
});

test("HTTP chooses the authenticated retry profile and remains usable after exhausting retries", async (t) => {
  const { client, replies, calls } = setup(t, {
    ...config,
    anonymous: { ...config.anonymous, rateLimitRetries: 0 },
    authenticated: { ...config.authenticated, rateLimitRetries: 2 },
  });
  replies.push(response(429));
  await assert.rejects(client.requestBytes(url, {}), (error: unknown) => {
    assert.ok(error instanceof RequestsBlockedByRateLimit);
    assert.equal(error.name, "RequestsBlockedByRateLimit");
    assert.ok(error.message.includes(url));
    return true;
  });
  assert.equal(calls.length, 1);

  client.setAuth("token");
  replies.push(response(429), response(429), response(429), response());
  const rejected = assert.rejects(client.requestBytes(url, {}), RequestsBlockedByRateLimit);
  await setImmediate();
  await advance(t, 1000);
  await advance(t, 2000);
  await rejected;
  assert.deepEqual(calls.map(({ time }) => time), [0, 0, 1000, 3000]);
  assert.deepEqual(await client.requestBytes(url, {}), Uint8Array.of(1, 2, 255));
});

test("HTTP shares the throttle budget between 403 and 429 independently of server retries", async (t) => {
  const { client, replies, calls } = setup(t, { ...config, serverRetries: 1 });
  replies.push(response(500), response(403), response(429), response());
  const pending = client.requestBytes(url, {});
  await setImmediate();
  await advance(t, 1000);
  await advance(t, 2000);
  await advance(t, 4000);

  assert.deepEqual(await pending, Uint8Array.of(1, 2, 255));
  assert.deepEqual(calls.map(({ time }) => time), [0, 1000, 3000, 7000]);
});

test("HTTP stops retrying a persistent 403 and returns the CDN error", async (t) => {
  const { client, replies, calls } = setup(t, {
    ...config,
    anonymous: { ...config.anonymous, rateLimitRetries: 1 },
  });
  replies.push(response(403), response(403));
  const rejected = assert.rejects(client.requestBytes(url, {}), /CDN не пропускает запросы \(403\)/);
  await setImmediate();
  await advance(t, 1999);
  assert.equal(calls.length, 1);
  await advance(t, 1);
  await rejected;
  assert.equal(calls.length, 2);
});

test("HTTP queues concurrent requests in FIFO order and refills rate limit slots", async (t) => {
  const { client, replies, calls } = setup(t, {
    ...config,
    anonymous: { ...config.anonymous, requestsPerMinute: 2 },
  });
  const urls = Array.from({ length: 5 }, (_, index) => `${url}/${index}`);
  replies.push(...urls.map(() => response()));
  const pending = Promise.all(urls.map((item) => client.requestBytes(item, {})));
  await setImmediate();
  assert.deepEqual(calls.map(({ url }) => url), urls.slice(0, 2));
  await advance(t, 29_999);
  assert.equal(calls.length, 2);
  await advance(t, 1);
  assert.equal(calls.length, 3);
  await advance(t, 30_000);
  assert.equal(calls.length, 4);
  await advance(t, 30_000);
  await pending;

  assert.deepEqual(calls.map(({ url }) => url), urls);
  assert.deepEqual(calls.map(({ time }) => time), [0, 0, 30_000, 60_000, 90_000]);
});

test("HTTP caps the request burst after a long idle period", async (t) => {
  const { client, replies, calls } = setup(t, {
    ...config,
    anonymous: { ...config.anonymous, requestsPerMinute: 2 },
  });
  replies.push(response(), response(), response(), response(), response());
  await Promise.all([client.requestBytes(url, {}), client.requestBytes(url, {})]);
  await advance(t, 120_000);
  const pending = Promise.all(Array.from({ length: 3 }, () => client.requestBytes(url, {})));
  await setImmediate();
  assert.equal(calls.length, 4);
  await advance(t, 29_999);
  assert.equal(calls.length, 4);
  await advance(t, 1);
  await pending;
  assert.deepEqual(calls.map(({ time }) => time), [0, 0, 120_000, 120_000, 150_000]);
});

test("HTTP reschedules queued requests when the auth rate limit changes", async (t) => {
  const { client, replies, calls } = setup(t, {
    ...config,
    anonymous: { ...config.anonymous, requestsPerMinute: 1 },
    authenticated: { ...config.authenticated, requestsPerMinute: 2 },
  });
  replies.push(response(), response(), response());
  const pending = Promise.all(Array.from({ length: 3 }, () => client.requestBytes(url, {})));
  await setImmediate();
  assert.equal(calls.length, 1);
  client.setAuth("token");
  await advance(t, 29_999);
  assert.equal(calls.length, 1);
  await advance(t, 1);
  assert.equal(calls.length, 2);
  client.setAuth(null);
  await advance(t, 59_999);
  assert.equal(calls.length, 2);
  await advance(t, 1);
  await pending;

  assert.deepEqual(calls.map(({ time }) => time), [0, 30_000, 90_000]);
  assert.deepEqual(calls.map(({ init }) => (init?.headers as Record<string, string>).Authorization), [
    undefined, "Bearer token", undefined,
  ]);
});
