ALTER TABLE `entry` ADD `purged_at` integer;--> statement-breakpoint
CREATE INDEX `entry_trash_idx` ON `entry` (`user_id`,`deleted_at`) WHERE "entry"."deleted_at" IS NOT NULL AND "entry"."purged_at" IS NULL;--> statement-breakpoint
ALTER TABLE `journal` ADD `purged_at` integer;--> statement-breakpoint
-- Rows deleted over 30 days ago already lost their photo and attachment files to the old cleanup,
-- so they never enter the trash: mark them purged and scrub them the way repo/trash.ts does.
UPDATE `entry` SET `purged_at` = `deleted_at`, `body_md` = '', `source_raw` = NULL, `mood_key` = NULL, `mood_suggested` = NULL, `mood_suggested_by` = NULL WHERE `deleted_at` IS NOT NULL AND `deleted_at` < strftime('%s', 'now') * 1000 - 2592000000;--> statement-breakpoint
UPDATE `journal` SET `purged_at` = `deleted_at`, `name` = '', `description` = NULL WHERE `deleted_at` IS NOT NULL AND `deleted_at` < strftime('%s', 'now') * 1000 - 2592000000;--> statement-breakpoint
DELETE FROM `entry_location` WHERE `entry_id` IN (SELECT `id` FROM `entry` WHERE `purged_at` IS NOT NULL);--> statement-breakpoint
DELETE FROM `entry_weather` WHERE `entry_id` IN (SELECT `id` FROM `entry` WHERE `purged_at` IS NOT NULL);--> statement-breakpoint
DELETE FROM `entry_tag` WHERE `entry_id` IN (SELECT `id` FROM `entry` WHERE `purged_at` IS NOT NULL);--> statement-breakpoint
DELETE FROM `tag` WHERE `id` NOT IN (SELECT `tag_id` FROM `entry_tag`);