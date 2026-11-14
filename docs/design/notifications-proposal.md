# Proposal: notifications (writing reminders first)

Status: proposal, not built. Tracked in [todo-and-ideas.md](../todo-and-ideas.md) under Soon.

## Summary

Cairn can send real notifications to a phone, even when the app is closed, using **Web Push**: the server keeps one push subscription per device and sends a message on a schedule. The service worker shows the message as a notification. This works on Android Chrome, desktop Chrome, Edge and Firefox, and on iPhone and iPad (iOS/iPadOS 16.4 and later) **only when Cairn is installed to the Home Screen**. Nothing on the device can schedule a notification by itself, so the server has to do the scheduling.

It is viable and fits the stack: one small dependency (`web-push`, plain JS), two tables, a one-minute timer in the server process, and two event handlers in `sw.js`. The first version is **custom reminders**: each user sets up their own, each with a time, a schedule, their own text and an optional journal to write in. Other kinds can be added later on the same plumbing.

## Why the server has to schedule it

| Option | Verdict |
| --- | --- |
| **Web Push** (server sends, service worker shows) | **Use this.** The only option that wakes a closed PWA on Android and iOS. |
| Notification Triggers (the page schedules a local notification) | Dead: Chrome ran an origin trial and dropped it; no other browser has it. |
| Periodic Background Sync | Chromium only, installed apps only. The browser picks the timing based on how much you use the site, so it can't hit "9 pm". Not on iOS. |
| `setTimeout` + `new Notification()` in the page | Only works while a tab is open. No use for reminders. |
| ntfy / email | Need a separate app or an email setup. ntfy suits server alerts for the admin (see the existing ntfy item), not every family member. |

## How Web Push works here

