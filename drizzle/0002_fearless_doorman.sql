ALTER TABLE `users` ADD `sso_subject` text;--> statement-breakpoint
ALTER TABLE `users` ADD `disabled` integer DEFAULT false NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `users_sso_subject_idx` ON `users` (`sso_subject`);