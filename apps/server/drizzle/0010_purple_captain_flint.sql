CREATE TABLE `attachment` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`entry_id` text,
	`kind` text NOT NULL,
	`position` integer NOT NULL,
	`path` text NOT NULL,
	`mime` text NOT NULL,
	`bytes` integer NOT NULL,
	`sha256` text NOT NULL,
	`filename` text NOT NULL,
	`source_ref` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	`rev` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`entry_id`) REFERENCES `entry`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `attachment_entry_idx` ON `attachment` (`user_id`,`entry_id`,`position`);--> statement-breakpoint
CREATE INDEX `attachment_sha_idx` ON `attachment` (`user_id`,`sha256`);--> statement-breakpoint
CREATE INDEX `attachment_rev_idx` ON `attachment` (`user_id`,`rev`);--> statement-breakpoint
CREATE INDEX `entry_all_timeline_idx` ON `entry` (`user_id`,`created_at`,`id`);