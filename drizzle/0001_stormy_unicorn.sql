CREATE TABLE `decision_tags` (
	`candidate_id` text NOT NULL,
	`tag_id` integer NOT NULL,
	PRIMARY KEY(`candidate_id`, `tag_id`),
	FOREIGN KEY (`candidate_id`) REFERENCES `candidate_decisions`(`candidate_id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`tag_id`) REFERENCES `candidate_tags`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `candidate_decisions` (
	`candidate_id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`user_id` text NOT NULL,
	`decided_at` integer NOT NULL,
	`changeset_id` text,
	FOREIGN KEY (`candidate_id`) REFERENCES `candidates`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`changeset_id`) REFERENCES `changesets`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `decisions_changeset_idx` ON `candidate_decisions` (`changeset_id`);--> statement-breakpoint
CREATE TABLE `user_settings` (
	`user_id` text PRIMARY KEY NOT NULL,
	`osm_connected` integer,
	`osm_scopes` text DEFAULT 'write_api · read_prefs' NOT NULL,
	`osm_target` text DEFAULT 'openstreetmap.org' NOT NULL,
	`osm_comment` text DEFAULT '' NOT NULL,
	`osm_source_tag` text DEFAULT '' NOT NULL,
	`osm_hashtag` text DEFAULT '#poi-review' NOT NULL,
	`osm_per_changeset` integer DEFAULT 50 NOT NULL,
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
	`vim` integer DEFAULT true NOT NULL,
	`confirm_accept` integer DEFAULT false NOT NULL,
	`show_hints` integer DEFAULT true NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
ALTER TABLE `sources` ADD `enabled` integer DEFAULT true NOT NULL;