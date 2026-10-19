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
- The Letterboxd username and ticket-booking flags are stored in the browser’s
  local storage. On later visits, the app restores the username and syncs its
  watchlist automatically. When a successful sync confirms that a film has
  been removed from the Letterboxd watchlist, its saved booking status is
  removed from this browser and optional server storage as well.
- Users can optionally sync booked film IDs across devices using a generated
  private three-word phrase. The phrase is stored in the browser and is required
  to access that username’s booking set from another device. Redis stores only
  booked film IDs; it does not store the Letterboxd password or watchlist.
  Server-side booking data expires after 30 days without a successful sync or
  booking update. Existing records begin this expiry period the next time they
  successfully sync, since earlier activity was not tracked.
  Enable it from **Sync across devices**, save the generated phrase, then enter
  the same Letterboxd username and phrase on another device. Existing local
  and server bookings are merged when connecting.
- Anyone with both the
  Letterboxd username and sync code can access and change that user's synced
  bookings, so keep the code private. If the code is lost from all devices,
  the server-side bookings cannot be recovered elsewhere.
- Unbooked films with a UK release date in the next 30 days have a ticket-search
  link that opens a Google search scoped to Cineworld film pages.
- The watchlist must be public. Letterboxd may rate-limit or change its page
  markup; if a sync fails, the app shows the error so you can retry later.

## Future roadmap

Two main things I'd like to develop in future, both related to personalisation:

- Booking links. At the moment they just search for Cineworld, just because that's what I use: despite their occasional annoyances (such as an unsearchable website), they do have a very well-priced Unlimited program. In time, I'll add an option to switch to either generic showtime cites or other specific cinemas.
- Countries. Similar to the cinema, it's UK-only right now (switching to US release dates when UK ones haven't been announced), but only because this is where I live. Plan in future is to add a choice of countries.

## Running locally

If you want to download it and run it yourself, here's the info you need:

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

   To test optional server-side booking sync locally, create an untracked
   `.env.local` file in the project root with the write-enabled Upstash REST
   credentials from Vercel:

   ```dotenv
   KV_REST_API_URL=your_database_rest_url
   KV_REST_API_TOKEN=your_database_write_token
   ```

   Do not use `KV_REST_API_READ_ONLY_TOKEN` for `KV_REST_API_TOKEN`. Keep the
   values private; `.env.local` is excluded from Git.

4. To check a production build locally, run:

   ```sh
   npm run build
   npm start
   ```

   Then open `http://localhost:3001`.

## Configure server-side booking sync on Vercel

The Vercel project needs the Upstash write credentials exposed as
`KV_REST_API_URL` and `KV_REST_API_TOKEN` for the Production and Preview
environments. The read-only token is not sufficient. After adding or changing
these environment variables, redeploy the project. The credentials are only
used by the server-side booking API and are never sent to the browser.
