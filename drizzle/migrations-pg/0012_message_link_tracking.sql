CREATE TABLE "message_links" (
	"id" text PRIMARY KEY NOT NULL,
	"token" text NOT NULL,
	"url" text NOT NULL,
	"click_count" bigint DEFAULT 0 NOT NULL,
	"first_clicked_at" bigint,
	"last_clicked_at" bigint,
	"created_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "message_link_clicks" (
	"id" text PRIMARY KEY NOT NULL,
	"link_id" text NOT NULL,
	"clicked_at" bigint NOT NULL,
	"client" text,
	"device" text,
	"country" text,
	"city" text,
	"automated" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
ALTER TABLE "message_links" ADD CONSTRAINT "message_links_token_message_tracking_token_fk" FOREIGN KEY ("token") REFERENCES "public"."message_tracking"("token") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_link_clicks" ADD CONSTRAINT "message_link_clicks_link_id_message_links_id_fk" FOREIGN KEY ("link_id") REFERENCES "public"."message_links"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "message_links_token_idx" ON "message_links" USING btree ("token");--> statement-breakpoint
CREATE INDEX "message_link_clicks_link_idx" ON "message_link_clicks" USING btree ("link_id","clicked_at");
