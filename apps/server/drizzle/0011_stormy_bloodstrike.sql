-- Tag names now match ignoring case. Before the unique index can be rebuilt, fold any existing
-- tags that differ only by case (e.g. an imported "Travel" and "travel") into the oldest one.
-- Each loser's entries move to the keeper; the loser rows are deleted (nothing but entry_tag refers
-- to a tag, and the sync feed carries tag names, not tag rows). Entry revs are left alone: a card
-- on a device that already synced keeps the old capitalisation until its entry next changes.
CREATE TEMP TABLE `tag_fold` AS
SELECT t.`id` AS `loser`,
  (SELECT k.`id` FROM `tag` k
    WHERE k.`user_id` = t.`user_id` AND lower(k.`name`) = lower(t.`name`) AND k.`deleted_at` IS NULL
    ORDER BY k.`created_at`, k.`id` LIMIT 1) AS `keeper`
FROM `tag` t WHERE t.`deleted_at` IS NULL;--> statement-breakpoint
DELETE FROM `tag_fold` WHERE `loser` = `keeper`;--> statement-breakpoint
INSERT OR IGNORE INTO `entry_tag` (`entry_id`, `tag_id`, `user_id`)
SELECT et.`entry_id`, f.`keeper`, et.`user_id` FROM `entry_tag` et JOIN `tag_fold` f ON f.`loser` = et.`tag_id`;--> statement-breakpoint
DELETE FROM `entry_tag` WHERE `tag_id` IN (SELECT `loser` FROM `tag_fold`);--> statement-breakpoint
DELETE FROM `tag` WHERE `id` IN (SELECT `loser` FROM `tag_fold`);--> statement-breakpoint
DROP TABLE `tag_fold`;--> statement-breakpoint
DROP INDEX `tag_user_name_uq`;--> statement-breakpoint
CREATE UNIQUE INDEX `tag_user_name_uq` ON `tag` (`user_id`,lower("name")) WHERE "tag"."deleted_at" IS NULL;