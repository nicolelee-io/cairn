---
name: verify-ui
description: Run a private Cairn instance (own data dir, ports 3100/5273, headless Chromium) and check a UI change at phone, tablet and desktop widths in light and dark. Use before calling any UI change done, or when asked to screenshot or try the app.
---

# Verify a UI change in Cairn

The user often leaves `npm run dev` running (server :3000, Vite :5173, DB `data-dev`). Never point the private instance at those, and never use `data-dev` or the real journal: entries are private diary text. Use the sample fixture or invented entries. Stopping the user's dev server is fine when it is in the way (or ask them to); note that its `tsx watch` restarts on every save, so it runs half-finished server edits against `data-dev`, startup cleanup included.

## 1. Start a private instance

Run each as a background command from the repo root. `$S` is the session scratchpad directory.

```
# server: its own data dir and a throwaway login (env beats the repo .env)
DATA_DIR=$S/data PORT=3100 INITIAL_USERNAME=test INITIAL_PASSWORD=test-password-123 npm run dev -w @cairn/server

# web, proxied to that server
cd apps/web && API_URL=http://localhost:3100 npx vite --port 5273 --strictPort
```

Optional sample data: `DATA_DIR=$S/data npm run import:journal -- fixtures/sample-dayone-export.zip`.

## 2. Browser

Playwright's headless Chromium, which the chrome-devtools tools attach to. Only the headless shell is installed (the version number changes when Playwright updates; the glob picks the newest):

```
CHROME=$(ls -d ~/.cache/ms-playwright/chromium_headless_shell-*/chrome-headless-shell-linux*/chrome-headless-shell | tail -1)
$CHROME --no-sandbox --remote-debugging-port=9222 --user-data-dir=$S/chrome
```

If that finds nothing, `npx playwright install chromium` (or look in `~/.cache/ms-playwright/` for a full `chromium-*` build, whose binary is `chrome-linux*/chrome` and needs `--headless=new`). The browser starts with no tab, so open one with `new_page` rather than `navigate_page`. Open http://localhost:5273 and sign in as `test`. The page renders a moment after load, so take a snapshot (or `wait_for` some text) before trusting a screenshot.

## 3. Check

- Widths **390px** (phone), **~720px** (tablet, single pane), **1400px** (sidebar plus two panes); add **840-1199px** when the layout around the bottom bar or panes changed.
- **Light and dark** at each: emulate `prefers-color-scheme`, or Settings > Theme (stored per device).
- Look at what the user nitpicks: spacing and alignment against neighbouring elements, truncation, the FAB, bottom bar and toast positions, focus rings, and the on-screen keyboard region in the editor.
- The service worker only registers in a production build; for offline behaviour see `apps/web/src/lib/CLAUDE.md` (PWA).

For behaviour (not looks) in the flows it covers, also run `npm run e2e` (own server on :3200; see `docs/e2e-testing.md`).

## 4. Clean up

Kill only your own processes. The server is `tsx watch`: killing just the process on :3100 makes the watcher start a new one, so stop the watcher too. Match by environment (the scratchpad `DATA_DIR`, or `API_URL` for Vite), which catches the npm, sh, tsx-watch and node layers and nothing of the user's. Don't use `pkill -f` or `kill $(pgrep -f ...)` on a pattern: it matches your own shell and kills it (exit 144).

```
for p in $(pgrep -u "$(id -u)" -f "tsx|vite|node"); do
  tr '\0' '\n' < /proc/$p/environ 2>/dev/null \
    | grep -q "^DATA_DIR=$S/data\|^API_URL=http://localhost:3100" && kill $p
done
ps -eo pid,args | grep "[r]emote-debugging-port=9222" | awk '{print $1}' | xargs -r kill
sleep 2; ss -ltn | grep -E ":3100 |:5273 " || echo "ports free"
```

If a port is still taken, `ss -ltnp | grep 3100` names the pid; check `/proc/<pid>/environ` before killing it.
