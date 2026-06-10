CREATE EXTENSION IF NOT EXISTS vector;--> statement-breakpoint
CREATE TABLE "factchecks" (
	"id" text PRIMARY KEY NOT NULL,
	"claim_text" text NOT NULL,
	"verdict" text NOT NULL,
	"rating_raw" text NOT NULL,
	"publisher" text NOT NULL,
	"url" text NOT NULL,
	"published_at" date,
	"lang" char(2) NOT NULL,
	"dedup_hash" text NOT NULL,
	"embedding" vector(384) NOT NULL,
	"ingested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"source" text NOT NULL,
	CONSTRAINT "factchecks_url_unique" UNIQUE("url"),
	CONSTRAINT "factchecks_dedup_hash_unique" UNIQUE("dedup_hash")
);
