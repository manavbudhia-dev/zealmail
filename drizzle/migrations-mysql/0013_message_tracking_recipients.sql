ALTER TABLE `message_tracking` ADD `recipient` varchar(191) NOT NULL DEFAULT '';--> statement-breakpoint
ALTER TABLE `message_tracking` ADD `provider_message_id` varchar(512);--> statement-breakpoint
ALTER TABLE `message_tracking` ADD CONSTRAINT `message_tracking_message_recipient_idx` UNIQUE(`message_id`,`recipient`);--> statement-breakpoint
ALTER TABLE `message_tracking` DROP INDEX `message_tracking_message_idx`;--> statement-breakpoint
CREATE INDEX `message_tracking_provider_message_idx` ON `message_tracking` (`provider_message_id`);
