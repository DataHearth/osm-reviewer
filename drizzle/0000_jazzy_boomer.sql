CREATE TABLE `area_sources` (
	`area_id` text NOT NULL,
	`source_id` text NOT NULL,
	`candidate_count` integer,
	`accept_rate` real,
	PRIMARY KEY(`area_id`, `source_id`),
	FOREIGN KEY (`area_id`) REFERENCES `areas`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`source_id`) REFERENCES `sources`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `area_sources_source_idx` ON `area_sources` (`source_id`);--> statement-breakpoint
CREATE TABLE `areas` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`def` text NOT NULL,
	`rel` text,
	`level` integer,
	`center_lat` real NOT NULL,
	`center_lon` real NOT NULL,
	`km` real,
	`radius` integer,
	`sqkm` real NOT NULL,
	`pending` integer DEFAULT 0 NOT NULL,
	`pois` text NOT NULL,
	`accepted30` integer DEFAULT 0 NOT NULL,
	`status` text NOT NULL,
	`last_run` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `candidate_conflict_tags` (
	`candidate_id` text NOT NULL,
	`side` text NOT NULL,
	`position` integer NOT NULL,
	`k` text NOT NULL,
	`v` text NOT NULL,
	PRIMARY KEY(`candidate_id`, `side`, `position`),
	FOREIGN KEY (`candidate_id`) REFERENCES `candidates`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `candidate_nearby` (
	`candidate_id` text NOT NULL,
	`position` integer NOT NULL,
	`label` text NOT NULL,
	PRIMARY KEY(`candidate_id`, `position`),
	FOREIGN KEY (`candidate_id`) REFERENCES `candidates`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `candidates` (
	`id` text PRIMARY KEY NOT NULL,
	`osm_id` text NOT NULL,
	`area_id` text NOT NULL,
	`source_id` text NOT NULL,
	`type` text NOT NULL,
	`name` text NOT NULL,
	`addr` text NOT NULL,
	`lat` real NOT NULL,
	`lon` real NOT NULL,
	`conf` real NOT NULL,
	`version` integer NOT NULL,
	`fetched_at` integer NOT NULL,
	`age` text NOT NULL,
	`stale` integer,
	`base_version` integer,
	`head_version` integer,
	`conflict_who` text,
	`unchanged` text NOT NULL,
	FOREIGN KEY (`area_id`) REFERENCES `areas`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`source_id`) REFERENCES `sources`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `candidates_queue_idx` ON `candidates` (`area_id`,`conf`);--> statement-breakpoint
CREATE INDEX `candidates_source_idx` ON `candidates` (`source_id`);--> statement-breakpoint
CREATE INDEX `candidates_fetched_idx` ON `candidates` (`fetched_at`);--> statement-breakpoint
CREATE TABLE `changesets` (
	`id` text PRIMARY KEY NOT NULL,
	`osm_id` text,
	`url` text NOT NULL,
	`uploaded_at` integer NOT NULL,
	`comment` text NOT NULL,
	`objects` text NOT NULL,
	`result` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `changesets_uploaded_idx` ON `changesets` (`uploaded_at`);--> statement-breakpoint
CREATE TABLE `evidence` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`tag_id` integer NOT NULL,
	`path` text NOT NULL,
	`url` text NOT NULL,
	`when` text NOT NULL,
	`kind` text NOT NULL,
	`conf` real NOT NULL,
	FOREIGN KEY (`tag_id`) REFERENCES `candidate_tags`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `evidence_tag_idx` ON `evidence` (`tag_id`);--> statement-breakpoint
CREATE TABLE `evidence_parts` (
	`evidence_id` integer NOT NULL,
	`position` integer NOT NULL,
	`text` text NOT NULL,
	`mark` integer NOT NULL,
	PRIMARY KEY(`evidence_id`, `position`),
	FOREIGN KEY (`evidence_id`) REFERENCES `evidence`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `rels` (
	`rel` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`meta` text NOT NULL,
	`center_lat` real NOT NULL,
	`center_lon` real NOT NULL,
	`km` real NOT NULL,
	`sqkm` real NOT NULL,
	`pois` text NOT NULL,
	`est` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `runs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`source_id` text NOT NULL,
	`started_at` integer NOT NULL,
	`dur` text NOT NULL,
	`fetched` text NOT NULL,
	`cands` text NOT NULL,
	`errors` text NOT NULL,
	`result` text NOT NULL,
	FOREIGN KEY (`source_id`) REFERENCES `sources`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `runs_source_idx` ON `runs` (`source_id`,`started_at`);--> statement-breakpoint
CREATE TABLE `sessions` (
	`token` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`via` text NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `sessions_user_idx` ON `sessions` (`user_id`);--> statement-breakpoint
CREATE TABLE `source_allowed_tags` (
	`source_id` text NOT NULL,
	`position` integer NOT NULL,
	`pattern` text NOT NULL,
	PRIMARY KEY(`source_id`, `position`),
	FOREIGN KEY (`source_id`) REFERENCES `sources`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `source_config_rows` (
	`source_id` text NOT NULL,
	`position` integer NOT NULL,
	`label` text NOT NULL,
	`value` text NOT NULL,
	`tone` text,
	PRIMARY KEY(`source_id`, `position`),
	FOREIGN KEY (`source_id`) REFERENCES `sources`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `source_metric_rows` (
	`source_id` text NOT NULL,
	`position` integer NOT NULL,
	`label` text NOT NULL,
	`value` text NOT NULL,
	`note` text,
	`tone` text,
	PRIMARY KEY(`source_id`, `position`),
	FOREIGN KEY (`source_id`) REFERENCES `sources`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `sources` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`kind` text NOT NULL,
	`kind_label` text NOT NULL,
	`health` text NOT NULL,
	`failing` integer DEFAULT false NOT NULL,
	`floor` real NOT NULL
);
--> statement-breakpoint
CREATE TABLE `candidate_tags` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`candidate_id` text NOT NULL,
	`position` integer NOT NULL,
	`op` text NOT NULL,
	`k` text NOT NULL,
	`v` text NOT NULL,
	`was` text,
	`conf` real NOT NULL,
	`invalid` integer DEFAULT false NOT NULL,
	`invalid_msg` text,
	`invalid_hint` text,
	FOREIGN KEY (`candidate_id`) REFERENCES `candidates`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `candidate_tags_position_idx` ON `candidate_tags` (`candidate_id`,`position`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`email` text NOT NULL,
	`role` text NOT NULL,
	`initials` text NOT NULL,
	`password_hash` text,
	`osm` text,
	`last_seen` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_idx` ON `users` (`email`);