CREATE TABLE `message_links` (
	`id` text PRIMARY KEY NOT NULL,
	`token` text NOT NULL,
	`url` text NOT NULL,
	`click_count` integer DEFAULT 0 NOT NULL,
	`first_clicked_at` integer,
	`last_clicked_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`token`) REFERENCES `message_tracking`(`token`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `message_links_token_idx` ON `message_links` (`token`);
--> statement-breakpoint
CREATE TABLE `message_link_clicks` (
	`id` text PRIMARY KEY NOT NULL,
	`link_id` text NOT NULL,
	`clicked_at` integer NOT NULL,
	`client` text,
	`device` text,
	`country` text,
	`city` text,
	`automated` integer DEFAULT false NOT NULL,
	FOREIGN KEY (`link_id`) REFERENCES `message_links`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `message_link_clicks_link_idx` ON `message_link_clicks` (`link_id`,`clicked_at`);
