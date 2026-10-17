import * as cheerio from "cheerio";

interface WatchlistFilm {
  id: string;
  title: string;
  year: number | null;
  letterboxdUrl: string;
  posterUrl: string | null;
  releaseDates: Array<{ date: string; type: "previews" | "theatrical" }>;
  releaseStatus: "upcoming" | "recent";
}

interface WatchlistResult {
  username: string;
  films: WatchlistFilm[];
  fetchedAt: string;
}

const cache = new Map<string, { expiresAt: number; result: WatchlistResult }>();
const pendingRequests = new Map<string, Promise<WatchlistResult>>();
const cacheDurationMs = 15 * 60 * 1000;
const recentReleaseDays = 30;
const maximumWatchlistPages = 100;
const letterboxdOrigin = "https://letterboxd.com";

class LetterboxdError extends Error {}

function ukDate(date: Date): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return `${values.year}-${values.month}-${values.day}`;
}

async function fetchLetterboxd(url: string): Promise<string> {
  let response: Response;
  try {
    response = await fetch(url, {
      headers: {
        "User-Agent": "ScreeningRoom/1.0 (personal watchlist tracker)",
        Accept: "text/html",
      },
      signal: AbortSignal.timeout(12_000),
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : "Unknown network error";
    throw new LetterboxdError(`Could not reach Letterboxd: ${reason}`);
  }

  if (!response.ok) {
    throw new LetterboxdError(
      `Letterboxd returned ${response.status} while loading the watchlist.`,
    );
  }

  const html = await response.text();
  if (html.includes("Just a moment...") || html.includes("cf-chl-")) {
    throw new LetterboxdError(
      "Letterboxd is temporarily blocking automated requests. Try syncing again later.",
    );
  }
  return html;
}

function watchlistItems(html: string): Array<{
  id: string;
  title: string;
  year: number | null;
  path: string;
}> {
  const $ = cheerio.load(html);
  return $("li.griditem .react-component[data-item-link]")
    .toArray()
    .flatMap((element) => {
      const item = $(element);
      const href = item.attr("data-item-link");
      if (!href || !/^\/film\/[a-z0-9-]+\/$/i.test(href)) return [];

      const fullName = item.attr("data-item-full-display-name") ?? item.attr("data-item-name") ?? "";
      const match = fullName.match(/^(.*?)\s+\((\d{4})\)$/);
      const title = (match?.[1] ?? fullName).trim();
      if (!title) return [];

      return [{
        id: href,
        title,
        year: match ? Number(match[2]) : null,
        path: href,
      }];
    });
}

async function getWatchlist(username: string): Promise<Array<{
  id: string;
  title: string;
  year: number | null;
  path: string;
}>> {
  const films = new Map<string, {
    id: string;
    title: string;
    year: number | null;
    path: string;
  }>();

  for (let page = 1; page <= maximumWatchlistPages; page += 1) {
    const pagePath = page === 1
      ? `/${encodeURIComponent(username)}/watchlist/`
      : `/${encodeURIComponent(username)}/watchlist/page/${page}/`;
    const html = await fetchLetterboxd(new URL(pagePath, letterboxdOrigin).toString());
    const items = watchlistItems(html);
    for (const film of items) films.set(film.id, film);

    if (items.length < 28) return [...films.values()];
  }

  throw new LetterboxdError(
    `The watchlist exceeded ${maximumWatchlistPages} pages. Narrow it and try syncing again.`,
  );
}

function parseLetterboxdDate(value: string): string | null {
  const parsed = new Date(`${value} UTC`);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 10);
}

function ukTheatricalReleaseDates(html: string): Array<{
  date: string;
  type: "previews" | "theatrical";
}> {
  const $ = cheerio.load(html);
  const dates = new Map<"previews" | "theatrical", Set<string>>([
    ["previews", new Set()],
    ["theatrical", new Set()],
  ]);

  $("h3.release-table-title").each((_, element) => {
    const heading = $(element).text().trim().toLowerCase();
    const type =
      heading === "theatrical limited"
        ? "previews"
        : heading === "theatrical"
          ? "theatrical"
          : null;
    if (!type) return;

    $(element)
      .nextAll(".release-table.-bydate")
      .first()
      .find("> .listitem")
      .each((_, row) => {
        const countries = $(row)
          .find(".release-country .name")
          .toArray()
          .map((country) => $(country).text().trim().toLowerCase());
        if (!countries.some((country) => ["united kingdom", "uk", "great britain"].includes(country))) {
          return;
        }

        const date = parseLetterboxdDate($(row).find(".date").first().text().trim());
        if (date) dates.get(type)?.add(date);
      });
  });

  return [...dates.entries()]
    .flatMap(([type, values]) =>
      [...values].sort().map((date) => ({ date, type })),
    )
    .sort((left, right) => left.date.localeCompare(right.date));
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  mapper: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let nextIndex = 0;

  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, async () => {
      while (nextIndex < items.length) {
        const index = nextIndex;
        nextIndex += 1;
        results[index] = await mapper(items[index]!);
      }
    }),
  );
  return results;
}

