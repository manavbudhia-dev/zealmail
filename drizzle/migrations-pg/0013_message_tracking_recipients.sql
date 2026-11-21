ALTER TABLE "message_tracking" ADD COLUMN "recipient" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "message_tracking" ADD COLUMN "provider_message_id" text;--> statement-breakpoint
CREATE UNIQUE INDEX "message_tracking_message_recipient_idx" ON "message_tracking" USING btree ("message_id","recipient");--> statement-breakpoint
DROP INDEX "message_tracking_message_idx";--> statement-breakpoint
CREATE INDEX "message_tracking_provider_message_idx" ON "message_tracking" USING btree ("provider_message_id");
