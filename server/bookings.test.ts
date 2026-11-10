import assert from "node:assert/strict";
import { test } from "node:test";
import { BookingStoreError, syncBookings } from "./bookings.js";

test("settings sync API contract", async (t) => {
  const originalFetch = globalThis.fetch;
  const originalUrl = process.env.KV_REST_API_URL;
  const originalToken = process.env.KV_REST_API_TOKEN;
  process.env.KV_REST_API_URL = "https://storage.invalid";
  process.env.KV_REST_API_TOKEN = "test-token";
  t.after(() => {
    globalThis.fetch = originalFetch;
    if (originalUrl === undefined) delete process.env.KV_REST_API_URL;
    else process.env.KV_REST_API_URL = originalUrl;
    if (originalToken === undefined) delete process.env.KV_REST_API_TOKEN;
    else process.env.KV_REST_API_TOKEN = originalToken;
  });

  let commands: unknown[][] = [];
  let storageResult: unknown = [[], [], null];
  globalThis.fetch = async (_url, options) => {
    commands.push(JSON.parse(String(options?.body)));
    return new Response(JSON.stringify({ result: storageResult }));
  };
  const identity = { username: "filmfan", code: "one-two-three" };
  const filmId = "/film/tenzing/";

  await t.test("creating sync uploads the local preference", async () => {
    storageResult = [[filmId], [filmId, JSON.stringify({ date: "2026-11-20" })], "booking"];
    const result = await syncBookings({ ...identity, action: "create", filmIds: [filmId], sortOrder: "booking" });
    assert.equal(result.sortOrder, "booking");
    assert.deepEqual(result.bookingDetails[filmId], { date: "2026-11-20" });
    assert.deepEqual(commands.at(-1)?.slice(-4), ["1", filmId, "{}", JSON.stringify({ sortOrder: "booking" })]);
    assert.equal(commands.at(-1)?.[2], 4);
  });

  await t.test("connecting respects the remote preference", async () => {
    storageResult = [[], [], "booking"];
    const result = await syncBookings({ ...identity, action: "connect", filmIds: [], sortOrder: "release" });
    assert.equal(result.sortOrder, "booking");
    assert.deepEqual(commands.at(-1)?.slice(-3), ["0", "{}", JSON.stringify({ sortOrder: "release" })]);
  });

  await t.test("watchlist sync includes the local migration preference and returns remote settings", async () => {
    storageResult = [[], [], "release"];
    const result = await syncBookings({ ...identity, action: "reconcile", watchlistFilmIds: [filmId], sortOrder: "booking" });
    assert.equal(result.sortOrder, "release");
    assert.deepEqual(commands.at(-1)?.slice(-3), ["1", filmId, JSON.stringify({ sortOrder: "booking" })]);
  });

  await t.test("setting sort order does not send a booking update", async () => {
    storageResult = [[filmId], [], "booking"];
    const result = await syncBookings({ ...identity, action: "settings", sortOrder: "booking" });
    assert.deepEqual(result, { bookedFilmIds: [filmId], bookingDetails: {}, sortOrder: "booking", settings: { sortOrder: "booking" } });
    assert.equal(commands.at(-1)?.length, 8);
    assert.equal(commands.at(-1)?.at(-1), JSON.stringify({ sortOrder: "booking" }));
    assert.match(String(commands.at(-1)?.[1]), /mergeSettings\(ARGV\[1\], true\)/);
    assert.doesNotMatch(String(commands.at(-1)?.[1]), /SADD|SREM|HSET|HDEL/);
  });

  await t.test("existing accounts without settings and older clients still work", async () => {
    storageResult = [[], [], null];
    assert.deepEqual(await syncBookings({ ...identity, action: "load" }), { bookedFilmIds: [], bookingDetails: {} });
    await syncBookings({ ...identity, action: "connect", filmIds: [] });
    assert.equal(commands.at(-1)?.at(-1), "{}");
  });

  await t.test("prompt settings sync both off and back on without uploading sort order", async () => {
    for (const disabled of [true, false]) {
      const settings = { bookingDetailsPromptDisabled: disabled, bookingPromptChoiceMade: true };
      storageResult = [[filmId], [], JSON.stringify({ sortOrder: "booking", ...settings })];
      const result = await syncBookings({ ...identity, action: "settings", settings });
      assert.deepEqual(result.settings, { sortOrder: "booking", ...settings });
      assert.deepEqual(JSON.parse(String(commands.at(-1)?.at(-1))), settings);
    }
  });

  await t.test("connecting seeds settings only when each key is missing", async () => {
    const settings = { sortOrder: "release", bookingDetailsPromptDisabled: false, bookingPromptChoiceMade: true };
    storageResult = [[], [], JSON.stringify({ ...settings, sortOrder: "booking" })];
    const result = await syncBookings({ ...identity, action: "connect", filmIds: [], settings });
    assert.equal(result.settings?.sortOrder, "booking");
    assert.equal(result.settings?.bookingDetailsPromptDisabled, false);
    assert.match(String(commands.at(-1)?.[1]), /settings\[key\] == nil/);
    assert.match(String(commands.at(-1)?.[1]), /mergeSettings\(ARGV\[count \+ 3\], false\)/);
  });

  await t.test("malformed prompt preferences are rejected", async () => {
    commands = [];
    await assert.rejects(syncBookings({ ...identity, action: "settings", settings: { bookingDetailsPromptDisabled: "false" } }), (error: unknown) =>
      error instanceof BookingStoreError && error.statusCode === 400);
    assert.equal(commands.length, 0);
    storageResult = [[], [], JSON.stringify({ bookingDetailsPromptDisabled: "false" })];
    await assert.rejects(syncBookings({ ...identity, action: "load" }), (error: unknown) =>
      error instanceof BookingStoreError && error.statusCode === 502);
  });

  await t.test("invalid settings are rejected before storage access", async () => {
    commands = [];
    for (const sortOrder of ["invalid", null, undefined]) {
      await assert.rejects(syncBookings({ ...identity, action: "settings", sortOrder }), (error: unknown) =>
        error instanceof BookingStoreError && error.statusCode === 400);
    }
    assert.equal(commands.length, 0);
  });

  await t.test("expired sync accounts report a reconnect error", async () => {
    storageResult = null;
    await assert.rejects(syncBookings({ ...identity, action: "settings", sortOrder: "release" }), (error: unknown) =>
      error instanceof BookingStoreError && error.statusCode === 404);
  });
});
