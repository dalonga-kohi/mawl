ALTER TABLE "runs" ADD COLUMN "active_ms" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "runs" ADD CONSTRAINT "runs_active_ms_check" CHECK ("runs"."active_ms" >= 0);