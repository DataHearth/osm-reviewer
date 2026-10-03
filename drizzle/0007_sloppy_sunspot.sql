PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_decision_tags` (
	`candidate_id` text NOT NULL,
	`position` integer NOT NULL,
	`tag_id` integer,
	`op` text NOT NULL,
	`k` text NOT NULL,
	`v` text NOT NULL,
	`was` text,
	PRIMARY KEY(`candidate_id`, `k`),
	FOREIGN KEY (`candidate_id`) REFERENCES `candidate_decisions`(`candidate_id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`tag_id`) REFERENCES `candidate_tags`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
INSERT INTO `__new_decision_tags`("candidate_id", "position", "tag_id", "op", "k", "v", "was") SELECT d."candidate_id", t."position", d."tag_id", t."op", t."k", t."v", t."was" FROM `decision_tags` d JOIN `candidate_tags` t ON t."id" = d."tag_id";--> statement-breakpoint
DROP TABLE `decision_tags`;--> statement-breakpoint
ALTER TABLE `__new_decision_tags` RENAME TO `decision_tags`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
ALTER TABLE `candidates` ADD `record` text;