CREATE TABLE `user_tracking_preferences` (
	`user_id` varchar(191) NOT NULL,
	`hot_open_threshold` bigint NOT NULL DEFAULT 3,
	`telegram_chat_id` longtext,
	`telegram_link_code` varchar(191),
	`telegram_link_expires_at` bigint,
	`telegram_opens` boolean NOT NULL DEFAULT true,
	`telegram_clicks` boolean NOT NULL DEFAULT true,
	`summary_frequency` varchar(64) NOT NULL DEFAULT 'off',
	`summary_last_sent_at` bigint,
	`updated_at` bigint NOT NULL,
	CONSTRAINT `user_tracking_preferences_user_id` PRIMARY KEY(`user_id`),
	CONSTRAINT `user_tracking_preferences_link_code_idx` UNIQUE(`telegram_link_code`)
);
--> statement-breakpoint
ALTER TABLE `user_tracking_preferences` ADD CONSTRAINT `user_tracking_preferences_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;
