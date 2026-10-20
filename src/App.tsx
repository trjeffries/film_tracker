import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { wordlist } from "@scure/bip39/wordlists/english.js";

interface Film {
  id: string;
  title: string;
  year: number | null;
  letterboxdUrl: string;
  posterUrl: string | null;
  releaseDates: Array<{
    date: string;
    type: "previews" | "theatrical";
    market: "uk" | "us";
  }>;
  releaseStatus: "upcoming" | "recent";
}

interface WatchlistResponse {
  username: string;
  watchlistFilmIds: string[];
  films: Film[];
  fetchedAt: string;
}

interface Booking {
  booked: boolean;
  updatedAt: string;
}

type Filter = "all" | "upcoming" | "recent" | "booked";
type Bookings = Record<string, Booking>;
const usernameStorageKey = "watch-it-when:username";

interface BookingSyncResponse {
  bookedFilmIds: string[];
}

function isValidUsername(username: string): boolean {
  return /^[A-Za-z0-9_-]{1,30}$/.test(username);
}

function getSyncCodeStorageKey(username: string): string {
  return `watch-it-when:sync-code:${username.toLowerCase()}`;
}

function getSyncPromptStorageKey(username: string): string {
  return `watch-it-when:sync-prompt-dismissed:${username.toLowerCase()}`;
}

function isValidSyncCode(code: string): boolean {
  return (
    /^[A-Za-z0-9_-]{40,100}$/.test(code) ||
    /^[a-z]+(?:-[a-z]+){2}$/.test(code) ||
    /^[a-z]+(?:-[a-z]+){5}$/.test(code)
  );
}

function normalizeSyncCode(code: string): string {
  if (/^[a-z]+(?:[\s-]+[a-z]+){2}(?:[\s-]+[a-z]+){0,3}$/i.test(code.trim())) {
    return code.trim().toLowerCase().replace(/\s+/g, "-").replace(/-+/g, "-");
  }
  return code.trim();
}

function isBookingSyncResponse(value: unknown): value is BookingSyncResponse {
  return (
    isRecord(value) &&
    Array.isArray(value.bookedFilmIds) &&
    value.bookedFilmIds.every((id) => typeof id === "string")
  );
}

async function requestBookingSync(
  request: Record<string, unknown>,
): Promise<string[]> {
  const response = await fetch("/api/bookings", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
  });
  const text = await response.text();
  let payload: unknown;
  try {
    payload = JSON.parse(text);
  } catch {
    throw new Error(
      `Booking sync returned an unexpected response (HTTP ${response.status}).`,
    );
  }
  if (!response.ok) {
    throw new Error(
      isRecord(payload) && typeof payload.error === "string"
        ? payload.error
        : `Could not sync bookings (HTTP ${response.status}).`,
    );
  }
  if (!isBookingSyncResponse(payload)) {
    throw new Error("Booking sync returned data in an unexpected format.");
  }
  return payload.bookedFilmIds;
}

function bookedFilmIds(bookings: Bookings): string[] {
  return Object.entries(bookings)
    .filter(([, booking]) => booking.booked)
    .map(([filmId]) => filmId);
}

function bookingsFromFilmIds(filmIds: string[]): Bookings {
  const updatedAt = new Date().toISOString();
  return Object.fromEntries(
    filmIds.map((filmId) => [filmId, { booked: true, updatedAt }]),
  );
}

function mergeBookings(bookings: Bookings, filmIds: string[]): Bookings {
  const merged = { ...bookings };
  const updatedAt = new Date().toISOString();
  for (const filmId of filmIds) {
    if (!merged[filmId]?.booked) {
      merged[filmId] = { booked: true, updatedAt };
    }
  }
  return merged;
}

function retainWatchlistBookings(
  bookings: Bookings,
  watchlistFilmIds: string[],
): Bookings {
  const watchlist = new Set(watchlistFilmIds);
  return Object.fromEntries(
    Object.entries(bookings).filter(([filmId]) => watchlist.has(filmId)),
  );
}

function createSyncCode(): string {
  const indexes = crypto.getRandomValues(new Uint16Array(3));
  return Array.from(indexes, (index) => wordlist[index & 0x7ff]).join("-");
}

