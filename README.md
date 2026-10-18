# Watch It When

A web app that keeps an eye on UK theatrical release dates for a public
Letterboxd watchlist and lets you mark films whose tickets you have booked.

## Why I built it

For years I maintained a list in my Notes app; upcoming releases split up by year and month, manually typing in names when I saw them, updating release dates, then italicising the names to indicate I'd booked a ticket to see them and deleting them once I'd watched them. So often I wanted to switch it, and there were so, so many options of tracking films (including one that I do use for TV shows!), but none that had the single key functionality of marking a film in any way to indicate booked. So, now I have my own. Hooray!

## How it works

- The server reads the public Letterboxd watchlist and the film pages’ UK
  release tables. Premiere dates are excluded; theatrical-limited dates are
  shown as previews alongside theatrical dates. Upcoming films and films
  released in the previous 30 days are shown, sorted by release date.
- Watchlist data is cached in memory for 15 minutes; using the Sync button
  refreshes it immediately.
- The Letterboxd username and ticket-booking flags are stored in this browser’s
  local storage. On later visits, the app restores the username and syncs its
  watchlist automatically. This data is not sent to Letterboxd or stored on a
  server.
- Unbooked films with a UK release date in the next 30 days have a ticket-search
  link that opens a Google search scoped to Cineworld film pages.
- The watchlist must be public. Letterboxd may rate-limit or change its page
  markup; if a sync fails, the app shows the error so you can retry later.
