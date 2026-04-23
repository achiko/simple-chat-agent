import { NextResponse } from "next/server";
import { auth } from "@/app/(auth)/auth";
import { ERRORS, withErrorHandler } from "@/lib/api-errors";
import { getJob } from "@/lib/db/jobs";

export const GET = withErrorHandler(
  async (
    _request: Request,
    { params }: { params: Promise<{ id: string }> }
  ) => {
    const session = await auth();
    if (!session?.user?.id) throw ERRORS.unauthorized();

    const { id } = await params;
    const row = await getJob(id);
    if (!row) throw ERRORS.notFound("Job");
    if (row.job.userId !== session.user.id) throw ERRORS.forbidden();

    return NextResponse.json({ job: row.job, output: row.output });
  }
);
