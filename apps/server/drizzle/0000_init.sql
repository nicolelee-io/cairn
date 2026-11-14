CREATE TABLE `entry` (
	`id` text PRIMARY KEY NOT NULL,
	`source_id` text,
	`user_id` text NOT NULL,
	`journal_id` text NOT NULL,
	`body_md` text DEFAULT '' NOT NULL,
	`created_at` integer NOT NULL,
	`modified_at` integer NOT NULL,
	`timezone` text NOT NULL,
	`starred` integer DEFAULT false NOT NULL,
	`pinned` integer DEFAULT false NOT NULL,
	`all_day` integer DEFAULT false NOT NULL,
	`mood` integer,
	`mood_suggested` integer,
	`mood_suggested_by` text,
	`creation_device` text,
	`source` text DEFAULT 'native' NOT NULL,
	`source_raw` text,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	`rev` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`journal_id`) REFERENCES `journal`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "entry_mood_range" CHECK("entry"."mood" IS NULL OR "entry"."mood" BETWEEN 1 AND 5),
	CONSTRAINT "entry_mood_suggested_range" CHECK("entry"."mood_suggested" IS NULL OR "entry"."mood_suggested" BETWEEN 1 AND 5)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `entry_user_source_uq` ON `entry` (`user_id`,`source_id`);--> statement-breakpoint
CREATE INDEX `entry_timeline_idx` ON `entry` (`user_id`,`journal_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `entry_rev_idx` ON `entry` (`user_id`,`rev`);--> statement-breakpoint
CREATE TABLE `entry_tag` (
	`entry_id` text NOT NULL,
	`tag_id` text NOT NULL,
	`user_id` text NOT NULL,
	PRIMARY KEY(`entry_id`, `tag_id`),
	FOREIGN KEY (`entry_id`) REFERENCES `entry`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`tag_id`) REFERENCES `tag`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `entry_tag_tag_idx` ON `entry_tag` (`tag_id`);--> statement-breakpoint
CREATE TABLE `journal` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`color` text,
	`created_at` integer NOT NULL,
	`archived_at` integer,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	`rev` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `journal_user_idx` ON `journal` (`user_id`,`sort_order`);--> statement-breakpoint
CREATE TABLE `session` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `session_user_idx` ON `session` (`user_id`);--> statement-breakpoint
CREATE INDEX `session_expires_idx` ON `session` (`expires_at`);--> statement-breakpoint
CREATE TABLE `tag` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	`rev` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `tag_user_name_uq` ON `tag` (`user_id`,`name`) WHERE "tag"."deleted_at" IS NULL;--> statement-breakpoint
CREATE TABLE `user` (
	`id` text PRIMARY KEY NOT NULL,
	`username` text NOT NULL,
	`password_hash` text NOT NULL,
	`display_name` text NOT NULL,
	`default_timezone` text DEFAULT 'UTC' NOT NULL,
	`last_rev` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `user_username_unique` ON `user` (`username`);