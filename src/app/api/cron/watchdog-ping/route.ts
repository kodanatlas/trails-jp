import { NextResponse } from "next/server";
import { logCron } from "@/lib/cron-logger";

const MAX_QUERY_PARAM_LENGTH = 200;

function truncateQueryParam(value: string | null): string | null {
  return value === null ? null : value.slice(0, MAX_QUERY_PARAM_LENGTH);
}

export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization");
  if (!process.env.CRON_SECRET) {
    return NextResponse.json({ error: "CRON_SECRET not configured" }, { status: 500 });
  }
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const start = Date.now();
  const searchParams = new URL(request.url).searchParams;
  const result = {
    source: "github-actions",
    run_id: truncateQueryParam(searchParams.get("run_id")),
    repo: truncateQueryParam(searchParams.get("repo")),
  };

  const logged = await logCron("gh-watchdog", "success", result, Date.now() - start);
  if (!logged) {
    return NextResponse.json(
      { success: false, error: "Failed to record watchdog heartbeat" },
      { status: 500 },
    );
  }
  return NextResponse.json({ success: true });
}
