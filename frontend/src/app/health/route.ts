import { NextResponse } from "next/server";

// Use internal Docker URL for server-side health checks, fallback to public API URL
const BACKEND_INTERNAL_URL = process.env.BACKEND_INTERNAL_URL || "http://wsim-backend:3003";

/**
 * Health check endpoint - checks frontend and backend connectivity
 * GET /health
 */
export async function GET() {
  const checks: {
    frontend: "healthy" | "unhealthy";
    backend: "healthy" | "unhealthy" | "unknown";
    backendError?: string;
  } = {
    frontend: "healthy",
    backend: "unknown",
  };

  // Check backend connectivity
  try {
    const response = await fetch(`${BACKEND_INTERNAL_URL}/health`, {
      method: "GET",
      cache: "no-store",
    });

    if (response.ok) {
      checks.backend = "healthy";
    } else {
      checks.backend = "unhealthy";
      checks.backendError = `Backend returned ${response.status}`;
    }
  } catch (error) {
    checks.backend = "unhealthy";
    checks.backendError =
      error instanceof Error ? error.message : "Connection failed";
  }

  const isHealthy = checks.frontend === "healthy" && checks.backend === "healthy";

  return NextResponse.json(
    {
      status: isHealthy ? "healthy" : "unhealthy",
      timestamp: new Date().toISOString(),
      service: "wsim-frontend",
      version: process.env.npm_package_version || "0.1.0",
      checks,
    },
    { status: isHealthy ? 200 : 503 }
  );
}
