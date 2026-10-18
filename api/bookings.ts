import type { IncomingMessage, ServerResponse } from "node:http";
import { BookingStoreError, syncBookings } from "../server/bookings.js";

interface VercelRequest extends IncomingMessage {
  body?: unknown;
}

async function readBody(request: VercelRequest): Promise<unknown> {
  if (request.body !== undefined) {
    if (typeof request.body !== "string") return request.body;
    try {
      return JSON.parse(request.body);
    } catch {
      throw new BookingStoreError("Request body must be valid JSON.", 400);
    }
  }

  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new BookingStoreError("Request body must be valid JSON.", 400);
  }
}

export default async function handler(
  request: VercelRequest,
  response: ServerResponse,
): Promise<void> {
  if (request.method !== "POST") {
    response.writeHead(405, {
      Allow: "POST",
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    });
    response.end(JSON.stringify({ error: "Only POST requests are supported." }));
    return;
  }

  try {
    const result = await syncBookings(await readBody(request));
    response.writeHead(200, {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    });
    response.end(JSON.stringify(result));
  } catch (error) {
    const status = error instanceof BookingStoreError ? error.statusCode : 500;
    const message = error instanceof Error
      ? error.message
      : "Could not sync bookings.";
    response.writeHead(status, {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    });
    response.end(JSON.stringify({ error: message }));
  }
}
