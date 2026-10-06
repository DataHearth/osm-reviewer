ALTER TABLE `sources` ADD `renaming_used` text;--> statement-breakpoint
ALTER TABLE `sources` ADD `late_columns` text DEFAULT '[]' NOT NULL;