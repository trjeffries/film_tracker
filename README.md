# Screening Room

A local web app that keeps an eye on UK theatrical release dates for a public
Letterboxd watchlist and lets you mark films whose tickets you have booked.

## Run locally

```sh
npm install
npm run dev
```

Open the local URL printed by Vite. The default watchlist is `trjeffries`; use
the username field to sync another public Letterboxd watchlist.

For a production build, run `npm run build`, then `npm start`.

## Deploy to Vercel

Import the GitHub repository into Vercel and deploy with the default project
root. The included `vercel.json` builds the Vite app into `dist` and deploys
`api/watchlist.ts` as the `/api/watchlist` serverless function. No environment
variables are required.

## How it works

- The server reads the public Letterboxd watchlist and the film pages’ UK
  release tables. Premiere dates are excluded; theatrical-limited dates are
  shown as previews alongside theatrical dates. Upcoming films and films
  released in the previous 30 days are shown, sorted by release date.
- Watchlist data is cached in memory for 15 minutes; using the Sync button
  refreshes it immediately.
- Ticket-booking flags are stored in this browser’s local storage, per
  Letterboxd username. They are not sent to Letterboxd or stored on a server.
- The watchlist must be public. Letterboxd may rate-limit or change its page
  markup; if a sync fails, the app shows the error so you can retry later.
