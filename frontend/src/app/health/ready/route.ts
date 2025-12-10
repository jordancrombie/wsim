import { NextResponse } from "next/server";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3003";

/**
 * Readiness check - is the service ready to accept traffic?
 * Checks backend connectivity to ensure the frontend can serve requests.
 * GET /health/ready
 */
export async function GET() {
  try {
    const response = await fetch(`${API_URL}/health/ready`, {
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
