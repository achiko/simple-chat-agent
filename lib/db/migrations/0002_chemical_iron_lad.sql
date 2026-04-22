CREATE TABLE IF NOT EXISTS "ChatSession" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"userId" uuid NOT NULL,
	"title" text NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "Job" ADD COLUMN "sessionId" uuid;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "ChatSession" ADD CONSTRAINT "ChatSession_userId_User_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ChatSession_userId_updatedAt_idx" ON "ChatSession" USING btree ("userId","updatedAt");--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "Job" ADD CONSTRAINT "Job_sessionId_ChatSession_id_fk" FOREIGN KEY ("sessionId") REFERENCES "public"."ChatSession"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "Job_sessionId_createdAt_idx" ON "Job" USING btree ("sessionId","createdAt");