ALTER TABLE `entry` ADD `mood_key` text;--> statement-breakpoint
UPDATE `entry` SET `mood_key` = CASE `mood` WHEN 1 THEN 'sad' WHEN 2 THEN 'down' WHEN 3 THEN 'meh' WHEN 4 THEN 'content' WHEN 5 THEN 'happy' END WHERE `mood` IS NOT NULL;
