import { NextResponse } from "next/server";
import { auth } from "@/app/(auth)/auth";
import { ERRORS, withErrorHandler } from "@/lib/api-errors";
import { getJobsWithOutputsBySession, getSession } from "@/lib/db/sessions";

export const GET = withErrorHandler(
  async (
    _request: Request,
    { params }: { params: Promise<{ id: string }> }
  ) => {
    const session = await auth();
    if (!session?.user?.id) throw ERRORS.unauthorized();

    const { id } = await params;
    const row = await getSession(id);
    if (!row) throw ERRORS.notFound("Session");
    if (row.userId !== session.user.id) throw ERRORS.forbidden();

    const jobs = await getJobsWithOutputsBySession(id);
    return NextResponse.json({ session: row, jobs });
  }
);
