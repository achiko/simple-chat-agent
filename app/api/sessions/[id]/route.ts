import { NextResponse } from "next/server";
import { auth } from "@/app/(auth)/auth";
import { getJobsWithOutputsBySession, getSession } from "@/lib/db/sessions";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const row = await getSession(id);
  if (!row) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  if (row.userId !== session.user.id) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const jobs = await getJobsWithOutputsBySession(id);
  return NextResponse.json({ session: row, jobs });
}
