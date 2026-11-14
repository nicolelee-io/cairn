// Where lists kept on this device start in localStorage (lib/cachedList.ts). Its own module with no
// imports: offlineCache.ts (which `api()` reaches) needs the prefixes to clear them, and importing
// cachedList.ts for them would pull in the auth hook and the outbox before `api()` has loaded (an
// import cycle that left the whole app blank).

export const PROMPTS_CACHE = 'cairn:prompts-cache:'
export const TEMPLATES_CACHE = 'cairn:templates-cache:'
/** Every key lib/cachedList.ts writes starts with one of these; signing out deletes them all. */
export const CACHED_LIST_PREFIXES = [PROMPTS_CACHE, TEMPLATES_CACHE]
