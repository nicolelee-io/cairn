CREATE TABLE `entry_location` (
	`entry_id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`latitude` real NOT NULL,
	`longitude` real NOT NULL,
	`place_name` text,
	`locality` text,
	`region` text,
	`country` text,
	`address` text,
	`user_label` text,
	`google_place_id` text,
	FOREIGN KEY (`entry_id`) REFERENCES `entry`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `entry_weather` (
	`entry_id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`temp_c` real,
	`feels_like_c` real,
	`condition` text NOT NULL,
	`is_day` integer,
	`description` text,
	`pressure_mb` real,
	`humidity_pct` real,
	`wind_kph` real,
	`wind_bearing` real,
	`visibility_km` real,
	`sunrise` integer,
	`sunset` integer,
	`source` text NOT NULL,
	`source_code` text,
	`fetched_at` integer,
	`raw` text,
	FOREIGN KEY (`entry_id`) REFERENCES `entry`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `photo` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`entry_id` text NOT NULL,
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
CREATE INDEX `photo_entry_idx` ON `photo` (`user_id`,`entry_id`,`position`);--> statement-breakpoint
CREATE INDEX `photo_sha_idx` ON `photo` (`user_id`,`sha256`);--> statement-breakpoint
CREATE INDEX `photo_rev_idx` ON `photo` (`user_id`,`rev`);