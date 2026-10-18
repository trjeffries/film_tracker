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

## Limitations

- It's UK-only, switching to US release dates when UK ones haven't been announced; this is because I live in the UK and have no need for any other countries. Maybe when my usage credits roll around I'll add in an option to choose from multiple countries.
- The booking links just search for Cineworld, but again this is just because that's what I use: despite their occasional annoyances (such as an unsearchable website), they do have a very well-priced Unlimited program.

Both of these are easy enough to get around by editing the code, particularly the latter. Feel free to clone the repo and run it on your own machine:

## Run locally

1. Install Node.js and npm.
2. From the project directory, install the dependencies:

   ```sh
   npm install
   ```

3. Start the app in development mode:

   ```sh
   npm run dev
   ```

   This starts the Vite frontend and the local API server. Open the URL printed
   by Vite (usually `http://localhost:5173`) in your browser, then enter a
   Letterboxd username with a public watchlist.

4. To check a production build locally, run:

   ```sh
   npm run build
   npm start
   ```

   Then open `http://localhost:3001`.