function readSavedUsername(): { username: string; error: string } {
  try {
    const username = localStorage.getItem(usernameStorageKey) ?? "";
    if (username && !isValidUsername(username)) {
      return {
        username: "",
        error:
          "The saved Letterboxd username is invalid. Please enter it again.",
      };
    }
    return { username, error: "" };
  } catch (cause) {
    return {
      username: "",
      error:
        cause instanceof Error
          ? cause.message
          : "Could not read the saved Letterboxd username.",
    };
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function isWatchlistResponse(value: unknown): value is WatchlistResponse {
  return (
    isRecord(value) &&
    typeof value.username === "string" &&
    typeof value.fetchedAt === "string" &&
    Array.isArray(value.watchlistFilmIds) &&
    value.watchlistFilmIds.every(
      (filmId) =>
        typeof filmId === "string" && /^\/film\/[a-z0-9-]+\/$/i.test(filmId),
    ) &&
    Array.isArray(value.films) &&
    value.films.every(
      (film) =>
        isRecord(film) &&
        typeof film.id === "string" &&
        typeof film.title === "string" &&
        (typeof film.year === "number" || film.year === null) &&
        typeof film.letterboxdUrl === "string" &&
        (typeof film.posterUrl === "string" || film.posterUrl === null) &&
        (film.releaseStatus === "upcoming" ||
          film.releaseStatus === "recent") &&
        Array.isArray(film.releaseDates) &&
        film.releaseDates.every(
          (release) =>
            isRecord(release) &&
            typeof release.date === "string" &&
            (release.type === "previews" || release.type === "theatrical") &&
            (release.market === "uk" || release.market === "us"),
        ),
    )
  );
}

function isBookings(value: unknown): value is Bookings {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  return Object.values(value).every(
    (booking) =>
      !!booking &&
      typeof booking === "object" &&
      "booked" in booking &&
      typeof booking.booked === "boolean" &&
      "updatedAt" in booking &&
      typeof booking.updatedAt === "string",
  );
}

function getStorageKey(username: string): string {
  return `screening-room:bookings:${username.toLowerCase()}`;
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${value}T12:00:00Z`));
}

function getUkToday(): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const values = Object.fromEntries(
    parts.map(({ type, value }) => [type, value]),
  );
  return `${values.year}-${values.month}-${values.day}`;
}

function formatShortDate(value: string): { day: string; month: string } {
  const date = new Date(`${value}T12:00:00Z`);
  return {
    day: new Intl.DateTimeFormat("en-GB", {
      day: "2-digit",
      timeZone: "UTC",
    }).format(date),
    month: new Intl.DateTimeFormat("en-GB", { month: "short", timeZone: "UTC" })
      .format(date)
      .toUpperCase(),
  };
}

function cineworldSearchUrl(title: string, year: number | null): string {
  const query = [`site:cineworld.co.uk/films`, title, year]
    .filter(Boolean)
    .join(" ");
  return `https://www.google.com/search?q=${encodeURIComponent(query)}`;
}

function formatSyncTime(value: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function Icon({
  name,
}: {
  name: "ticket" | "refresh" | "search" | "film" | "arrow";
}) {
  const common = {
    fill: "none",
    stroke: "currentColor",
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    strokeWidth: 1.7,
    viewBox: "0 0 24 24",
    "aria-hidden": true as const,
  };

  if (name === "ticket") {
    return (
      <svg {...common}>
        <path d="M4 7.5A1.5 1.5 0 0 0 5.5 6h13A1.5 1.5 0 0 0 20 7.5v2a2.5 2.5 0 0 0 0 5v2a1.5 1.5 0 0 0-1.5 1.5h-13A1.5 1.5 0 0 0 4 16.5v-2a2.5 2.5 0 0 0 0-5z" />
        <path d="M9 9v1m0 2v1m0 2v1" />
      </svg>
    );
  }
  if (name === "refresh") {
    return (
      <svg {...common}>
        <path d="M20 7v5h-5M4 17v-5h5" />
        <path d="M5.6 9A7 7 0 0 1 18 6l2 6M4 12l2 6a7 7 0 0 0 12.4-3" />
      </svg>
    );
  }
  if (name === "search") {
    return (
      <svg {...common}>
        <circle cx="10.8" cy="10.8" r="6.3" />
        <path d="m16 16 4 4" />
      </svg>
    );
  }
  if (name === "arrow") {
    return (
      <svg {...common}>
        <path d="M7 17 17 7M8 7h9v9" />
      </svg>
    );
  }
  return (
    <svg {...common}>
      <rect x="4" y="3" width="16" height="18" rx="2" />
      <path d="M8 3v18M16 3v18M4 8h4m8 0h4M4 16h4m8 0h4" />
    </svg>
  );
}

function App() {
  const [savedUsername] = useState(readSavedUsername);
  const [username, setUsername] = useState("");
  const [usernameDraft, setUsernameDraft] = useState(savedUsername.username);
  const [films, setFilms] = useState<Film[]>([]);
  const [bookings, setBookings] = useState<Bookings>({});
  const [filter, setFilter] = useState<Filter>("all");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [usernameStorageError, setUsernameStorageError] = useState(
    savedUsername.error,
  );
  const [bookingSyncCode, setBookingSyncCode] = useState("");
  const [bookingSyncCodeInput, setBookingSyncCodeInput] = useState("");
  const [bookingSyncOpen, setBookingSyncOpen] = useState(false);
  const [bookingSyncDeleteConfirm, setBookingSyncDeleteConfirm] =
    useState(false);
  const [bookingSyncPromptDismissed, setBookingSyncPromptDismissed] =
    useState(false);
  const [bookingSyncBusy, setBookingSyncBusy] = useState(false);
  const [bookingSyncError, setBookingSyncError] = useState("");
  const [bookingSyncNotice, setBookingSyncNotice] = useState("");
  const [storageError, setStorageError] = useState("");
  const [fetchedAt, setFetchedAt] = useState("");
  const usernameInput = useRef<HTMLInputElement>(null);
  const bookingSyncDialog = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = bookingSyncDialog.current;
    if (!dialog) return;
    if (bookingSyncOpen && !dialog.open) dialog.showModal();
    if (!bookingSyncOpen && dialog.open) dialog.close();
  }, [bookingSyncOpen]);

  useEffect(() => {
    if (!storageError) return;
    setBookings({});
  }, [storageError]);

  useEffect(() => {
    if (storageError || !username) return;
    try {
      localStorage.setItem(getStorageKey(username), JSON.stringify(bookings));
    } catch (cause) {
      setStorageError(
        cause instanceof Error
          ? cause.message
          : "Could not save ticket status in this browser.",
      );
    }
  }, [bookings, storageError, username]);

  async function syncWatchlist(nextUsername = username, forceRefresh = false) {
    setBookingSyncError("");
    setBookingSyncNotice("");
    try {
      localStorage.setItem(usernameStorageKey, nextUsername);
      setUsernameStorageError("");
    } catch (cause) {
      setUsernameStorageError(
        cause instanceof Error
          ? cause.message
          : "Could not save the Letterboxd username.",
      );
    }

    setLoading(true);
    setError("");
    try {
      const response = await fetch(
        `/api/watchlist?username=${encodeURIComponent(nextUsername)}&refresh=${forceRefresh}`,
      );
      const body = await response.text();
      let payload: unknown;
      try {
        payload = JSON.parse(body);
      } catch {
        if (!response.ok) {
          throw new Error(
            `Watchlist service returned an unexpected response (HTTP ${response.status}). Check the Vercel function logs, then try syncing again.`,
          );
        }
        throw new Error(
          "Watchlist service returned invalid data. Please try syncing again.",
        );
      }

      if (!response.ok) {
        const message =
          isRecord(payload) && typeof payload.error === "string"
            ? payload.error
            : `Could not load this Letterboxd watchlist (HTTP ${response.status}).`;
        throw new Error(message);
      }
      if (!isWatchlistResponse(payload)) {
        throw new Error(
          "Watchlist service returned data in an unexpected format.",
        );
      }
      const result = payload;
      let restoredBookings: Bookings = {};
      let savedSyncCode = "";
      let syncPromptDismissed = false;
      try {
        const savedBookings = localStorage.getItem(getStorageKey(nextUsername));
        const parsed: unknown = savedBookings ? JSON.parse(savedBookings) : {};
        if (!isBookings(parsed)) {
          throw new Error("Saved ticket status is not in the expected format.");
        }
        restoredBookings = parsed;
        setStorageError("");
      } catch (cause) {
        setStorageError(
          cause instanceof Error
            ? cause.message
            : "Could not read saved ticket status.",
        );
      }

      restoredBookings = retainWatchlistBookings(
        restoredBookings,
        result.watchlistFilmIds,
      );

      try {
        syncPromptDismissed =
          localStorage.getItem(getSyncPromptStorageKey(nextUsername)) ===
          "true";
      } catch (cause) {
        setBookingSyncOpen(true);
        setBookingSyncError(
          cause instanceof Error
            ? `Could not read the sync prompt preference: ${cause.message}`
            : "Could not read the sync prompt preference.",
        );
      }

      try {
        savedSyncCode =
          localStorage.getItem(getSyncCodeStorageKey(nextUsername)) ?? "";
      } catch (cause) {
        setBookingSyncOpen(true);
        setBookingSyncError(
          cause instanceof Error
            ? `Could not read the saved sync code: ${cause.message}`
            : "Could not read the saved sync code.",
        );
      }

      if (savedSyncCode) {
        setBookingSyncCode(savedSyncCode);
        if (!isValidSyncCode(savedSyncCode)) {
          setBookingSyncOpen(true);
          setBookingSyncError(
            "The saved sync code is invalid. Reconnect bookings to continue.",
          );
        } else {
          try {
            const remoteFilmIds = await requestBookingSync({
              action: "reconcile",
              username: nextUsername,
              code: savedSyncCode,
              watchlistFilmIds: result.watchlistFilmIds,
            });
            restoredBookings = bookingsFromFilmIds(remoteFilmIds);
            setBookingSyncError("");
          } catch (cause) {
            setBookingSyncOpen(true);
            setBookingSyncError(
              cause instanceof Error
                ? cause.message
                : "Could not load server-side bookings.",
            );
          }
        }
      } else {
        setBookingSyncCode("");
        setBookingSyncError("");
      }

      setBookingSyncPromptDismissed(
        syncPromptDismissed || Boolean(savedSyncCode),
      );
      setUsername(nextUsername);
      setUsernameDraft(nextUsername);
      setFilms(result.films);
      setBookings(restoredBookings);
      setFetchedAt(result.fetchedAt);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Could not sync the watchlist.",
      );
    } finally {
      setLoading(false);
    }
  }

  const initialSyncStarted = useRef(false);
  useEffect(() => {
    if (!savedUsername.username || initialSyncStarted.current) return;
    initialSyncStarted.current = true;
    void syncWatchlist(savedUsername.username);
  }, []);

  function handleUsernameSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const cleaned = usernameDraft.trim();
    if (!cleaned) {
      setError("");
      usernameInput.current?.focus();
      return;
    }
    if (!isValidUsername(cleaned)) {
      setError("Enter a valid Letterboxd username.");
      return;
    }
    void syncWatchlist(cleaned, true);
  }

  function storeSyncCode(code: string) {
    setBookingSyncCode(code);
    setBookingSyncPromptDismissed(true);
    try {
      localStorage.setItem(getSyncCodeStorageKey(username), code);
      localStorage.setItem(getSyncPromptStorageKey(username), "true");
      setBookingSyncError("");
    } catch (cause) {
      setBookingSyncOpen(true);
      setBookingSyncError(
        cause instanceof Error
          ? `Sync is active for this visit, but the code could not be saved in this browser: ${cause.message}`
          : "Sync is active for this visit, but the code could not be saved in this browser.",
      );
    }
  }

  function dismissBookingSyncPrompt(openSetup = false) {
    setBookingSyncPromptDismissed(true);
    if (openSetup) setBookingSyncOpen(true);
    try {
      localStorage.setItem(getSyncPromptStorageKey(username), "true");
    } catch (cause) {
      setBookingSyncOpen(true);
      setBookingSyncError(
        cause instanceof Error
          ? `The sync prompt could not be dismissed on this device: ${cause.message}`
          : "The sync prompt could not be dismissed on this device.",
      );
    }
  }

  async function createBookingsSync() {
    if (!username || bookingSyncBusy) return;
    const code = createSyncCode();
    setBookingSyncBusy(true);
    setBookingSyncError("");
    setBookingSyncNotice("");
    try {
      const filmIds = await requestBookingSync({
        action: "create",
        username,
        code,
        filmIds: bookedFilmIds(bookings),
      });
      setBookings(mergeBookings(bookings, filmIds));
      storeSyncCode(code);
      setBookingSyncOpen(true);
      setBookingSyncNotice(
        "Sync code created. Save it to connect another device.",
      );
    } catch (cause) {
      setBookingSyncError(
        cause instanceof Error
          ? cause.message
          : "Could not create booking sync.",
      );
    } finally {
      setBookingSyncBusy(false);
    }
  }

  async function connectBookingsSync(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const code = normalizeSyncCode(bookingSyncCodeInput);
    if (!username || bookingSyncBusy) return;
    if (!isValidSyncCode(code)) {
      setBookingSyncError(
        "Enter the three-word phrase or complete sync code from your other device.",
      );
      return;
    }

    setBookingSyncBusy(true);
    setBookingSyncError("");
    setBookingSyncNotice("");
    try {
      const filmIds = await requestBookingSync({
        action: "connect",
        username,
        code,
        filmIds: bookedFilmIds(bookings),
      });
      setBookings(mergeBookings(bookings, filmIds));
      storeSyncCode(code);
      setBookingSyncCodeInput("");
      setBookingSyncNotice("Bookings connected and merged with this browser.");
    } catch (cause) {
      setBookingSyncError(
        cause instanceof Error ? cause.message : "Could not connect bookings.",
      );
    } finally {
      setBookingSyncBusy(false);
    }
  }

  async function deleteBookingsSync() {
    if (!username || !bookingSyncCode || bookingSyncBusy) return;
    setBookingSyncBusy(true);
    setBookingSyncError("");
    setBookingSyncNotice("");
    try {
      await requestBookingSync({
        action: "delete",
        username,
        code: bookingSyncCode,
      });
      setBookingSyncCode("");
      setBookingSyncDeleteConfirm(false);
      setBookingSyncNotice(
        "Server bookings deleted. Bookings saved on this device are unchanged.",
      );
      try {
        localStorage.removeItem(getSyncCodeStorageKey(username));
      } catch (cause) {
        setBookingSyncError(
          cause instanceof Error
            ? `Server bookings were deleted, but the saved sync phrase could not be removed from this device: ${cause.message}`
            : "Server bookings were deleted, but the saved sync phrase could not be removed from this device.",
        );
      }
    } catch (cause) {
      setBookingSyncError(
        cause instanceof Error
          ? cause.message
          : "Could not delete server-side bookings.",
      );
    } finally {
      setBookingSyncBusy(false);
    }
  }

  async function copyBookingsSyncCode() {
    try {
      await navigator.clipboard.writeText(bookingSyncCode);
      setBookingSyncNotice("Sync code copied.");
      setBookingSyncError("");
    } catch {
      setBookingSyncError(
        "Could not copy the code. Select and copy it manually.",
      );
    }
  }

  function toggleBooked(filmId: string) {
    const booked = !bookings[filmId]?.booked;
    setBookings((current) => ({
      ...current,
      [filmId]: {
        booked,
        updatedAt: new Date().toISOString(),
      },
    }));
    if (bookingSyncCode && username) {
      setBookingSyncError("");
      void requestBookingSync({
        action: "set",
        username,
        code: bookingSyncCode,
        filmId,
        booked,
      }).catch((cause: unknown) => {
        setBookingSyncOpen(true);
        setBookingSyncError(
          cause instanceof Error
            ? cause.message
            : "Could not update server-side bookings.",
        );
      });
    }
  }

  const bookedCount = films.filter((film) => bookings[film.id]?.booked).length;
  const upcomingCount = films.filter(
    (film) => film.releaseStatus === "upcoming",
  ).length;
  const recentCount = films.filter(
    (film) => film.releaseStatus === "recent",
  ).length;
  const today = getUkToday();
  const bookingWindowStart = new Date(`${today}T12:00:00Z`);
  bookingWindowStart.setUTCDate(bookingWindowStart.getUTCDate() - 30);
  const bookingWindowStartIso = bookingWindowStart.toISOString().slice(0, 10);
  const bookingWindowEnd = new Date(`${today}T12:00:00Z`);
  bookingWindowEnd.setUTCDate(bookingWindowEnd.getUTCDate() + 30);
  const bookingWindowEndIso = bookingWindowEnd.toISOString().slice(0, 10);

  const visibleFilms = useMemo(() => {
    const query = search.trim().toLowerCase();
    return films.filter((film) => {
      const matchesFilter =
        filter === "all" ||
        (filter === "booked" && bookings[film.id]?.booked) ||
        film.releaseStatus === filter;
      const matchesSearch =
        !query ||
        film.title.toLowerCase().includes(query) ||
        String(film.year ?? "").includes(query);
      return matchesFilter && matchesSearch;
    });
  }, [bookings, films, filter, search]);

  return (
    <>
      <main className="app-shell">
        <div className="ambient ambient-one" aria-hidden="true" />
        <div className="ambient ambient-two" aria-hidden="true" />

        <header className="topbar">
          <a className="brand" href="/" aria-label="Watch It When home">
            <span className="brand-mark">
              <Icon name="film" />
            </span>
            <span>WATCH IT WHEN</span>
          </a>
          <p className="eyebrow">
            <span /> YOUR WATCHLIST, ON THE BIG SCREEN
          </p>
          <section className="watchlist-tools" aria-label="Watchlist controls">
            <form className="sync-form" onSubmit={handleUsernameSubmit}>
              <div className="username-control">
                <span className="at-sign">@</span>
                <input
                  id="letterboxd-username"
                  ref={usernameInput}
                  aria-label="Letterboxd username"
                  autoCapitalize="none"
                  autoComplete="off"
                  placeholder="Letterboxd username"
                  value={usernameDraft}
                  onChange={(event) => setUsernameDraft(event.target.value)}
                />
                <button
                  className="sync-button"
                  type="submit"
                  disabled={loading}
                >
                  <Icon name="refresh" />
                  {loading ? "Syncing" : username ? "Sync" : "Load watchlist"}
                </button>
              </div>
            </form>
            <div className="sync-meta">
              {fetchedAt && (
                <>
                  <span
                    className={
                      loading ? "sync-indicator is-loading" : "sync-indicator"
                    }
                  />
                  <span className="sync-meta-label">
                    {loading
                      ? "Syncing…"
                      : (
                        formatSyncTime(fetchedAt)
                      )}
                  </span>
                </>
              )}
            </div>
          </section>
          <div className="header-links">
            {username && (
              <a
                className="letterboxd-link"
                href={`https://letterboxd.com/${encodeURIComponent(username)}/watchlist/`}
                target="_blank"
                rel="noreferrer"
              >
                WATCHLIST ON LETTERBOXD
                <Icon name="arrow" />
              </a>
            )}
            <a
              className="letterboxd-link"
              href="https://www.imdb.com/calendar/?region=GB"
              target="_blank"
              rel="noreferrer"
            >
              UK RELEASES ON IMDB
              <Icon name="arrow" />
            </a>
          </div>
        </header>

        {error && (
          <div className="message message-error" role="alert">
            <span className="message-icon">!</span>
            <span>{error}</span>
            <button
              type="button"
              onClick={() =>
                void syncWatchlist(username || usernameDraft, true)
              }
              aria-label="Try syncing again"
            >
              Try again
            </button>
          </div>
        )}
        {usernameStorageError && (
          <div className="message message-error" role="alert">
            <span className="message-icon">!</span>
            <span>
              Saved username could not be stored: {usernameStorageError}
            </span>
          </div>
        )}
        {storageError && (
          <div className="message message-error" role="alert">
            <span className="message-icon">!</span>
            <span>Ticket status could not be saved: {storageError}</span>
          </div>
        )}

        <section className="films-section">
          <div className="section-heading">
            <label className="search-control">
              <Icon name="search" />
              <input
                aria-label="Search films"
                placeholder="Find a film"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
              {search && (
                <button
                  type="button"
                  onClick={() => setSearch("")}
                  aria-label="Clear search"
                >
                  ×
                </button>
              )}
            </label>
          </div>

          {username && !bookingSyncPromptDismissed && !bookingSyncCode && (
            <section
              className="booking-sync-prompt"
              aria-label="Booking sync option"
            >
              <span>Bookings are saved on this device</span>
              <button
                className="booking-sync-prompt-action"
                type="button"
                onClick={() => dismissBookingSyncPrompt(true)}
              >
                Sync across devices
              </button>
              <button
                className="booking-sync-dismiss"
                type="button"
                aria-label="Dismiss sync prompt"
                onClick={() => dismissBookingSyncPrompt()}
              >
                ×
              </button>
            </section>
          )}

          {loading && films.length === 0 ? (
            <div className="loading-state">
              <span className="loading-spinner" />
              <p>Looking ahead at your watchlist…</p>
              <span>Finding UK cinema dates on Letterboxd</span>
            </div>
          ) : visibleFilms.length === 0 ? (
            <div
              className={username ? "empty-state" : "empty-state is-welcome"}
            >
              <div className="empty-icon">
                <Icon name="film" />
              </div>
              <h3>
                {!username
                  ? "Your next film night starts here."
                  : films.length === 0
                    ? "No recent releases found."
                    : "Nothing on this reel."}
              </h3>
              <p>
                {!username
                  ? "Enter your Letterboxd username above to see upcoming and recently released films."
                  : films.length === 0
                    ? "We couldn’t find upcoming or recently released UK cinema dates in this watchlist."
                    : search
                      ? "Try another title or clear your search."
                      : "No films match this view right now. Check back after your next sync."}
              </p>
              {username && films.length === 0 && (
                <button
                  className="empty-action"
                  type="button"
                  onClick={() => void syncWatchlist(username, true)}
                >
                  <Icon name="refresh" /> Sync {username}’s watchlist
                </button>
              )}
            </div>
          ) : (
            <div className="film-grid">
              {visibleFilms.map((film, index) => {
                const booking = bookings[film.id]?.booked ?? false;
                const hasUpcomingUkRelease = film.releaseDates.some(
                  (release) =>
                    release.market === "uk" &&
                    release.date >= bookingWindowStartIso &&
                    release.date <= bookingWindowEndIso,
                );
                const releaseMarket = film.releaseDates[0]?.market;
                const previewRelease = film.releaseDates.find(
                  (release) =>
                    release.market === releaseMarket &&
                    release.type === "previews",
                );
                const theatricalRelease = film.releaseDates.find(
                  (release) =>
                    release.market === releaseMarket &&
                    release.type === "theatrical",
                );
                const primaryRelease =
                  previewRelease &&
                  theatricalRelease &&
                  previewRelease.date < today
                    ? theatricalRelease
                    : (previewRelease ??
                      theatricalRelease ??
                      film.releaseDates[0]);
                const hasTheatricalRelease = film.releaseDates.some(
                  (release) =>
                    release.market === primaryRelease?.market &&
                    release.type === "theatrical",
                );
                const dateBadge = primaryRelease
                  ? formatShortDate(primaryRelease.date)
                  : null;
                const dateStampClass =
                  primaryRelease?.market === "us"
                    ? "date-stamp is-neutral"
                    : primaryRelease && primaryRelease.date <= today
                      ? "date-stamp"
                      : "date-stamp is-upcoming";
                return (
                  <article
                    className="film-card"
                    key={film.id}
                    style={{ animationDelay: `${index * 35}ms` }}
                  >
                    <div className="poster-wrap">
                      {film.posterUrl ? (
                        <img
                          className="poster-image"
                          src={film.posterUrl}
                          alt=""
                          loading="lazy"
                        />
                      ) : (
                        <div
                          className={`poster-fallback poster-tone-${index % 5}`}
                          aria-hidden="true"
                        >
                          <Icon name="film" />
                          <span>{film.title.slice(0, 1)}</span>
                        </div>
                      )}
                      <div className="poster-shade" />
                      <div className={dateStampClass}>
                        {dateBadge ? (
                          <>
                            <span>{dateBadge.month}</span>
                            <strong>{dateBadge.day}</strong>
                          </>
                        ) : (
                          <>
                            <span>UK DATE</span>
                            <strong>—</strong>
                          </>
                        )}
                      </div>
                      {booking && (
                        <span className="booked-ribbon">
                          <Icon name="ticket" /> BOOKED
                        </span>
                      )}
                    </div>
                    <div className="film-info">
                      <div className="film-title-row">
                        <h3>
                          <a
                            className="film-title-link"
                            href={film.letterboxdUrl}
                            target="_blank"
                            rel="noreferrer"
                          >
                            {film.title}
                          </a>
                        </h3>
                      </div>
                      <p className="release-line">
                        {film.releaseDates.length > 0 ? (
                          <>
                            {film.releaseDates[0]?.market === "us" && (
                              <span className="release-date is-neutral">
                                UK release not yet scheduled
                              </span>
                            )}
                            {film.releaseDates.map((release) => (
                              <span
                                className={
                                  release.market === "us"
                                    ? "release-date is-neutral"
                                    : release.date <= today
                                      ? "release-date is-released"
                                      : "release-date is-upcoming"
                                }
                                key={`${release.market}-${release.type}-${release.date}`}
                              >
                                <strong>
                                  {release.market === "us"
                                    ? "US release"
                                    : release.type === "previews"
                                      ? hasTheatricalRelease
                                        ? "Previews"
                                        : "Limited"
                                      : "Theatrical"}
                                </strong>{" "}
                                {formatDate(release.date)}
                              </span>
                            ))}
                          </>
                        ) : (
                          <span className="release-date is-upcoming">
                            UK release not yet scheduled
                            {film.year ? ` · ${film.year}` : ""}
                          </span>
                        )}
                      </p>
                      <div className="film-actions">
                        <button
                          className={
                            booking
                              ? "booking-button is-booked"
                              : "booking-button"
                          }
                          type="button"
                          onClick={() => toggleBooked(film.id)}
                          aria-pressed={booking}
                        >
                          <Icon name="ticket" />
                          {booking ? "Tickets booked" : "Mark as booked"}
                        </button>
                        {!booking && hasUpcomingUkRelease && (
                          <a
                            className="booking-link"
                            href={cineworldSearchUrl(film.title, film.year)}
                            target="_blank"
                            rel="noreferrer"
                          >
                            Find tickets
                            <Icon name="arrow" />
                          </a>
                        )}
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </section>

        <footer className="footer">
          {username && (
            <section className="booking-sync" aria-label="Manage booking sync">
              <button
                className="booking-sync-manage"
                type="button"
                aria-expanded={bookingSyncOpen}
                onClick={() => setBookingSyncOpen((open) => !open)}
              >
                {bookingSyncOpen ? "Close" : "Manage sync"}
              </button>
              <dialog
                ref={bookingSyncDialog}
                className="booking-sync-panel"
                aria-labelledby="booking-sync-dialog-title"
                onClose={() => setBookingSyncOpen(false)}
              >
                <div className="booking-sync-dialog-heading">
                  <h2 id="booking-sync-dialog-title">Sync bookings across devices</h2>
                  <button
                    type="button"
                    onClick={() => {
                      bookingSyncDialog.current?.close();
                      setBookingSyncOpen(false);
                    }}
                  >
                    Close
                  </button>
                </div>
                  {bookingSyncCode ? (
                    <>
                      <p>
                        Use this private phrase or code with the Letterboxd
                        username <strong>{username}</strong> on another device.
                        Anyone with both can access these bookings.
                      </p>
                      <div className="booking-sync-code">
                        <code>{bookingSyncCode}</code>
                      </div>
                      <div className="booking-sync-actions">
                        <button
                          type="button"
                          onClick={() => void copyBookingsSyncCode()}
                        >
                          Copy sync key
                        </button>
                        <button
                          type="button"
                          onClick={() => setBookingSyncDeleteConfirm(true)}
                        >
                          Delete server data
                        </button>
                      </div>
                      {bookingSyncDeleteConfirm && (
                        <div
                          className="booking-sync-delete-confirm"
                          role="alert"
                        >
                          <p>
                            This permanently deletes the synced bookings from
                            the server and removes the saved phrase on this
                            device. Bookings currently on this device stay here.
                            Other devices keep their synced data, but their
                            saved phrase will no longer sync.
                          </p>
                          <div className="booking-sync-actions">
                            <button
                              type="button"
                              disabled={bookingSyncBusy}
                              onClick={() => setBookingSyncDeleteConfirm(false)}
                            >
                              Cancel
                            </button>
                            <button
                              className="booking-sync-delete"
                              type="button"
                              disabled={bookingSyncBusy}
                              onClick={() => void deleteBookingsSync()}
                            >
                              {bookingSyncBusy
                                ? "Deleting…"
                                : "Permanently delete"}
                            </button>
                          </div>
                        </div>
                      )}
                    </>
                  ) : (
                    <>
                      <p>
                        Create a private three-word phrase to sync your booked
                        films with another device, or enter a phrase or code you
                        already have. Existing bookings will be merged.
                      </p>
                      <button
                        className="booking-sync-primary"
                        type="button"
                        disabled={bookingSyncBusy}
                        onClick={() => void createBookingsSync()}
                      >
                        {bookingSyncBusy
                          ? "Setting up…"
                          : "Create a new sync code"}
                      </button>
                      <form
                        className="booking-sync-connect"
                        onSubmit={(event) => void connectBookingsSync(event)}
                      >
                        <label htmlFor="booking-sync-code">
                          ALREADY HAVE A SYNC CODE?
                        </label>
                        <div>
                          <input
                            id="booking-sync-code"
                            autoCapitalize="none"
                            autoComplete="off"
                            value={bookingSyncCodeInput}
                            onChange={(event) =>
                              setBookingSyncCodeInput(event.target.value)
                            }
                            placeholder="Enter your private phrase or code"
                          />
                          <button type="submit" disabled={bookingSyncBusy}>
                            Connect
                          </button>
                        </div>
                      </form>
                    </>
                  )}
                  {bookingSyncBusy && bookingSyncCode && (
                    <p role="status">Updating bookings…</p>
                  )}
                  {bookingSyncError && (
                    <p className="booking-sync-error" role="alert">
                      {bookingSyncError}
                    </p>
                  )}
                  {bookingSyncNotice && (
                    <p className="booking-sync-notice" role="status">
                      {bookingSyncNotice}
                    </p>
                  )}
              </dialog>
            </section>
          )}
          <div className="footer-column footer-links">
            <a
              href="https://letterboxd.com/trjeffries/"
              target="_blank"
              rel="noreferrer"
            >
              FOLLOW ME ON LETTERBOXD
              <Icon name="arrow" />
            </a>
            <a
              href="https://github.com/trjeffries/film_tracker"
              target="_blank"
              rel="noreferrer"
            >
              VIEW PROJECT ON GITHUB
              <Icon name="arrow" />
            </a>
          </div>
        </footer>
      </main>
      <section className="stats" aria-label="Watchlist summary">
        <div className="stats-inner" role="group" aria-label="Filter films">
          <button
            className={filter === "all" ? "stat-card is-active" : "stat-card"}
            type="button"
            aria-pressed={filter === "all"}
            onClick={() => setFilter("all")}
          >
            <span className="stat-label">ALL FILMS</span>
            <span className="stat-value">
              {loading ? "—" : films.length.toString().padStart(2, "0")}
            </span>
            <span className="stat-footnote">Entire watchlist</span>
          </button>
          <button
            className={
              filter === "upcoming" ? "stat-card is-active" : "stat-card"
            }
            type="button"
            aria-pressed={filter === "upcoming"}
            onClick={() => setFilter("upcoming")}
          >
            <span className="stat-label">ON THE WAY</span>
            <span className="stat-value">
              {loading ? "—" : upcomingCount.toString().padStart(2, "0")}
            </span>
            <span className="stat-footnote">
              <span className="stat-dot dot-green" /> Releases ahead
            </span>
          </button>
          <button
            className={
              filter === "recent" ? "stat-card is-active" : "stat-card"
            }
            type="button"
            aria-pressed={filter === "recent"}
            onClick={() => setFilter("recent")}
          >
            <span className="stat-label">JUST RELEASED</span>
            <span className="stat-value">
              {loading ? "—" : recentCount.toString().padStart(2, "0")}
            </span>
            <span className="stat-footnote">
              <span className="stat-dot dot-coral" /> In the last 30 days
            </span>
          </button>
          <button
            className={
              filter === "booked"
                ? "stat-card stat-booked is-active"
                : "stat-card stat-booked"
            }
            type="button"
            aria-pressed={filter === "booked"}
            onClick={() => setFilter("booked")}
          >
            <span className="stat-label">YOUR SEATS</span>
            <span className="stat-value">
              {bookedCount.toString().padStart(2, "0")}
            </span>
            <span className="stat-footnote">
              <Icon name="ticket" /> Marked as booked
            </span>
          </button>
        </div>
      </section>
    </>
  );
}

export default App;
