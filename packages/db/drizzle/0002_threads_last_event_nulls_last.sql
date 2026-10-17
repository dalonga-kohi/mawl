DROP INDEX "threads_profile_last_event_idx";--> statement-breakpoint
CREATE INDEX "threads_profile_last_event_idx" ON "threads" USING btree ("profile_id","last_event_at" DESC NULLS LAST);