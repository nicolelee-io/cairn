import { TITLE_MAX, plainLine, splitTitle, summarize } from '@cairn/shared'

// The card rules (summarize, plainLine, TITLE_MAX) and the title/body split search uses
// (splitTitle, markdownToPlain) live in @cairn/shared so the web app's offline cards and offline
// search use the same ones; re-exported here for the server's callers.
export { TITLE_MAX, plainLine, splitTitle, summarize }
