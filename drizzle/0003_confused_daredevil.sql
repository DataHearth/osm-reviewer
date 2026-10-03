CREATE TABLE `instance_settings` (
	`id` integer PRIMARY KEY DEFAULT 1 NOT NULL,
	`ntfy_on` integer DEFAULT false NOT NULL,
	`ntfy_server` text DEFAULT '' NOT NULL,
	`ntfy_topic` text DEFAULT '' NOT NULL,
	`webhook_on` integer DEFAULT false NOT NULL,
	`webhook_url` text DEFAULT '' NOT NULL,
	`webhook_secret` text DEFAULT '' NOT NULL,
	`email_on` integer DEFAULT false NOT NULL,
	`email_to` text DEFAULT '' NOT NULL,
	`email_relay` text DEFAULT '' NOT NULL,
	`queue_over` integer DEFAULT 250 NOT NULL,
	`event_queue` integer DEFAULT true NOT NULL,
	`event_source_failed` integer DEFAULT true NOT NULL,
	`event_upload_failed` integer DEFAULT true NOT NULL,
	`event_run_finished` integer DEFAULT false NOT NULL,
	CONSTRAINT "instance_settings_single_row" CHECK("instance_settings"."id" = 1)
);
--> statement-breakpoint
-- The channels were per account until now; an admin's become the instance's.
INSERT INTO `instance_settings` (`id`, `ntfy_on`, `ntfy_server`, `ntfy_topic`, `webhook_on`, `webhook_url`, `webhook_secret`, `email_on`, `email_to`, `email_relay`, `queue_over`, `event_queue`, `event_source_failed`, `event_upload_failed`, `event_run_finished`)
SELECT 1, s.`ntfy_on`, s.`ntfy_server`, s.`ntfy_topic`, s.`webhook_on`, s.`webhook_url`, s.`webhook_secret`, s.`email_on`, s.`email_to`, s.`email_relay`, s.`queue_over`, s.`event_queue`, s.`event_source_failed`, s.`event_upload_failed`, s.`event_run_finished`
FROM `user_settings` s JOIN `users` u ON u.`id` = s.`user_id`
ORDER BY u.`role` = 'admin' DESC, u.`id`
LIMIT 1;
--> statement-breakpoint
ALTER TABLE `user_settings` DROP COLUMN `ntfy_on`;--> statement-breakpoint
ALTER TABLE `user_settings` DROP COLUMN `ntfy_server`;--> statement-breakpoint
ALTER TABLE `user_settings` DROP COLUMN `ntfy_topic`;--> statement-breakpoint
ALTER TABLE `user_settings` DROP COLUMN `webhook_on`;--> statement-breakpoint
ALTER TABLE `user_settings` DROP COLUMN `webhook_url`;--> statement-breakpoint
ALTER TABLE `user_settings` DROP COLUMN `webhook_secret`;--> statement-breakpoint
ALTER TABLE `user_settings` DROP COLUMN `email_on`;--> statement-breakpoint
ALTER TABLE `user_settings` DROP COLUMN `email_to`;--> statement-breakpoint
ALTER TABLE `user_settings` DROP COLUMN `email_relay`;--> statement-breakpoint
ALTER TABLE `user_settings` DROP COLUMN `queue_over`;--> statement-breakpoint
ALTER TABLE `user_settings` DROP COLUMN `event_queue`;--> statement-breakpoint
ALTER TABLE `user_settings` DROP COLUMN `event_source_failed`;--> statement-breakpoint
ALTER TABLE `user_settings` DROP COLUMN `event_upload_failed`;--> statement-breakpoint
ALTER TABLE `user_settings` DROP COLUMN `event_run_finished`;