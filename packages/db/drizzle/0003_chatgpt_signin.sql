ALTER TYPE "public"."provider_kind" ADD VALUE 'openai_chatgpt';--> statement-breakpoint
CREATE TABLE "oauth_clients" (
	"client_id" text PRIMARY KEY NOT NULL,
	"provider" "provider_kind" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "provider_credentials" ADD COLUMN "account_email" text;--> statement-breakpoint
ALTER TABLE "provider_credentials" ADD COLUMN "plan_usage" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "provider_credentials" ADD COLUMN "reauth_required" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "provider_credentials" ADD COLUMN "oauth_client_id" text;--> statement-breakpoint
CREATE INDEX "oauth_clients_provider_created_idx" ON "oauth_clients" USING btree ("provider","created_at" DESC NULLS LAST);--> statement-breakpoint
ALTER TABLE "provider_credentials" ADD CONSTRAINT "provider_credentials_oauth_client_id_oauth_clients_client_id_fk" FOREIGN KEY ("oauth_client_id") REFERENCES "public"."oauth_clients"("client_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_credentials" ADD CONSTRAINT "provider_credentials_oauth_client_id_unique" UNIQUE("oauth_client_id");