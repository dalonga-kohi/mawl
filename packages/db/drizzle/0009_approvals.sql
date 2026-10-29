CREATE TABLE "approvals" (
	"id" text PRIMARY KEY NOT NULL,
	"profile_id" text NOT NULL,
	"run_id" text NOT NULL,
	"step_idx" integer NOT NULL,
	"tool_call_id" text NOT NULL,
	"tool" text NOT NULL,
	"action_class" text NOT NULL,
	"args_enc" "bytea" NOT NULL,
	"args_hash" text NOT NULL,
	"args_redacted_json" jsonb NOT NULL,
	"reason" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"decided_by_device" text,
	"decided_via_channel" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"decided_at" timestamp with time zone,
	CONSTRAINT "approvals_call_unique" UNIQUE("run_id","step_idx","tool_call_id"),
	CONSTRAINT "approvals_status_check" CHECK ("approvals"."status" in ('pending', 'approved', 'denied', 'expired', 'cancelled')),
	CONSTRAINT "approvals_action_class_check" CHECK ("approvals"."action_class" in ('read', 'write_local', 'send_message', 'purchase', 'delete', 'credential', 'external_post', 'shell_exec', 'owner_contact')),
	CONSTRAINT "approvals_channel_check" CHECK ("approvals"."decided_via_channel" is null or "approvals"."decided_via_channel" in ('app', 'telegram', 'discord')),
	CONSTRAINT "approvals_decided_check" CHECK (("approvals"."status" = 'pending') = ("approvals"."decided_at" is null)),
	CONSTRAINT "approvals_args_hash_check" CHECK ("approvals"."args_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "approvals_step_idx_check" CHECK ("approvals"."step_idx" >= 0)
);
--> statement-breakpoint
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_profile_id_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "approvals_status_expires_idx" ON "approvals" USING btree ("status","expires_at");--> statement-breakpoint
CREATE INDEX "approvals_profile_created_idx" ON "approvals" USING btree ("profile_id","created_at" DESC NULLS LAST);