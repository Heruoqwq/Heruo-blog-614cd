ALTER TABLE `oj_files` ADD `team_id` text REFERENCES teams(id);--> statement-breakpoint
ALTER TABLE `oj_problems` ADD `team_id` text REFERENCES teams(id);