CREATE TABLE `user_tracking_preferences` (
	`user_id` text PRIMARY KEY NOT NULL,
	`hot_open_threshold` integer DEFAULT 3 NOT NULL,
	`telegram_chat_id` text,
	`telegram_link_code` text,
	`telegram_link_expires_at` integer,
	`telegram_opens` integer DEFAULT true NOT NULL,
	`telegram_clicks` integer DEFAULT true NOT NULL,
	`summary_frequency` text DEFAULT 'off' NOT NULL,
	`summary_last_sent_at` integer,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `user_tracking_preferences_link_code_idx` ON `user_tracking_preferences` (`telegram_link_code`);
