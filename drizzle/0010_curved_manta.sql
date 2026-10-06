CREATE TABLE `source_renamings` (
	`source_id` text PRIMARY KEY NOT NULL,
	`mapping` text NOT NULL,
	`columns` text NOT NULL,
	`renaming` text NOT NULL,
	`model` text NOT NULL,
	`made_at` integer NOT NULL,
	FOREIGN KEY (`source_id`) REFERENCES `sources`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
ALTER TABLE `sources` ADD `rename_requested_at` integer;