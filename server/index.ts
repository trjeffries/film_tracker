import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import { getWatchlistResult } from "./watchlist.js";

const app = express();
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

if (existsSync(clientBuild)) {
  app.use(express.static(clientBuild));
  app.get("/{*path}", (_request, response) => {
    response.sendFile(path.join(clientBuild, "index.html"));
  });
}

app.listen(port, () => {
  console.log(`Film tracker API listening on http://localhost:${port}`);
});
