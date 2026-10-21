import { createHash } from "node:crypto";

const maximumBookedFilms = 3000;
const maximumWatchlistFilms = 3000;
const bookingExpirySeconds = 30 * 24 * 60 * 60;
const syncCodePattern =
  /^(?:[A-Za-z0-9_-]{40,100}|[a-z]+(?:-[a-z]+){2}|[a-z]+(?:-[a-z]+){5})$/;
const filmIdPattern = /^\/film\/[a-z0-9-]+\/$/i;
const datePattern = /^\d{4}-\d{2}-\d{2}$/;
type BookingDetails = { date?: string; url?: string };

export class BookingStoreError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
  ) {
    super(message);
  }
}

type BookingSyncRequest =
  | {
      action: "create" | "connect";
      username: string;
      code: string;
      filmIds: string[];
      bookingDetails: Record<string, BookingDetails>;
    }
  | {
      action: "reconcile";
      username: string;
      code: string;
      watchlistFilmIds: string[];
    }
  | { action: "load" | "delete"; username: string; code: string }
  | {
      action: "set";
      username: string;
      code: string;
      filmId: string;
      booked: boolean;
      details: BookingDetails;
    };

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function isFilmId(value: unknown): value is string {
  return typeof value === "string" && filmIdPattern.test(value);
}

