ALTER TABLE `sources` ADD `endpoint` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `sources` ADD `api_key` text;--> statement-breakpoint
ALTER TABLE `sources` ADD `schedule` text DEFAULT 'weekly' NOT NULL;--> statement-breakpoint
ALTER TABLE `sources` ADD `matching` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `sources` ADD `budget` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `sources` ADD `extractor` text DEFAULT 'deterministic' NOT NULL;--> statement-breakpoint
ALTER TABLE `sources` ADD `preset` text;--> statement-breakpoint
ALTER TABLE `sources` ADD `licence` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `sources` ADD `next_run_at` integer;--> statement-breakpoint
ALTER TABLE `sources` ADD `run_requested_at` integer;--> statement-breakpoint
ALTER TABLE `sources` ADD `running_since` integer;--> statement-breakpoint
ALTER TABLE `sources` ADD `sync_state` text;--> statement-breakpoint
UPDATE `sources` SET
	`endpoint` = coalesce((
		SELECT CASE WHEN instr(c.`value`, ' · ') > 0 THEN substr(c.`value`, 1, instr(c.`value`, ' · ') - 1) ELSE c.`value` END
		FROM `source_config_rows` c
		WHERE c.`source_id` = `sources`.`id` AND c.`label` IN ('dataset', 'seed rule', 'endpoint')
		LIMIT 1
	), ''),
	`schedule` = coalesce((
		SELECT c.`value` FROM `source_config_rows` c
		WHERE c.`source_id` = `sources`.`id` AND c.`label` = 'schedule'
		  AND c.`value` IN ('every 12 h', 'daily', 'weekly', 'monthly')
		LIMIT 1
	), 'weekly'),
	`extractor` = CASE WHEN EXISTS (
		SELECT 1 FROM `source_config_rows` c
		WHERE c.`source_id` = `sources`.`id` AND c.`label` = 'extractor' AND c.`value` NOT LIKE 'deterministic%'
	) THEN 'model' ELSE 'deterministic' END;--> statement-breakpoint
DROP TABLE `rels`;--> statement-breakpoint
DROP TABLE `source_config_rows`;--> statement-breakpoint
DROP TABLE `source_metric_rows`;--> statement-breakpoint
ALTER TABLE `sources` DROP COLUMN `kind_label`;--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_areas` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`def` text NOT NULL,
	`rel` text,
	`level` integer,
	`display_name` text,
	`bbox` text,
	`center_lat` real NOT NULL,
	`center_lon` real NOT NULL,
	`km` real,
	`radius` integer,
	`sqkm` real NOT NULL,
	`pois` integer,
	`paused` integer DEFAULT false NOT NULL,
	`last_run_at` integer
);
--> statement-breakpoint
INSERT INTO `__new_areas`("id", "name", "def", "rel", "level", "center_lat", "center_lon", "km", "radius", "sqkm", "pois", "paused") SELECT "id", "name", "def", "rel", "level", "center_lat", "center_lon", "km", "radius", "sqkm", nullif(cast(replace("pois", ',', '') AS integer), 0), ("status" = 'paused') FROM `areas`;--> statement-breakpoint
DROP TABLE `areas`;--> statement-breakpoint
ALTER TABLE `__new_areas` RENAME TO `areas`;--> statement-breakpoint
CREATE TABLE `__new_candidates` (
	`id` text PRIMARY KEY NOT NULL,
	`osm_id` text,
	`source_record_key` text NOT NULL,
	`content_hash` text,
	`seen_at` integer,
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
	`base_version` integer,
	`head_version` integer,
	`conflict_who` text,
	`unchanged_tags` text DEFAULT '[]' NOT NULL,
	FOREIGN KEY (`area_id`) REFERENCES `areas`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`source_id`) REFERENCES `sources`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_candidates`("id", "osm_id", "source_record_key", "area_id", "source_id", "type", "name", "addr", "lat", "lon", "conf", "version", "fetched_at", "base_version", "head_version", "conflict_who") SELECT "id", "osm_id", "id", "area_id", "source_id", "type", "name", "addr", "lat", "lon", "conf", "version", "fetched_at", "base_version", "head_version", "conflict_who" FROM `candidates`;--> statement-breakpoint
DROP TABLE `candidates`;--> statement-breakpoint
ALTER TABLE `__new_candidates` RENAME TO `candidates`;--> statement-breakpoint
CREATE UNIQUE INDEX `candidates_source_record_idx` ON `candidates` (`source_id`,`source_record_key`);--> statement-breakpoint
CREATE INDEX `candidates_queue_idx` ON `candidates` (`area_id`,`conf`);--> statement-breakpoint
CREATE INDEX `candidates_source_idx` ON `candidates` (`source_id`);--> statement-breakpoint
CREATE INDEX `candidates_fetched_idx` ON `candidates` (`fetched_at`);--> statement-breakpoint
CREATE TABLE `__new_runs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`source_id` text NOT NULL,
	`started_at` integer NOT NULL,
	`dur_ms` integer NOT NULL,
	`fetched` integer NOT NULL,
	`cands` integer NOT NULL,
	`errors` integer NOT NULL,
	`result` text NOT NULL,
	`message` text,
	FOREIGN KEY (`source_id`) REFERENCES `sources`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_runs`("id", "source_id", "started_at", "dur_ms", "fetched", "cands", "errors", "result") SELECT "id", "source_id", "started_at", CASE WHEN "dur" LIKE '% min' THEN cast("dur" AS integer) * 60000 WHEN "dur" LIKE '% s' THEN cast("dur" AS integer) * 1000 ELSE 0 END, cast(replace("fetched", ',', '') AS integer), cast("cands" AS integer), cast("errors" AS integer), CASE WHEN "result" LIKE 'ok%' THEN 'ok' ELSE 'failed' END FROM `runs`;--> statement-breakpoint
DROP TABLE `runs`;--> statement-breakpoint
ALTER TABLE `__new_runs` RENAME TO `runs`;--> statement-breakpoint
CREATE INDEX `runs_source_idx` ON `runs` (`source_id`,`started_at`);--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
ALTER TABLE `changesets` ADD `error` text;--> statement-breakpoint
ALTER TABLE `changesets` ADD `uploaded_by` text REFERENCES users(id);--> statement-breakpoint
ALTER TABLE `user_settings` ADD `osm_token` text;--> statement-breakpoint
ALTER TABLE `user_settings` ADD `osm_user_name` text;--> statement-breakpoint
ALTER TABLE `user_settings` ADD `osm_user_id` integer;--> statement-breakpoint
UPDATE `user_settings` SET `osm_user_name` = (SELECT `osm` FROM `users` WHERE `users`.`id` = `user_settings`.`user_id`);--> statement-breakpoint
ALTER TABLE `user_settings` DROP COLUMN `osm_target`;--> statement-breakpoint
ALTER TABLE `area_sources` DROP COLUMN `candidate_count`;--> statement-breakpoint
ALTER TABLE `area_sources` DROP COLUMN `accept_rate`;--> statement-breakpoint
ALTER TABLE `users` DROP COLUMN `osm`;