async function getFilmDetails(film: {
  id: string;
  title: string;
  year: number | null;
  path: string;
}): Promise<WatchlistFilm | null> {
  const today = new Date();
  const todayIso = ukDate(today);
  const todayYear = Number(todayIso.slice(0, 4));
  const cutoff = new Date(`${todayIso}T12:00:00Z`);
  cutoff.setUTCDate(cutoff.getUTCDate() - recentReleaseDays);
  const cutoffIso = cutoff.toISOString().slice(0, 10);

  if (film.year !== null && film.year < todayYear - 1) return null;

  const html = await fetchLetterboxd(new URL(film.path, letterboxdOrigin).toString());
  const releaseDates = ukTheatricalReleaseDates(html);
  const releaseStatus: WatchlistFilm["releaseStatus"] | null =
    releaseDates.some(({ date }) => date >= todayIso)
      ? "upcoming"
      : releaseDates.some(({ date }) => date >= cutoffIso && date < todayIso)
        ? "recent"
        : releaseDates.length === 0 && film.year !== null && film.year >= todayYear
          ? "upcoming"
          : null;

  if (!releaseStatus) return null;

  const $ = cheerio.load(html);
  const rawPoster = $('meta[property="og:image"]').attr("content");
  let posterUrl: string | null = null;
  if (rawPoster) {
    try {
      const poster = new URL(rawPoster);
      if (
        poster.protocol === "https:" &&
        ["a.ltrbxd.com", "s.ltrbxd.com"].includes(poster.hostname)
      ) {
        posterUrl = poster.toString();
      }
    } catch {
      posterUrl = null;
    }
  }

  return {
    id: film.id,
    title: film.title,
    year: film.year,
    letterboxdUrl: new URL(film.path, letterboxdOrigin).toString(),
    posterUrl,
    releaseDates,
    releaseStatus,
  };
}

async function loadWatchlist(username: string): Promise<WatchlistResult> {
  const list = await getWatchlist(username);
  if (list.length === 0) {
    throw new LetterboxdError(
      "No films were found. Check the username and make sure the Letterboxd watchlist is public.",
    );
  }

  const currentYear = Number(ukDate(new Date()).slice(0, 4));
  const releaseCandidates = list.filter(
    (film) => film.year === null || film.year >= currentYear - 1,
  );
  const films = (await mapWithConcurrency(releaseCandidates, 4, getFilmDetails))
    .filter((film): film is WatchlistFilm => film !== null)
    .sort((left, right) => {
      const leftDate = left.releaseDates[0]?.date;
      const rightDate = right.releaseDates[0]?.date;
      if (!leftDate) return rightDate ? 1 : left.title.localeCompare(right.title);
      if (!rightDate) return -1;
      return leftDate.localeCompare(rightDate);
    });

  return { username, films, fetchedAt: new Date().toISOString() };
}

export async function getWatchlistResult(
  username: string,
  forceRefresh = false,
): Promise<WatchlistResult> {
  const cached = cache.get(username);
  if (!forceRefresh && cached && cached.expiresAt > Date.now()) {
    return cached.result;
  }

  let pending = pendingRequests.get(username);
  if (!pending) {
    pending = loadWatchlist(username);
    pendingRequests.set(username, pending);
  }

  try {
    const result = await pending;
    cache.set(username, { result, expiresAt: Date.now() + cacheDurationMs });
    return result;
  } finally {
    if (pendingRequests.get(username) === pending) pendingRequests.delete(username);
  }
}
