import { createHash } from "node:crypto";

const maximumBookedFilms = 3000;
const syncCodePattern = /^[A-Za-z0-9_-]{40,100}$/;
const filmIdPattern = /^\/film\/[a-z0-9-]+\/$/i;

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
    }
  | { action: "load"; username: string; code: string }
  | {
      action: "set";
      username: string;
      code: string;
      filmId: string;
      booked: boolean;
    };

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function isFilmId(value: unknown): value is string {
  return typeof value === "string" && filmIdPattern.test(value);
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
      action !== "set") ||
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
    return { action, username, code, filmIds: validFilmIds };
  }

  if (action === "set") {
    if (!isFilmId(filmId) || typeof booked !== "boolean") {
      throw new BookingStoreError("Invalid booking update.", 400);
    }
    return { action, username, code, filmId, booked };
  }

  return { action, username, code };
}

const createVaultScript = `
  redis.call('SET', KEYS[1], '1')
  local count = tonumber(ARGV[1])
  for i = 1, count do
    redis.call('SADD', KEYS[2], ARGV[i + 1])
  end
  return redis.call('SMEMBERS', KEYS[2])
`;

const connectVaultScript = `
  if redis.call('EXISTS', KEYS[1]) == 0 then
    return false
  end
  local count = tonumber(ARGV[1])
  for i = 1, count do
    redis.call('SADD', KEYS[2], ARGV[i + 1])
  end
  return redis.call('SMEMBERS', KEYS[2])
`;

const loadVaultScript = `
  if redis.call('EXISTS', KEYS[1]) == 0 then
    return false
  end
  return redis.call('SMEMBERS', KEYS[2])
`;

const setBookingScript = `
  if redis.call('EXISTS', KEYS[1]) == 0 then
    return false
  end
  if ARGV[1] == '1' then
    redis.call('SADD', KEYS[2], ARGV[2])
  else
    redis.call('SREM', KEYS[2], ARGV[2])
  end
  return redis.call('SMEMBERS', KEYS[2])
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

function getVaultKeys(username: string, code: string): [string, string] {
  const digest = createHash("sha256")
    .update(username.toLowerCase())
    .update("\0")
    .update(code)
    .digest("hex");
  const tag = `{${digest}}`;
  return [`watch-it-when:${tag}:vault`, `watch-it-when:${tag}:bookings`];
}

function parseBookedFilmIds(result: unknown): string[] {
  if (
    !Array.isArray(result) ||
    result.some((id) => !isFilmId(id))
  ) {
    throw new BookingStoreError(
      "Booking storage returned invalid booking data.",
      502,
    );
  }
  return result;
}

export async function syncBookings(value: unknown): Promise<{
  bookedFilmIds: string[];
}> {
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

  return { bookedFilmIds: parseBookedFilmIds(result) };
}