function parseDetails(value: unknown): BookingDetails {
  if (!isRecord(value)) throw new BookingStoreError("Invalid booking details.", 400);
  const { date, url } = value;
  if (date !== undefined && (typeof date !== "string" || !datePattern.test(date) || Number.isNaN(Date.parse(`${date}T12:00:00Z`)) || new Date(`${date}T12:00:00Z`).toISOString().slice(0, 10) !== date)) {
    throw new BookingStoreError("Enter a valid booking date.", 400);
  }
  if (url !== undefined && (typeof url !== "string" || url.length > 2048 || !/^https?:\/\//i.test(url))) {
    throw new BookingStoreError("Enter a valid confirmation URL.", 400);
  }
  if (url) {
    try { new URL(url); } catch { throw new BookingStoreError("Enter a valid confirmation URL.", 400); }
  }
  return { ...(date ? { date } : {}), ...(url ? { url } : {}) };
}

function parseDetailsMap(value: unknown, filmIds: string[]): Record<string, BookingDetails> {
  if (value === undefined) return {};
  if (!isRecord(value) || Object.keys(value).length > maximumBookedFilms) {
    throw new BookingStoreError("Invalid booking details.", 400);
  }
  const allowed = new Set(filmIds);
  return Object.fromEntries(Object.entries(value).map(([id, details]) => {
    if (!allowed.has(id)) throw new BookingStoreError("Invalid booking details.", 400);
    return [id, parseDetails(details)];
  }));
}

function parseRequest(value: unknown): BookingSyncRequest {
  if (!isRecord(value)) {
    throw new BookingStoreError("Invalid booking sync request.", 400);
  }

  const { action, username, code, filmIds, filmId, booked } = value;
  if (
    (action !== "create" &&
      action !== "connect" &&
      action !== "load" &&
    action !== "delete" &&
    action !== "set" &&
    action !== "reconcile") ||
    typeof username !== "string" ||
    !/^[A-Za-z0-9_-]{1,30}$/.test(username) ||
    typeof code !== "string" ||
    !syncCodePattern.test(code)
  ) {
    throw new BookingStoreError("Invalid booking sync request.", 400);
  }

  if (action === "create" || action === "connect") {
    if (!Array.isArray(filmIds) || filmIds.length > maximumBookedFilms) {
      throw new BookingStoreError("Invalid booked-film list.", 400);
    }
    const validFilmIds = filmIds.filter(isFilmId);
    if (validFilmIds.length !== filmIds.length) {
      throw new BookingStoreError("Invalid booked-film list.", 400);
    }
    return { action, username, code, filmIds: validFilmIds, bookingDetails: parseDetailsMap(value.bookingDetails, validFilmIds) };
  }

  if (action === "reconcile") {
    if (
      !Array.isArray(value.watchlistFilmIds) ||
      value.watchlistFilmIds.length > maximumWatchlistFilms
    ) {
      throw new BookingStoreError("Invalid watchlist film list.", 400);
    }
    const validFilmIds = value.watchlistFilmIds.filter(isFilmId);
    if (validFilmIds.length !== value.watchlistFilmIds.length) {
      throw new BookingStoreError("Invalid watchlist film list.", 400);
    }
    return { action, username, code, watchlistFilmIds: validFilmIds };
  }

  if (action === "set") {
    if (!isFilmId(filmId) || typeof booked !== "boolean") {
      throw new BookingStoreError("Invalid booking update.", 400);
    }
    return { action, username, code, filmId, booked, details: value.details === undefined ? {} : parseDetails(value.details) };
  }

  return { action, username, code };
}

const createVaultScript = `
  redis.call('SET', KEYS[1], '1')
  local count = tonumber(ARGV[1])
  for i = 1, count do
    redis.call('SADD', KEYS[2], ARGV[i + 1])
  end
  local details = cjson.decode(ARGV[count + 2])
  for filmId, value in pairs(details) do
    redis.call('HSET', KEYS[3], filmId, cjson.encode(value))
  end
  redis.call('EXPIRE', KEYS[1], ${bookingExpirySeconds})
  redis.call('EXPIRE', KEYS[2], ${bookingExpirySeconds})
  redis.call('EXPIRE', KEYS[3], ${bookingExpirySeconds})
  return {redis.call('SMEMBERS', KEYS[2]), redis.call('HGETALL', KEYS[3])}
`;

const connectVaultScript = `
  if redis.call('EXISTS', KEYS[1]) == 0 then
    return false
  end
  local count = tonumber(ARGV[1])
  for i = 1, count do
    redis.call('SADD', KEYS[2], ARGV[i + 1])
  end
  local details = cjson.decode(ARGV[count + 2])
  for filmId, value in pairs(details) do
    redis.call('HSETNX', KEYS[3], filmId, cjson.encode(value))
  end
  redis.call('EXPIRE', KEYS[1], ${bookingExpirySeconds})
  redis.call('EXPIRE', KEYS[2], ${bookingExpirySeconds})
  redis.call('EXPIRE', KEYS[3], ${bookingExpirySeconds})
  return {redis.call('SMEMBERS', KEYS[2]), redis.call('HGETALL', KEYS[3])}
`;

const loadVaultScript = `
  if redis.call('EXISTS', KEYS[1]) == 0 then
    return false
  end
  redis.call('EXPIRE', KEYS[1], ${bookingExpirySeconds})
  redis.call('EXPIRE', KEYS[2], ${bookingExpirySeconds})
  redis.call('EXPIRE', KEYS[3], ${bookingExpirySeconds})
  return {redis.call('SMEMBERS', KEYS[2]), redis.call('HGETALL', KEYS[3])}
`;

const reconcileVaultScript = `
  if redis.call('EXISTS', KEYS[1]) == 0 then
    return false
  end
  local watchlist = {}
  local count = tonumber(ARGV[1])
  for i = 1, count do
    watchlist[ARGV[i + 1]] = true
  end
  local booked = redis.call('SMEMBERS', KEYS[2])
  for _, filmId in ipairs(booked) do
    if not watchlist[filmId] then
      redis.call('SREM', KEYS[2], filmId)
      redis.call('HDEL', KEYS[3], filmId)
    end
  end
  redis.call('EXPIRE', KEYS[1], ${bookingExpirySeconds})
  redis.call('EXPIRE', KEYS[2], ${bookingExpirySeconds})
  redis.call('EXPIRE', KEYS[3], ${bookingExpirySeconds})
  return {redis.call('SMEMBERS', KEYS[2]), redis.call('HGETALL', KEYS[3])}
`;

const deleteVaultScript = `
  if redis.call('EXISTS', KEYS[1]) == 0 then
    return false
  end
  redis.call('DEL', KEYS[1], KEYS[2], KEYS[3])
  return {}
`;

const setBookingScript = `
  if redis.call('EXISTS', KEYS[1]) == 0 then
    return false
  end
  if ARGV[1] == '1' then
    redis.call('SADD', KEYS[2], ARGV[2])
    if ARGV[3] ~= '{}' then
      redis.call('HSET', KEYS[3], ARGV[2], ARGV[3])
    else
      redis.call('HDEL', KEYS[3], ARGV[2])
    end
  else
    redis.call('SREM', KEYS[2], ARGV[2])
    redis.call('HDEL', KEYS[3], ARGV[2])
  end
  redis.call('EXPIRE', KEYS[1], ${bookingExpirySeconds})
  redis.call('EXPIRE', KEYS[2], ${bookingExpirySeconds})
  redis.call('EXPIRE', KEYS[3], ${bookingExpirySeconds})
  return {redis.call('SMEMBERS', KEYS[2]), redis.call('HGETALL', KEYS[3])}
`;

async function runRedisScript(
  script: string,
  keys: string[],
  args: string[],
): Promise<unknown> {
  const restUrl = process.env.KV_REST_API_URL;
  const restToken = process.env.KV_REST_API_TOKEN;
  if (!restUrl || !restToken) {
    throw new BookingStoreError(
      "Server-side booking sync is not configured. Set KV_REST_API_URL and KV_REST_API_TOKEN.",
      503,
    );
  }

  let response: Response;
  try {
    response = await fetch(restUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${restToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(["EVAL", script, keys.length, ...keys, ...args]),
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw new BookingStoreError(
      "Could not connect to booking storage. Please try again.",
      503,
    );
  }

  if (!response.ok) {
    throw new BookingStoreError(
      `Booking storage returned HTTP ${response.status}. Please try again.`,
      502,
    );
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new BookingStoreError(
      "Booking storage returned an invalid response.",
      502,
    );
  }

  if (
    !isRecord(payload) ||
    ("error" in payload && typeof payload.error === "string")
  ) {
    throw new BookingStoreError(
      "Booking storage could not process the request.",
      502,
    );
  }
  return payload.result;
}

function getVaultKeys(username: string, code: string): [string, string, string] {
  const digest = createHash("sha256")
    .update(username.toLowerCase())
    .update("\0")
    .update(code)
    .digest("hex");
  const tag = `{${digest}}`;
  return [`watch-it-when:${tag}:vault`, `watch-it-when:${tag}:bookings`, `watch-it-when:${tag}:details`];
}

function parseBookingResult(result: unknown): { bookedFilmIds: string[]; bookingDetails: Record<string, BookingDetails> } {
  if (!Array.isArray(result) || result.length !== 2 || !Array.isArray(result[0]) || result[0].some((id) => !isFilmId(id)) || !Array.isArray(result[1]) || result[1].length % 2 !== 0) {
    throw new BookingStoreError(
      "Booking storage returned invalid booking data.",
      502,
    );
  }
  const bookedFilmIds = result[0] as string[];
  const bookingDetails: Record<string, BookingDetails> = {};
  for (let index = 0; index < result[1].length; index += 2) {
    const id = result[1][index];
    try {
      if (!bookedFilmIds.includes(id)) throw new Error();
      bookingDetails[id] = parseDetails(JSON.parse(result[1][index + 1]));
    } catch {
      throw new BookingStoreError("Booking storage returned invalid booking details.", 502);
    }
  }
  return { bookedFilmIds, bookingDetails };
}

export async function syncBookings(value: unknown): Promise<{ bookedFilmIds: string[]; bookingDetails: Record<string, BookingDetails> }> {
  const request = parseRequest(value);
  const keys = getVaultKeys(request.username, request.code);
  let result: unknown;

  if (request.action === "create" || request.action === "connect") {
    const filmIds = [...new Set(request.filmIds)];
    const script = request.action === "create"
      ? createVaultScript
      : connectVaultScript;
    result = await runRedisScript(script, keys, [
      String(filmIds.length),
      ...filmIds,
      JSON.stringify(request.bookingDetails),
    ]);
    if (request.action === "connect" && (result === null || result === false)) {
      throw new BookingStoreError(
        "No booking sync was found for that username and code. Check the code and try again.",
        404,
      );
    }
  } else if (request.action === "set") {
    result = await runRedisScript(setBookingScript, keys, [
      request.booked ? "1" : "0",
      request.filmId,
      JSON.stringify(request.details),
    ]);
    if (result === null || result === false) {
      throw new BookingStoreError(
        "No booking sync was found for that username and code. Reconnect and try again.",
        404,
      );
    }
  } else if (request.action === "delete") {
    result = await runRedisScript(deleteVaultScript, keys, []);
    if (result === null || result === false) {
      throw new BookingStoreError(
        "No booking sync was found for that username and code. Check the code and try again.",
        404,
      );
    }
  } else if (request.action === "reconcile") {
    const watchlistFilmIds = [...new Set(request.watchlistFilmIds)];
    result = await runRedisScript(reconcileVaultScript, keys, [
      String(watchlistFilmIds.length),
      ...watchlistFilmIds,
    ]);
    if (result === null || result === false) {
      throw new BookingStoreError(
        "No booking sync was found for that username and code. Reconnect and try again.",
        404,
      );
    }
  } else {
    result = await runRedisScript(loadVaultScript, keys, []);
    if (result === null || result === false) {
      throw new BookingStoreError(
        "No booking sync was found for that username and code. Check the code and try again.",
        404,
      );
    }
  }

  if (request.action === "delete") return { bookedFilmIds: [], bookingDetails: {} };
  return parseBookingResult(result);
}
