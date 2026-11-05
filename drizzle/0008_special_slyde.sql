CREATE TABLE `discussion_replies` (
	`id` text PRIMARY KEY NOT NULL,
	`discussion_id` text NOT NULL,
	`author_id` integer NOT NULL,
	`content` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`discussion_id`) REFERENCES `discussions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`author_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `discussion_replies_thread` ON `discussion_replies` (`discussion_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `discussions` (
	`id` text PRIMARY KEY NOT NULL,
	`author_id` integer NOT NULL,
	`problem_id` integer,
	`team_id` text,
	`title` text NOT NULL,
	`content` text NOT NULL,
	`category` text DEFAULT '交流' NOT NULL,
	`pinned` integer DEFAULT 0 NOT NULL,
	`locked` integer DEFAULT 0 NOT NULL,
	`hidden` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`author_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`problem_id`) REFERENCES `oj_problems`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`team_id`) REFERENCES `teams`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `discussions_feed` ON `discussions` (`team_id`,`hidden`,`pinned`,`created_at`);--> statement-breakpoint
CREATE INDEX `discussions_problem` ON `discussions` (`problem_id`);--> statement-breakpoint
CREATE TABLE `sanctions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` integer NOT NULL,
	`actor_id` integer NOT NULL,
	`kind` text NOT NULL,
	`reason` text NOT NULL,
	`expires_at` integer,
	`revoked_at` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`actor_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "sanction_kind" CHECK(kind IN ('mute','ban'))
);
--> statement-breakpoint
CREATE INDEX `sanctions_user` ON `sanctions` (`user_id`,`kind`,`expires_at`);--> statement-breakpoint
CREATE TABLE `solution_comments` (
	`id` text PRIMARY KEY NOT NULL,
	`solution_id` text NOT NULL,
	`author_id` integer NOT NULL,
	`content` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`solution_id`) REFERENCES `solutions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`author_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `solution_comments_thread` ON `solution_comments` (`solution_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `solution_likes` (
	`solution_id` text NOT NULL,
	`user_id` integer NOT NULL,
	PRIMARY KEY(`solution_id`, `user_id`),
	FOREIGN KEY (`solution_id`) REFERENCES `solutions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `solutions` (
	`id` text PRIMARY KEY NOT NULL,
	`problem_id` integer NOT NULL,
	`author_id` integer NOT NULL,
	`title` text NOT NULL,
	`content` text NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`featured` integer DEFAULT 0 NOT NULL,
	`review_note` text DEFAULT '' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`problem_id`) REFERENCES `oj_problems`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`author_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "solution_status" CHECK(status IN ('draft','pending','published','rejected'))
);
--> statement-breakpoint
CREATE INDEX `solutions_feed` ON `solutions` (`problem_id`,`status`,`created_at`);--> statement-breakpoint
CREATE INDEX `solutions_author` ON `solutions` (`author_id`);--> statement-breakpoint
CREATE TABLE `team_members` (
	`team_id` text NOT NULL,
	`user_id` integer NOT NULL,
	`role` text DEFAULT 'member' NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`joined_at` text NOT NULL,
	PRIMARY KEY(`team_id`, `user_id`),
	FOREIGN KEY (`team_id`) REFERENCES `teams`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "team_member_role" CHECK(role IN ('owner','admin','member')),
	CONSTRAINT "team_member_status" CHECK(status IN ('active','pending'))
);
--> statement-breakpoint
CREATE INDEX `team_members_user` ON `team_members` (`user_id`,`team_id`);--> statement-breakpoint
CREATE TABLE `team_problems` (
	`team_id` text NOT NULL,
	`problem_id` integer NOT NULL,
	`added_at` text NOT NULL,
	PRIMARY KEY(`team_id`, `problem_id`),
	FOREIGN KEY (`team_id`) REFERENCES `teams`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`problem_id`) REFERENCES `oj_problems`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `teams` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`owner_id` integer NOT NULL,
	`visibility` text DEFAULT 'public' NOT NULL,
	`join_policy` text DEFAULT 'approval' NOT NULL,
	`join_code` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "team_visibility" CHECK(visibility IN ('public','private')),
	CONSTRAINT "team_join_policy" CHECK(join_policy IN ('open','approval'))
);
--> statement-breakpoint
CREATE TABLE `user_permissions` (
	`user_id` integer NOT NULL,
	`permission` text NOT NULL,
	PRIMARY KEY(`user_id`, `permission`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "permission_name" CHECK(permission IN ('users','posts','solutions','problems','discussions'))
);
