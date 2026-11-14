ALTER TABLE `user` ADD `role` text DEFAULT 'user' NOT NULL;--> statement-breakpoint
ALTER TABLE `user` ADD `disabled_at` integer;--> statement-breakpoint
-- Everyone who existed before roles ran the server, so they all become admins.
UPDATE `user` SET `role` = 'admin';
