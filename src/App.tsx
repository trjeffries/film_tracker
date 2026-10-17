import { FormEvent, useEffect, useMemo, useRef, useState } from "react";

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
  films: Film[];
  fetchedAt: string;
}

interface Booking {
  booked: boolean;
  updatedAt: string;
}

type Filter = "all" | "upcoming" | "recent" | "booked";
type Bookings = Record<string, Booking>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function isWatchlistResponse(value: unknown): value is WatchlistResponse {
  return (
    isRecord(value) &&
    typeof value.username === "string" &&
    typeof value.fetchedAt === "string" &&
    Array.isArray(value.films) &&
    value.films.every(
      (film) =>
        isRecord(film) &&
        typeof film.id === "string" &&
        typeof film.title === "string" &&
        (typeof film.year === "number" || film.year === null) &&
        typeof film.letterboxdUrl === "string" &&
        (typeof film.posterUrl === "string" || film.posterUrl === null) &&
        (film.releaseStatus === "upcoming" || film.releaseStatus === "recent") &&
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
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function formatShortDate(value: string): { day: string; month: string } {
  const date = new Date(`${value}T12:00:00Z`);
  return {
    day: new Intl.DateTimeFormat("en-GB", { day: "2-digit", timeZone: "UTC" }).format(date),
    month: new Intl.DateTimeFormat("en-GB", { month: "short", timeZone: "UTC" })
      .format(date)
      .toUpperCase(),
  };
}

function formatSyncTime(value: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function Icon({ name }: { name: "ticket" | "refresh" | "search" | "film" | "arrow" }) {
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
  const [username, setUsername] = useState("");
  const [usernameDraft, setUsernameDraft] = useState("");
  const [films, setFilms] = useState<Film[]>([]);
  const [bookings, setBookings] = useState<Bookings>({});
  const [filter, setFilter] = useState<Filter>("all");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [storageError, setStorageError] = useState("");
  const [fetchedAt, setFetchedAt] = useState("");
  const usernameInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!username) {
      setBookings({});
      setStorageError("");
      return;
    }

    try {
      const saved = localStorage.getItem(getStorageKey(username));
      const parsed: unknown = saved ? JSON.parse(saved) : {};
      if (!isBookings(parsed)) {
        throw new Error("Saved ticket status is not in the expected format.");
      }
      setBookings(parsed);
      setStorageError("");
    } catch (cause) {
      setStorageError(
        cause instanceof Error ? cause.message : "Could not read saved ticket status.",
      );
    }
  }, [username]);

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
        cause instanceof Error ? cause.message : "Could not save ticket status in this browser.",
      );
    }
  }, [bookings, storageError, username]);

  async function syncWatchlist(nextUsername = username, forceRefresh = false) {
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
        throw new Error("Watchlist service returned invalid data. Please try syncing again.");
      }

      if (!response.ok) {
        const message =
          isRecord(payload) && typeof payload.error === "string"
            ? payload.error
            : `Could not load this Letterboxd watchlist (HTTP ${response.status}).`;
        throw new Error(message);
      }
      if (!isWatchlistResponse(payload)) {
        throw new Error("Watchlist service returned data in an unexpected format.");
      }
      const result = payload;
      setUsername(nextUsername);
      setUsernameDraft(nextUsername);
      setFilms(result.films);
      setFetchedAt(result.fetchedAt);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not sync the watchlist.");
    } finally {
      setLoading(false);
    }
  }

  function handleUsernameSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const cleaned = usernameDraft.trim();
    if (!cleaned) {
      setError("");
      usernameInput.current?.focus();
      return;
    }
    if (!/^[A-Za-z0-9_-]{1,30}$/.test(cleaned)) {
      setError("Enter a valid Letterboxd username.");
      return;
    }
    void syncWatchlist(cleaned, true);
  }

  function toggleBooked(filmId: string) {
    setBookings((current) => ({
      ...current,
      [filmId]: {
        booked: !current[filmId]?.booked,
        updatedAt: new Date().toISOString(),
      },
    }));
  }

  const bookedCount = films.filter((film) => bookings[film.id]?.booked).length;
  const upcomingCount = films.filter((film) => film.releaseStatus === "upcoming").length;
  const recentCount = films.filter((film) => film.releaseStatus === "recent").length;
  const today = getUkToday();

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
          <span className="brand-mark"><Icon name="film" /></span>
          <span>WATCH IT WHEN</span>
        </a>
        <section className="watchlist-tools" aria-label="Watchlist controls">
          <form className="sync-form" onSubmit={handleUsernameSubmit}>
            <label htmlFor="letterboxd-username">LETTERBOXD USERNAME</label>
            <div className="username-control">
              <span className="at-sign">@</span>
              <input
                id="letterboxd-username"
                ref={usernameInput}
                autoCapitalize="none"
                autoComplete="off"
                placeholder="Enter username"
                value={usernameDraft}
                onChange={(event) => setUsernameDraft(event.target.value)}
              />
              <button className="sync-button" type="submit" disabled={loading}>
                <Icon name="refresh" />
                {loading ? "Syncing" : username ? "Sync" : "Load watchlist"}
              </button>
            </div>
          </form>
          <div className="sync-meta">
            <span className={loading ? "sync-indicator is-loading" : "sync-indicator"} />
            <span>
              {loading ? "Syncing…" : fetchedAt ? `Synced ${formatSyncTime(fetchedAt)}` : "Ready to sync"}
            </span>
            <span className="market-label">UK</span>
          </div>
        </section>
        {username && (
          <a
            className="letterboxd-link"
            href={`https://letterboxd.com/${encodeURIComponent(username)}/watchlist/`}
            target="_blank"
            rel="noreferrer"
          >
            <span className="status-dot" />
            LETTERBOXD WATCHLIST
            <Icon name="arrow" />
          </a>
        )}
      </header>

      <section className="intro">
        <div className="intro-copy">
          <p className="eyebrow"><span /> YOUR WATCHLIST, ON THE BIG SCREEN</p>
          <h1>Good things <em>are coming.</em></h1>
        </div>
      </section>

      {error && (
        <div className="message message-error" role="alert">
          <span className="message-icon">!</span>
          <span>{error}</span>
          <button type="button" onClick={() => void syncWatchlist(username, true)} aria-label="Try syncing again">Try again</button>
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
              <button type="button" onClick={() => setSearch("")} aria-label="Clear search">×</button>
            )}
          </label>
        </div>

        {loading && films.length === 0 ? (
          <div className="loading-state">
            <span className="loading-spinner" />
            <p>Looking ahead at your watchlist…</p>
            <span>Finding UK cinema dates on Letterboxd</span>
          </div>
        ) : visibleFilms.length === 0 ? (
          <div className={username ? "empty-state" : "empty-state is-welcome"}>
            <div className="empty-icon"><Icon name="film" /></div>
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
              <button className="empty-action" type="button" onClick={() => void syncWatchlist(username, true)}>
                <Icon name="refresh" /> Sync {username}’s watchlist
              </button>
            )}
          </div>
        ) : (
          <div className="film-grid">
            {visibleFilms.map((film, index) => {
              const booking = bookings[film.id]?.booked ?? false;
              const primaryRelease = film.releaseDates[0];
              const dateBadge = primaryRelease ? formatShortDate(primaryRelease.date) : null;
              const dateStampClass = primaryRelease?.market === "us"
                ? "date-stamp is-neutral"
                : primaryRelease && primaryRelease.date <= today
                  ? "date-stamp"
                  : "date-stamp is-upcoming";
              return (
                <article className="film-card" key={film.id} style={{ animationDelay: `${index * 35}ms` }}>
                  <div className="poster-wrap">
                    {film.posterUrl ? (
                      <img className="poster-image" src={film.posterUrl} alt="" loading="lazy" />
                    ) : (
                      <div className={`poster-fallback poster-tone-${index % 5}`} aria-hidden="true">
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
                        <><span>UK DATE</span><strong>—</strong></>
                      )}
                    </div>
                    {booking && <span className="booked-ribbon"><Icon name="ticket" /> BOOKED</span>}
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
                      {film.releaseDates.length > 0
                        ? (
                          <>
                            {film.releaseDates[0]?.market === "us" && (
                              <span className="release-date is-neutral">
                                UK release date to be announced{film.year ? ` · ${film.year}` : ""}
                              </span>
                            )}
                            {film.releaseDates.map((release) => (
                              <span
                                className={release.market === "us"
                                  ? "release-date is-neutral"
                                  : release.date <= today
                                    ? "release-date is-released"
                                    : "release-date is-upcoming"}
                                key={`${release.market}-${release.type}-${release.date}`}
                              >
                                <strong>
                                  {release.market === "us"
                                    ? "US release"
                                    : release.type === "previews" ? "Previews" : "Theatrical"}
                                </strong>{" "}
                                {formatDate(release.date)}
                              </span>
                            ))}
                          </>
                        )
                        : (
                            <span className="release-date is-upcoming">
                              UK release date to be announced{film.year ? ` · ${film.year}` : ""}
                            </span>
                          )}
                    </p>
                    <div className="film-actions">
                      <button
                        className={booking ? "booking-button is-booked" : "booking-button"}
                        type="button"
                        onClick={() => toggleBooked(film.id)}
                        aria-pressed={booking}
                      >
                        <Icon name="ticket" />
                        {booking ? "Tickets booked" : "Mark as booked"}
                      </button>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>

      <footer className="footer">
        <span>MADE FOR YOUR NEXT TRIP TO THE CINEMA</span>
        <span>Release dates sourced from Letterboxd · Ticket status saved in this browser</span>
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
          <span className="stat-value">{loading ? "—" : films.length.toString().padStart(2, "0")}</span>
          <span className="stat-footnote">Entire watchlist</span>
        </button>
        <button
          className={filter === "upcoming" ? "stat-card is-active" : "stat-card"}
          type="button"
          aria-pressed={filter === "upcoming"}
          onClick={() => setFilter("upcoming")}
        >
          <span className="stat-label">ON THE WAY</span>
          <span className="stat-value">{loading ? "—" : upcomingCount.toString().padStart(2, "0")}</span>
          <span className="stat-footnote"><span className="stat-dot dot-green" /> Releases ahead</span>
        </button>
        <button
          className={filter === "recent" ? "stat-card is-active" : "stat-card"}
          type="button"
          aria-pressed={filter === "recent"}
          onClick={() => setFilter("recent")}
        >
          <span className="stat-label">JUST RELEASED</span>
          <span className="stat-value">{loading ? "—" : recentCount.toString().padStart(2, "0")}</span>
          <span className="stat-footnote"><span className="stat-dot dot-coral" /> In the last 30 days</span>
        </button>
        <button
          className={filter === "booked" ? "stat-card stat-booked is-active" : "stat-card stat-booked"}
          type="button"
          aria-pressed={filter === "booked"}
          onClick={() => setFilter("booked")}
        >
          <span className="stat-label">YOUR SEATS</span>
          <span className="stat-value">{bookedCount.toString().padStart(2, "0")}</span>
          <span className="stat-footnote"><Icon name="ticket" /> Marked as booked</span>
        </button>
      </div>
    </section>
    </>
  );
}

export default App;
