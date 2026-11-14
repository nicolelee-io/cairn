-- Maps each entry to its row in the search index, so an edit can delete the old row by rowid
-- instead of scanning entry_fts (its entry_id column is UNINDEXED: FTS5 can't index it). An
-- INTEGER PRIMARY KEY is the rowid itself, which VACUUM never renumbers; entry_fts rows are
-- written with that same rowid. Starts empty; startup rebuilds both because INDEX_VERSION moved to 3.
CREATE TABLE `entry_fts_key` (
  `fts_rowid` integer PRIMARY KEY NOT NULL,
  `entry_id` text NOT NULL
);--> statement-breakpoint
CREATE UNIQUE INDEX `entry_fts_key_entry_id_unique` ON `entry_fts_key` (`entry_id`);
