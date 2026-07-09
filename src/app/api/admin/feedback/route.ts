import { NextResponse, type NextRequest } from "next/server";
import { withSuperAdmin } from "@/lib/admin/with-super-admin";
import { listAll, getLatestJobStatusByTickets } from "@/lib/feedback/repository";

// GET /api/admin/feedback — todos los tickets + estado del último job (badge).
export const GET = withSuperAdmin(async (req: NextRequest) => {
  const url = new URL(req.url);
  const tipo = url.searchParams.get("tipo") ?? undefined;
  const estado = url.searchParams.get("estado") ?? undefined;
  const orgId = url.searchParams.get("org_id") ?? undefined;

  const tickets = await listAll({ tipo, estado, orgId });
  const jobInfo = await getLatestJobStatusByTickets(tickets.map((t) => t.id));
  const withJob = tickets.map((t) => ({
    ...t,
    ai_job_status: jobInfo[t.id]?.status ?? null,
    ai_pr_url: jobInfo[t.id]?.pr_url ?? null,
  }));
  return NextResponse.json(withJob);
});