1. The page asks for notification permission (it has to be a tap; iOS refuses otherwise), then calls `pushManager.subscribe()` with the server's **VAPID** public key. The browser returns an endpoint URL on its push service (FCM for Chrome, Mozilla's for Firefox, Apple's for Safari/iOS) plus two encryption keys.
2. The page `POST`s that subscription to Cairn, which stores it against the signed-in user.
3. When a reminder is due, the server encrypts a small JSON payload (RFC 8291, so the push service can't read it) and `POST`s it to the endpoint, signed with the VAPID private key. The connection goes out from the server, as with the Google APIs, so an inbound tunnel or proxy is not involved.
4. The browser wakes `sw.js` with a `push` event and it calls `showNotification()`. Tapping the notification fires `notificationclick`, which focuses an open Cairn window or opens one at the URL in the payload (for example `/j/<journalId>/new`).

## Use cases

First version: **custom reminders**. A user can have several (a cap of 20 is plenty). Each one has:

- **Time** of day, in the account's `defaultTimezone` (see "Time zone" below).
- **Schedule:** chosen weekdays (all seven means daily; there are quick picks for Every day, Weekdays and Weekends).
- **Text:** the notification's message, written by the user (1-200 characters). The title is always "Cairn". If the text is left empty, the message is "Time to write".
- **Journal** (optional): tapping the notification opens a new entry in that journal (`/j/<id>/new`). With no journal set, it opens `/new` and uses the default journal. If the journal has since been archived or deleted, `NewEntryPage` already falls back to the default journal, and Settings marks the reminder so the user can pick another. Tapping opens the editor; it doesn't create an empty entry, because an untouched entry would be clutter, and the editor already keeps a draft if the user closes it.
- **Skip if I've already written today** (on by default): with a journal set, this means an entry in that journal today; otherwise an entry in any journal. It uses the same local-day logic as Insights.
- **On/off** switch, so a reminder can be paused without deleting it.
- **Snooze:** the notification has a "Snooze 1 hour" action button, beside a plain tap that opens the editor. Android and desktop Chrome show action buttons. iOS doesn't, so there a tap is the only action. That's fine, because snooze is an extra, never the only way to act on a reminder.

Later, each S-sized once the plumbing exists:

- **Monthly schedules:** on a day of the month (the 31st means the last day in shorter months). This adds a `repeat` column (`weekly` / `monthly`) and a `day_of_month`.

- **On this day.** A morning notification when earlier years have entries for today ("3 memories from this day"); opens Insights. The `/insights/on-this-day` query already exists.
- **Streak at risk.** An evening nudge when the current streak would end tonight. Opt-in, and hidden when the planned "Show writing streak" setting is off.
- **Writing prompts:** a reminder whose text rotates through a list of prompts instead of one fixed message.
- **Snooze length** chosen per reminder, instead of a fixed hour.
- **Admin alerts** (backup failed or stale), sent only to admins' devices: **deferred.** The ntfy item stays in the todo list as the plan for server alerts. Decide whether Web Push should carry these once it has run for a while and proved reliable.

Not worth a push: "a new version is available" (the in-app update notice item handles it when the app opens) and outbox refusals (they happen on the device that is open anyway).

## Design

### Data (one migration)

- `push_subscription`: `id`, `user_id` (indexed, FK cascade), `endpoint` (unique), `p256dh`, `auth`, `label` (for example "Chrome on Android", from the user agent, so Settings can list devices and remove one), `created_at`. Device-level data, not synced and not exported, so it has no `rev`/tombstones (like `session`).
- `reminder`: `id` (client UUID v7, like other user rows), `user_id` (indexed), `enabled`, `message` (nullable: empty means the default text), `journal_id` (nullable; no FK, since journals are tombstoned rather than deleted, and the repo checks ownership on write), `minute_of_day`, `days` (a 7-bit weekday mask), `skip_if_written`, `next_fire_at` (epoch ms, UTC), `snoozed_until` (epoch ms, nullable: a one-off extra firing), `created_at`. Reminders are settings, not journal content: they aren't synced to the device copies or exported, so no `rev`/tombstones. They are deleted outright.
- VAPID key pair: generated on first use and stored in `app_setting` (`vapid_public_key`, `vapid_private_key`), so nobody has to configure anything and backups cover it. If the key is lost, every device just has to switch notifications on again. The VAPID `subject` (a `mailto:` or `https:` URL; Apple rejects pushes without a proper one) comes from a new env var, `PUSH_CONTACT`, falling back to `mailto:` with the first admin's username. **Open question:** does this need to be configurable at all?

### Server

- `src/push/`: `vapid.ts` (load or create keys), `send.ts` (a thin wrapper around `web-push` behind a `PushSender` interface so tests can fake it), `schedule.ts` (pure functions: `nextFireAt(reminder, tz, now)`, using `Intl` the same way the Insights code does), `scheduler.ts` (the timer).
- Scheduler: `setInterval(tick, 60_000).unref()` in `index.ts`, beside `sweepPhotos`. Each tick reads `reminder WHERE enabled AND next_fire_at <= now`, sends to each of that user's subscriptions, then moves `next_fire_at` forward. If the server was down past a reminder's time (an update, a restart), send it only if it is less than about 2 hours late; otherwise skip it. Each send updates `next_fire_at` before the network call, so a crash can't send twice. This costs very little RAM.
- DST: `nextFireAt` works in local wall-clock time and converts to UTC on each run. A time that doesn't exist on the spring-forward day (02:30) fires at the next valid minute. A time that happens twice in the fall fires once.
- Snooze: the tick also picks up `snoozed_until <= now`. It sends the reminder again (skip-if-written still applies, so writing in the meantime cancels it) and clears the column. A snooze doesn't move `next_fire_at`. Snoozing again just sets a new time. If the snooze would land past the next scheduled firing, the scheduled one wins, so the user isn't reminded twice.
- Changing the account's `defaultTimezone` recomputes `next_fire_at` for all of that user's reminders (in the same transaction as the `PATCH /api/auth/me`).
- Results from the push service: `404`/`410` means the subscription is gone, so delete the row. `413`/`400` are logged. `429`/`5xx` are retried on the next tick, at most once.
- Every query goes through the repository layer with `userId` (`createRepos`), so subscriptions and reminders are user-scoped like everything else. Extend `isolation.test.ts`: user A can't list, delete or test-send to user B's subscriptions, and can't read or change B's reminders. That includes admins.
- Payloads carry no entry content: the title, the reminder's own text, a `url` and a `tag` (the reminder id, so a missed one is replaced rather than stacked). The text is whatever the user typed, so the Settings dialog says it shows on the lock screen. Push payloads are end-to-end encrypted, so the push services can't read it either way.
- Lifecycle: delete a user's subscriptions when they are disabled, and whenever all of their sessions end (password reset by CLI or admin, password change). The "this device" subscription is also removed on sign-out (below). Restoring an old backup brings back stale rows; the first `410` clears them.

API (Zod in `packages/shared/src/push.ts`):

- `GET /api/push/key`: the VAPID public key.
- `POST /api/push/subscriptions {endpoint, keys, label}`: idempotent on `endpoint`. If the endpoint belonged to another user (a shared device), it moves to the caller.
- `DELETE /api/push/subscriptions {endpoint}`: removes the caller's own subscription only.
- `GET /api/push/subscriptions`: the caller's devices (id, label, created). `DELETE /api/push/subscriptions/:id`: remove one.
- `POST /api/push/test`: sends "Notifications are working" to the caller's devices.
- `GET /api/reminders`, `POST /api/reminders` (idempotent on a client id), `PATCH/DELETE /api/reminders/:id`: the caller's reminders. Writes validate the time, schedule, text length and journal (it must be the caller's own and not deleted; another user's journal id is a 404, like everywhere else), and recompute `next_fire_at`. Over the cap is `409 too_many`.
- `POST /api/reminders/:id/snooze`: sets `snoozed_until` to an hour from now. Called by the service worker, not the page.

### Web app

- `sw.js`: `push` (parse the payload, `showNotification` with `icon-192.png`, the monochrome icon as `badge`, and the payload's `tag` so a newer reminder replaces an old one), `notificationclick` (a plain tap focuses or opens a window, then navigates it to `data.url`; the `snooze` action instead POSTs `/api/reminders/:id/snooze` from the worker and opens nothing. Same-origin worker fetches carry the session and Cloudflare Access cookies and an `Origin` header, so `originCheck` passes. If the call fails, for example because the Access session expired, the snooze is lost; a failure can't be retried later, since there's nothing on the device that can schedule it), and `pushsubscriptionchange` (subscribe again and POST; mostly Firefox). Every push has to show a notification: Chrome shows a generic one if it doesn't, and Safari can revoke the subscription. So "skip if written" has to be decided on the server, not by the worker.
- `lib/push.ts`: `isPushSupported()`, `pushState()` (unsupported / needs install / denied / off / on), `enablePush()` (permission, then subscribe, then POST), `disablePush()`. On every app start, signed in, if `getSubscription()` returns one, POST it again (idempotent). This repairs a subscription the browser rotated while the server or Cloudflare Access couldn't be reached.
- Sign-out and 401: `clearOfflineData` also unsubscribes this device and sends the DELETE (best effort; the server-side session-end cleanup covers a failed call).
- Settings > **Notifications** (a new subpage):
  - "Notifications on this device" switch, with the state written out: "Install Cairn to your Home Screen first" (iOS in a browser tab, detected with `display-mode: standalone`), "Blocked in browser settings" (permission denied), and so on.
  - Reminders: a list (time, schedule in words such as "Weekdays at 21:00", text, journal chip, an on/off switch per row) and Add reminder. Tapping a row opens a dialog with the time, the schedule (weekday chips and the quick picks), the text, a journal picker ("Default journal" first; archived journals not offered) and "Skip if I've already written today", plus Delete as a confirm step. Needs the server (no outbox), so it shows `NeedsConnection` while down, like Manage tags.
  - "Send a test notification" button.
  - Devices that get notifications, each with Remove (a family member may have a phone and a laptop).
- No CSP change: subscribing and receiving don't go through `fetch` from the page.

### Testing

- Unit (vitest): `nextFireAt` across DST in `America/New_York` and `Europe/London`, weekday masks, the late-reminder window, snooze (fires once, is cancelled by writing, yields to the next scheduled firing), skip-if-written at the local-day boundary (an entry at 23:30 in its own zone versus the account zone) and scoped to the reminder's journal, and the scheduler with a fake clock and a fake `PushSender` (including the `410` cleanup and no double send).
- Route tests: validation, the reminder cap, a reminder pointing at another user's journal (404), recompute on a timezone change, idempotent subscribe, the isolation cases above, and subscriptions removed on disable and password reset.
- e2e: Playwright can grant the notification permission, but headless Chromium has no real push service, so cover only the Settings page states. Delivery itself needs a hand check on the real targets: the Pixel (Chrome, installed), an iPhone (installed PWA) and desktop Chrome, with the screen locked and the app closed.

## Limits and risks

- **iOS:** the app must be installed to the Home Screen and the permission requested from a tap. Each Home Screen install has its own subscription. Notifications stop if the app is removed. Apple doesn't document how long a subscription stays valid when the app isn't opened, so expect the occasional "switch it on again".
- **Desktop:** delivered only while the browser is running (closed tabs are fine).
- **Android:** battery savers can delay a push by a few minutes. Fine for reminders.
- **Every device of the user gets every reminder.** A per-device choice of kinds is possible later if this is annoying; it isn't in the first version.
- **Entries written offline:** the server doesn't know about an entry waiting in the outbox, so "skip if written" can still remind someone who wrote offline that day. Acceptable.
- **The push services are third parties** (Google, Apple, Mozilla): they see when a device gets a push and how big it is, not what it says. Payloads stay content-free regardless.

## Dependency

`web-push` (MIT, plain JS, well established; depends on `asn1.js`, `http_ece`, `jws`, `https-proxy-agent`, `minimist`). esbuild bundles it, so it needs no `--external` and no Dockerfile change. The alternative is to write VAPID signing (ES256 JWT) and aes128gcm encryption with `node:crypto`, about 150 lines. That means no new dependency, but it is crypto code that would need its own test vectors. Recommendation: use `web-push` (the boring choice). Revisit only if its dependencies become a problem.

## Plan and estimate

1. **Push plumbing**: migration, VAPID keys, subscription routes and isolation tests, `sw.js` handlers, `lib/push.ts`, the Settings page with the device switch, the test button and the device list. _Opus, M._ (The Opus part is mostly the lifecycle and user-scoping.)
2. **Custom reminders**: `reminder` table, routes, `nextFireAt` and the scheduler with their tests, the Reminders list and dialog in Settings, snooze. _Sonnet, M to L._ (Several reminders, the journal option, snooze and the timezone recompute make it more than one daily reminder would be, but they all follow existing patterns.)
3. **Later extras** (device time zone, monthly schedules, On this day, streak at risk, writing prompts, snooze length): _Sonnet, S each._

Total for 1 and 2: about L, plus the hand check on real phones. Update `apps/server/CLAUDE.md`, `apps/web/src/lib/CLAUDE.md` (service worker), SPEC.md Phase 8 notes and README Features when this is built.

## Time zone

Decided: reminders fire in the account's `defaultTimezone` for now, like Insights.

Following the device's zone is a planned extra, and nothing in the first version gets in its way. It would add a nullable `timezone` column to `reminder` (null means follow the account), a "Use my current time zone" choice in the dialog, and an update from the app when it opens in a zone the reminders don't match (it would ask first, or do it quietly if the reminder is set to follow the device). Then `next_fire_at` is recomputed. `nextFireAt` already takes the zone as a parameter, so this is one small migration and an S of work. It's not worth building first: until a user travels, it behaves exactly the same as the account zone, and the account zone can already be switched to "this device's timezone" in one tap in Account settings.

## Decisions

- Reminders fire in the account timezone; the device's zone comes later (above).
- First version: custom reminders on weekdays with snooze. Monthly schedules come later.
- Admin alerts stay off Web Push for now; ntfy remains the plan for server alerts.
