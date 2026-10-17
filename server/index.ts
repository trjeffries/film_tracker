import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import * as cheerio from "cheerio";

interface WatchlistFilm {
  id: string;
  title: string;
  year: number | null;
  letterboxdUrl: string;
  posterUrl: string | null;
  releaseDate: string | null;
  releaseStatus: "upcoming" | "recent";
}

interface WatchlistResult {
  username: string;
  films: WatchlistFilm[];
  fetchedAt: string;
}

const app = express();
const port = Number(process.env.PORT ?? 3001);
const cache = new Map<string, { expiresAt: number; result: WatchlistResult }>();
const pendingRequests = new Map<string, Promise<WatchlistResult>>();
const cacheDurationMs = 15 * 60 * 1000;
const recentReleaseDays = 90;
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

function ukTheatricalReleaseDate(html: string): string | null {
  const $ = cheerio.load(html);
  const theatricalHeading = $("h3.release-table-title")
    .filter((_, element) => $(element).text().trim().toLowerCase() === "theatrical")
    .first();
  if (!theatricalHeading.length) return null;

  const releaseGroup = theatricalHeading.closest(".release-table-group");
  const dates: string[] = [];
  releaseGroup.find(".release-table.-bydate > .listitem").each((_, row) => {
    const countries = $(row)
      .find(".release-country .name")
      .toArray()
      .map((country) => $(country).text().trim().toLowerCase());
    if (!countries.some((country) => ["united kingdom", "uk", "great britain"].includes(country))) {
      return;
    }

    const dateText = $(row).find(".date").first().text().trim();
    const date = parseLetterboxdDate(dateText);
    if (date) dates.push(date);
  });

  return dates.sort()[0] ?? null;
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
  const releaseDate = ukTheatricalReleaseDate(html);
  const status: WatchlistFilm["releaseStatus"] | null =
    releaseDate && releaseDate >= todayIso
      ? "upcoming"
      : releaseDate && releaseDate >= cutoffIso
        ? "recent"
        : !releaseDate && film.year !== null && film.year >= todayYear
          ? "upcoming"
          : null;

  if (!status) return null;

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
    releaseDate,
    releaseStatus: status,
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
      if (!left.releaseDate) return right.releaseDate ? 1 : left.title.localeCompare(right.title);
      if (!right.releaseDate) return -1;
      return left.releaseDate.localeCompare(right.releaseDate);
    });

  return { username, films, fetchedAt: new Date().toISOString() };
}

app.get("/api/watchlist", async (request, response) => {
  const username = String(request.query.username ?? "").trim();
  if (!/^[A-Za-z0-9_-]{1,30}$/.test(username)) {
    response.status(400).json({ error: "Enter a valid Letterboxd username." });
    return;
  }

  const cached = cache.get(username);
  const forceRefresh = request.query.refresh === "true";
  if (!forceRefresh && cached && cached.expiresAt > Date.now()) {
    response.json(cached.result);
    return;
  }

  let pending = pendingRequests.get(username);
  if (!pending) {
    pending = loadWatchlist(username);
    pendingRequests.set(username, pending);
  }

  try {
    const result = await pending;
    cache.set(username, { result, expiresAt: Date.now() + cacheDurationMs });
    response.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected Letterboxd error.";
    response.status(502).json({ error: message });
  } finally {
    if (pendingRequests.get(username) === pending) pendingRequests.delete(username);
  }
});

const projectDirectory = path.dirname(fileURLToPath(import.meta.url));
const clientBuild = path.resolve(projectDirectory, "../dist");

if (existsSync(clientBuild)) {
  app.use(express.static(clientBuild));
  app.get("/{*path}", (_request, response) => {
    response.sendFile(path.join(clientBuild, "index.html"));
  });
}

app.listen(port, () => {
  console.log(`Film tracker API listening on http://localhost:${port}`);
});
