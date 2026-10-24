CREATE TABLE "run_waits" (
	"run_id" text NOT NULL,
	"step_idx" integer NOT NULL,
	"tool_call_id" text NOT NULL,
	"kind" text NOT NULL,
	"payload_json" jsonb NOT NULL,
	"answer_json" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone,
	CONSTRAINT "run_waits_pk" PRIMARY KEY("run_id","step_idx","tool_call_id"),
	CONSTRAINT "run_waits_kind_check" CHECK ("run_waits"."kind" in ('question', 'approval')),
	CONSTRAINT "run_waits_step_idx_check" CHECK ("run_waits"."step_idx" >= 0)
);
--> statement-breakpoint
CREATE TABLE "service_credentials" (
	"service" text PRIMARY KEY NOT NULL,
	"secret_enc" "bytea" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "service_credentials_service_check" CHECK ("service_credentials"."service" in ('brave_search'))
);
--> statement-breakpoint
CREATE TABLE "tool_results" (
	"run_id" text NOT NULL,
	"step_idx" integer NOT NULL,
	"tool_call_id" text NOT NULL,
	"tool_name" text NOT NULL,
	"is_error" boolean NOT NULL,
	"output_json" jsonb NOT NULL,
	"preview" text NOT NULL,
	"artifact_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tool_results_pk" PRIMARY KEY("run_id","step_idx","tool_call_id"),
	CONSTRAINT "tool_results_step_idx_check" CHECK ("tool_results"."step_idx" >= 0)
);
--> statement-breakpoint
ALTER TABLE "run_waits" ADD CONSTRAINT "run_waits_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tool_results" ADD CONSTRAINT "tool_results_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tool_results" ADD CONSTRAINT "tool_results_artifact_id_artifacts_id_fk" FOREIGN KEY ("artifact_id") REFERENCES "public"."artifacts"("id") ON DELETE set null ON UPDATE no action;