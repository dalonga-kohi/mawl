CREATE TABLE "user_profile" (
	"id" smallint PRIMARY KEY DEFAULT 1 NOT NULL,
	"name" text DEFAULT '' NOT NULL,
	"personal_context" text DEFAULT '' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_profile_single_row_check" CHECK ("user_profile"."id" = 1)
);
