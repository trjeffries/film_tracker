import { config as loadEnvironment } from "dotenv";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import { BookingStoreError, syncBookings } from "./bookings.js";
import { getWatchlistResult } from "./watchlist.js";

loadEnvironment({ path: ".env.local" });

const app = express();
app.use(express.json({ limit: "256kb" }));
const port = Number(process.env.PORT ?? 3001);
const projectDirectory = path.dirname(fileURLToPath(import.meta.url));
const clientBuild = path.resolve(projectDirectory, "../dist");

app.get("/api/watchlist", async (request, response) => {
  const username = String(request.query.username ?? "").trim();
  if (!/^[A-Za-z0-9_-]{1,30}$/.test(username)) {
    response.status(400).json({ error: "Enter a valid Letterboxd username." });
    return;
  }

  try {
    const result = await getWatchlistResult(username, request.query.refresh === "true");
    response.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected Letterboxd error.";
    response.status(502).json({ error: message });
  }
});

app.post("/api/bookings", async (request, response) => {
  try {
    response.setHeader("Cache-Control", "no-store");
    response.json(await syncBookings(request.body));
  } catch (error) {
    const status = error instanceof BookingStoreError ? error.statusCode : 500;
    const message = error instanceof Error
      ? error.message
      : "Could not sync bookings.";
    response.status(status).json({ error: message });
  }
});

if (existsSync(clientBuild)) {
  app.use(express.static(clientBuild));
  app.get("/{*path}", (_request, response) => {
    response.sendFile(path.join(clientBuild, "index.html"));
  });
}

app.listen(port, () => {
  console.log(`Film tracker API listening on http://localhost:${port}`);
});
