CREATE TABLE `message_links` (
	`id` varchar(191) NOT NULL,
	`token` varchar(191) NOT NULL,
	`url` longtext NOT NULL,
	`click_count` bigint NOT NULL DEFAULT 0,
	`first_clicked_at` bigint,
	`last_clicked_at` bigint,
	`created_at` bigint NOT NULL,
	CONSTRAINT `message_links_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `message_link_clicks` (
	`id` varchar(191) NOT NULL,
	`link_id` varchar(191) NOT NULL,
	`clicked_at` bigint NOT NULL,
	`client` longtext,
	`device` longtext,
	`country` longtext,
	`city` longtext,
	`automated` boolean NOT NULL DEFAULT false,
	CONSTRAINT `message_link_clicks_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `message_links` ADD CONSTRAINT `message_links_token_message_tracking_token_fk` FOREIGN KEY (`token`) REFERENCES `message_tracking`(`token`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `message_link_clicks` ADD CONSTRAINT `message_link_clicks_link_id_message_links_id_fk` FOREIGN KEY (`link_id`) REFERENCES `message_links`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `message_links_token_idx` ON `message_links` (`token`);--> statement-breakpoint
CREATE INDEX `message_link_clicks_link_idx` ON `message_link_clicks` (`link_id`,`clicked_at`);
