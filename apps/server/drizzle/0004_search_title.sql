-- The search index gets a separate title column (the card's title line), so a snippet isn't the
-- title again and a title match can be highlighted and weighted. A virtual table can't be altered:
-- drop and recreate. It starts empty; startup rebuilds it because INDEX_VERSION moved to 2.
DROP TABLE `entry_fts`;--> statement-breakpoint
CREATE VIRTUAL TABLE `entry_fts` USING fts5(
  entry_id UNINDEXED,
  user_id UNINDEXED,
  title,
  body,
  place,
  tags,
  tokenize = 'porter unicode61 remove_diacritics 2'
);
