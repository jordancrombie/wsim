import { NextResponse } from "next/server";

// Use internal Docker URL for server-side health checks
const BACKEND_INTERNAL_URL = process.env.BACKEND_INTERNAL_URL || "http://wsim-backend:3003";

/**
 * Readiness check - is the service ready to accept traffic?
 * Checks backend connectivity to ensure the frontend can serve requests.
 * GET /health/ready
 */
export async function GET() {
  try {
    const response = await fetch(`${BACKEND_INTERNAL_URL}/health/ready`, {
      method: "GET",
      cache: "no-store",
    });

    if (response.ok) {
      return NextResponse.json({ ready: true });
    }

    return NextResponse.json({ ready: false }, { status: 503 });
  } catch {
    return NextResponse.json({ ready: false }, { status: 503 });
  }
}
