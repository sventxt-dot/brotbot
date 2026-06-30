import { NextResponse } from "next/server";

// Lightweight liveness probe for Coolify health checks.
// Returns 200 as long as the Next.js process is running.
export function GET() {
  return NextResponse.json({ status: "ok" });
}
