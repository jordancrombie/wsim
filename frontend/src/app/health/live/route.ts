import { NextResponse } from "next/server";

/**
 * Liveness check - is the service alive?
 * Simple endpoint that returns 200 if the process is running.
 * GET /health/live
 */
export async function GET() {
  return NextResponse.json({ alive: true });
}
