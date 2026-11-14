PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_photo` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`entry_id` text,
	`position` integer NOT NULL,
	`original_path` text NOT NULL,
	`display_path` text,
	`thumb_path` text,
	`mime` text NOT NULL,
	`width` integer,
	`height` integer,
	`bytes` integer NOT NULL,
	`sha256` text NOT NULL,
	`taken_at` integer,
	`latitude` real,
	`longitude` real,
	`source_ref` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	`rev` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`entry_id`) REFERENCES `entry`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_photo`("id", "user_id", "entry_id", "position", "original_path", "display_path", "thumb_path", "mime", "width", "height", "bytes", "sha256", "taken_at", "latitude", "longitude", "source_ref", "created_at", "updated_at", "deleted_at", "rev") SELECT "id", "user_id", "entry_id", "position", "original_path", "display_path", "thumb_path", "mime", "width", "height", "bytes", "sha256", "taken_at", "latitude", "longitude", "source_ref", "created_at", "updated_at", "deleted_at", "rev" FROM `photo`;--> statement-breakpoint
DROP TABLE `photo`;--> statement-breakpoint
ALTER TABLE `__new_photo` RENAME TO `photo`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `photo_entry_idx` ON `photo` (`user_id`,`entry_id`,`position`);--> statement-breakpoint
CREATE INDEX `photo_sha_idx` ON `photo` (`user_id`,`sha256`);--> statement-breakpoint
CREATE INDEX `photo_rev_idx` ON `photo` (`user_id`,`rev`);