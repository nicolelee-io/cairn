-- Full-text search (Phase 3e). Drizzle can't model virtual tables, so this one is written by hand.
-- Rows are written by src/search/index.ts (the markdown has to be stripped in code, which SQL
-- triggers can't do), keyed by entry_id because a table without an INTEGER PRIMARY KEY may have
-- its rowids renumbered by VACUUM. user_id and entry_id are stored, not indexed.
CREATE VIRTUAL TABLE `entry_fts` USING fts5(
  entry_id UNINDEXED,
  user_id UNINDEXED,
  body,
  place,
  tags,
  tokenize = 'porter unicode61 remove_diacritics 2'
);--> statement-breakpoint
-- Which version of the indexing rules filled entry_fts. When the code's version differs (or this
-- has no row, as on the first start after this migration), startup rebuilds the whole index.
CREATE TABLE `search_state` (
  `key` text PRIMARY KEY NOT NULL,
  `value` text NOT NULL
);
