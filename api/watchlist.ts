import type { IncomingMessage, ServerResponse } from "node:http";
import { getWatchlistResult } from "../server/watchlist.js";

export default async function handler(
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  if (request.method !== "GET") {
    response.writeHead(405, {
      Allow: "GET",
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    });
    response.end(JSON.stringify({ error: "Only GET requests are supported." }));
    return;
  }

  const url = new URL(request.url ?? "/", "http://localhost");
  const username = (url.searchParams.get("username") ?? "").trim();
  if (!/^[A-Za-z0-9_-]{1,30}$/.test(username)) {
    response.writeHead(400, {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    });
    response.end(JSON.stringify({ error: "Enter a valid Letterboxd username." }));
    return;
  }

  try {
    const result = await getWatchlistResult(
      username,
      url.searchParams.get("refresh") === "true",
    );
    response.writeHead(200, {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    });
    response.end(JSON.stringify(result));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected Letterboxd error.";
    response.writeHead(502, {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    });
    response.end(JSON.stringify({ error: message }));
  }
}
