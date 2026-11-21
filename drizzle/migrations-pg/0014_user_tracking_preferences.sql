CREATE TABLE "user_tracking_preferences" (
	"user_id" text PRIMARY KEY NOT NULL,
	"hot_open_threshold" bigint DEFAULT 3 NOT NULL,
	"telegram_chat_id" text,
	"telegram_link_code" text,
	"telegram_link_expires_at" bigint,
	"telegram_opens" boolean DEFAULT true NOT NULL,
	"telegram_clicks" boolean DEFAULT true NOT NULL,
	"summary_frequency" text DEFAULT 'off' NOT NULL,
	"summary_last_sent_at" bigint,
	"updated_at" bigint NOT NULL
);
--> statement-breakpoint
ALTER TABLE "user_tracking_preferences" ADD CONSTRAINT "user_tracking_preferences_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "user_tracking_preferences_link_code_idx" ON "user_tracking_preferences" USING btree ("telegram_link_code");
