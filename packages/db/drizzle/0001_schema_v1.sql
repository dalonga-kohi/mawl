CREATE TYPE "public"."message_role" AS ENUM('user', 'assistant', 'system', 'tool');--> statement-breakpoint
CREATE TYPE "public"."provider_kind" AS ENUM('anthropic', 'openai', 'openrouter', 'ollama', 'openai_compatible');--> statement-breakpoint
CREATE TYPE "public"."run_status" AS ENUM('queued', 'running', 'waiting_approval', 'waiting_takeover', 'waiting_user', 'compacting', 'paused', 'succeeded', 'failed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."run_trigger" AS ENUM('user', 'routine', 'heartbeat', 'teammate');--> statement-breakpoint
CREATE TYPE "public"."step_kind" AS ENUM('model', 'tool');--> statement-breakpoint
CREATE TABLE "artifacts" (
	"id" text PRIMARY KEY NOT NULL,
	"profile_id" text NOT NULL,
	"run_id" text,
	"mime" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"preview" text NOT NULL,
	"token_count" integer NOT NULL,
	"content" "bytea",
	"path" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "artifacts_content_xor_path_check" CHECK (("artifacts"."content" is not null) <> ("artifacts"."path" is not null)),
	CONSTRAINT "artifacts_size_bytes_check" CHECK ("artifacts"."size_bytes" >= 0),
	CONSTRAINT "artifacts_token_count_check" CHECK ("artifacts"."token_count" >= 0)
);
--> statement-breakpoint
CREATE TABLE "events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"profile_id" text,
	"run_id" text,
	"type" text NOT NULL,
	"payload_json" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" text PRIMARY KEY NOT NULL,
	"thread_id" text NOT NULL,
	"run_id" text,
	"role" "message_role" NOT NULL,
	"parts_json" jsonb NOT NULL,
	"token_count" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "messages_token_count_check" CHECK ("messages"."token_count" is null or "messages"."token_count" >= 0)
);
--> statement-breakpoint
CREATE TABLE "profiles" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"color" text NOT NULL,
	"persona_md" text DEFAULT '' NOT NULL,
	"model_main" text NOT NULL,
	"model_helper" text,
	"policy_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"heartbeat_cron" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	CONSTRAINT "profiles_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "provider_credentials" (
	"id" text PRIMARY KEY NOT NULL,
	"provider" "provider_kind" NOT NULL,
	"label" text NOT NULL,
	"secret_enc" "bytea" NOT NULL,
	"base_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "run_steps" (
	"id" text PRIMARY KEY NOT NULL,
	"run_id" text NOT NULL,
	"idx" integer NOT NULL,
	"kind" "step_kind" NOT NULL,
	"input_json" jsonb NOT NULL,
	"output_ref" text,
	"usage_json" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "run_steps_run_idx_unique" UNIQUE("run_id","idx"),
	CONSTRAINT "run_steps_idx_check" CHECK ("run_steps"."idx" >= 0)
);
--> statement-breakpoint
CREATE TABLE "runs" (
	"id" text PRIMARY KEY NOT NULL,
	"profile_id" text NOT NULL,
	"thread_id" text,
	"trigger" "run_trigger" NOT NULL,
	"status" "run_status" DEFAULT 'queued' NOT NULL,
	"budget_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"usage_json" jsonb DEFAULT '{"inputTokens":0,"outputTokens":0}'::jsonb NOT NULL,
	"segment_no" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"ended_at" timestamp with time zone,
	"error" text,
	CONSTRAINT "runs_segment_no_check" CHECK ("runs"."segment_no" >= 0)
);
--> statement-breakpoint
CREATE TABLE "threads" (
	"id" text PRIMARY KEY NOT NULL,
	"profile_id" text NOT NULL,
	"channel" text NOT NULL,
	"peer" text,
	"title" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_event_at" timestamp with time zone,
	CONSTRAINT "threads_channel_check" CHECK ("threads"."channel" in ('app', 'telegram', 'discord'))
);
--> statement-breakpoint
ALTER TABLE "artifacts" ADD CONSTRAINT "artifacts_profile_id_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artifacts" ADD CONSTRAINT "artifacts_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_profile_id_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_thread_id_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."threads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_steps" ADD CONSTRAINT "run_steps_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runs" ADD CONSTRAINT "runs_profile_id_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runs" ADD CONSTRAINT "runs_thread_id_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."threads"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "threads" ADD CONSTRAINT "threads_profile_id_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "artifacts_run_idx" ON "artifacts" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "events_profile_id_idx" ON "events" USING btree ("profile_id","id");--> statement-breakpoint
CREATE INDEX "events_run_id_idx" ON "events" USING btree ("run_id","id");--> statement-breakpoint
CREATE INDEX "messages_thread_created_idx" ON "messages" USING btree ("thread_id","created_at");--> statement-breakpoint
CREATE INDEX "runs_profile_status_idx" ON "runs" USING btree ("profile_id","status");--> statement-breakpoint
CREATE INDEX "runs_thread_idx" ON "runs" USING btree ("thread_id");--> statement-breakpoint
CREATE INDEX "threads_profile_last_event_idx" ON "threads" USING btree ("profile_id","last_event_at" desc);