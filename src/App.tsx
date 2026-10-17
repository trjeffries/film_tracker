import { FormEvent, useEffect, useMemo, useState } from "react";

interface Film {
  id: string;
  title: string;
  year: number | null;
  letterboxdUrl: string;
  posterUrl: string | null;
  releaseDates: Array<{ date: string; type: "previews" | "theatrical" }>;
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

const defaultUsername = "trjeffries";

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
  const [username, setUsername] = useState(defaultUsername);
  const [usernameDraft, setUsernameDraft] = useState(defaultUsername);
  const [films, setFilms] = useState<Film[]>([]);
  const [bookings, setBookings] = useState<Bookings>({});
  const [filter, setFilter] = useState<Filter>("all");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [storageError, setStorageError] = useState("");
  const [fetchedAt, setFetchedAt] = useState("");

  useEffect(() => {
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
    if (storageError) return;
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
      const payload: unknown = await response.json();
      if (!response.ok) {
        const message =
          payload && typeof payload === "object" && "error" in payload
            ? String(payload.error)
            : "Could not load this Letterboxd watchlist.";
        throw new Error(message);
      }
      const result = payload as WatchlistResponse;
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

  useEffect(() => {
    void syncWatchlist(defaultUsername);
  }, []);

  function handleUsernameSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const cleaned = usernameDraft.trim();
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
    <main className="app-shell">
      <div className="ambient ambient-one" aria-hidden="true" />
      <div className="ambient ambient-two" aria-hidden="true" />

      <header className="topbar">
        <a className="brand" href="/" aria-label="Screening Room home">
          <span className="brand-mark"><Icon name="film" /></span>
          <span>SCREENING ROOM</span>
        </a>
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
      </header>

      <section className="intro">
        <div className="intro-copy">
          <p className="eyebrow"><span /> YOUR WATCHLIST, ON THE BIG SCREEN</p>
          <h1>Good things <em>are coming.</em></h1>
        </div>
      </section>

      <section className="watchlist-tools" aria-label="Watchlist controls">
        <form className="sync-form" onSubmit={handleUsernameSubmit}>
          <label htmlFor="letterboxd-username">LETTERBOXD USERNAME</label>
          <div className="username-control">
            <span className="at-sign">@</span>
            <input
              id="letterboxd-username"
              autoComplete="off"
              value={usernameDraft}
              onChange={(event) => setUsernameDraft(event.target.value)}
            />
            <button className="sync-button" type="submit" disabled={loading}>
              <Icon name="refresh" />
              {loading ? "Syncing" : "Sync watchlist"}
            </button>
          </div>
        </form>
        <div className="sync-meta">
          <span className={loading ? "sync-indicator is-loading" : "sync-indicator"} />
          <span>
            {loading ? "Checking for new releases…" : fetchedAt ? `Last synced ${formatSyncTime(fetchedAt)}` : "Ready to sync"}
          </span>
          <span className="market-label">UK RELEASES</span>
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

      <section className="stats" aria-label="Watchlist summary">
        <div className="stat-card">
          <span className="stat-label">ON THE WAY</span>
          <span className="stat-value">{loading ? "—" : upcomingCount.toString().padStart(2, "0")}</span>
          <span className="stat-footnote"><span className="stat-dot dot-green" /> UK theatrical releases ahead</span>
        </div>
        <div className="stat-card">
          <span className="stat-label">JUST RELEASED</span>
          <span className="stat-value">{loading ? "—" : recentCount.toString().padStart(2, "0")}</span>
          <span className="stat-footnote"><span className="stat-dot dot-coral" /> In cinemas in the last 30 days</span>
        </div>
        <div className="stat-card stat-booked">
          <span className="stat-label">YOUR SEATS</span>
          <span className="stat-value">{bookedCount.toString().padStart(2, "0")}</span>
          <span className="stat-footnote"><Icon name="ticket" /> Tickets marked as booked</span>
        </div>
      </section>

      <section className="films-section">
        <div className="section-heading">
          <div>
            <p className="eyebrow">THE LINE-UP</p>
            <h2>Worth leaving the house for<span>.</span></h2>
          </div>
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

        <div className="film-toolbar">
          <div className="filter-tabs" role="tablist" aria-label="Filter films">
            {([
              ["all", "All films", films.length],
              ["upcoming", "Coming soon", upcomingCount],
              ["recent", "Recently released", recentCount],
              ["booked", "Tickets booked", bookedCount],
            ] as const).map(([value, label, count]) => (
              <button
                key={value}
                className={filter === value ? "filter-tab is-active" : "filter-tab"}
                type="button"
                role="tab"
                aria-selected={filter === value}
                onClick={() => setFilter(value)}
              >
                {label}<span>{count}</span>
              </button>
            ))}
          </div>
          <span className="sort-label">SORTED BY RELEASE DATE <span>↑</span></span>
        </div>

        {loading && films.length === 0 ? (
          <div className="loading-state">
            <span className="loading-spinner" />
            <p>Looking ahead at your watchlist…</p>
            <span>Finding UK cinema dates on Letterboxd</span>
          </div>
        ) : visibleFilms.length === 0 ? (
          <div className="empty-state">
            <div className="empty-icon"><Icon name="film" /></div>
            <h3>{films.length === 0 ? "Your next film night starts here." : "Nothing on this reel."}</h3>
            <p>
              {films.length === 0
                ? "Sync a public Letterboxd watchlist to find films opening in UK cinemas."
                : search
                  ? "Try another title or clear your search."
                  : "No films match this view right now. Check back after your next sync."}
            </p>
            {films.length === 0 && (
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
                    <div className={film.releaseStatus === "recent" ? "date-stamp is-recent" : "date-stamp"}>
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
                      {film.year && <span className="film-year">{film.year}</span>}
                    </div>
                    <p className="release-line">
                      <span className={film.releaseStatus === "recent" ? "release-dot dot-coral" : "release-dot dot-green"} />
                      {film.releaseDates.length > 0
                        ? film.releaseDates.map((release) => (
                            <span className="release-date" key={`${release.type}-${release.date}`}>
                                <strong className={release.type === "previews" ? "release-type-previews" : undefined}>
                                  {release.type === "previews" ? "Previews" : "Theatrical"}
                                </strong>{" "}
                                {formatDate(release.date)}
                            </span>
                          ))
                        : `UK release date to be announced${film.year ? ` · ${film.year}` : ""}`}
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
  );
}

export default App;
