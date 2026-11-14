# Proposal: end-to-end encryption

Status: not being pursued (2026-11-08), kept for reference. An admin who wanted to read entries could still change the app's code, and users already have to trust their admin, so this would mostly keep out people who were never a problem. [server-encryption-proposal.md](server-encryption-proposal.md) covers the actual goal, preventing accidental viewing, at far less cost.

## Summary

A user could turn on encryption for their account. Their device generates a key and shows it once, they save it, and they type it once on each other device. From then on the server stores only ciphertext. Lose the key with no device still unlocked, and the data is gone.

It can be built, and the server is not the problem: **it would do less work, not more.** The server does no cryptography, and search, photo processing and exports move to the devices. The cost is in the client: about 10 to 15 working days, and a second code path for everything the server currently does with plaintext.

Recommendations:

1. **Make it a per-user setting**, not a server-wide one. Reasons below.
2. **Build encrypted accounts as local-first.** Each device holds a full copy of the text and answers reads from it, using the sync feed, outbox and `localRead.ts` that already exist. Encrypting fields while keeping server-side reads would be more work and hide less.
3. **Be plain about the limit.** The server delivers the app's code, so a server operator who is actively hostile can still get the key. This protects against theft and passive reading, not against a malicious operator.
4. **Run a spike before committing** (photos, video and PDFs on a real phone), and don't start before the 1.0 release is out.

## What it protects against

| Who | Protected? | Notes |
|---|---|---|
| Someone with a stolen disk, Docker volume or database file | Yes | Today this exposes everything. |
| Someone who gets the backup repository and its password | Yes | Restic already covers the repository alone. This adds a second layer. |
| An admin who opens the database or browses the files | Yes | The realistic family case: nobody can read a journal by accident or out of curiosity. |
| A proxy or tunnel that terminates TLS, such as Cloudflare, reading traffic | Yes, for content | |
| A cloud host (the Parked "Cloud hosting" item) reading stored data | Yes | This is the strongest long-term reason to build it. |
| An operator or attacker who changes the code the server sends | **No** | Modified JavaScript can read the key or the text as it is typed. Browsers have no way to pin a web app's code. |
| Cross-site scripting (XSS) in the app | **No** | A non-extractable key can't be copied out, but injected code can still ask it to decrypt. The CSP and sanitised markdown stay the defence. |
| Someone holding an unlocked device | **No** | The device keeps a readable copy, as it does today for kept journals. |
| Someone analysing metadata | Partly | See "What the server can still see". |

The README's current warning ("whoever runs a Cairn server can read what's on it") would become: "with encryption on, the server stores only ciphertext, but you still have to trust it to send honest code."

## Server-wide or per user?

**Per user.** The question looks like a choice between two designs, but most of it is settled by how the feature has to work:

- **The keys have to be per user anyway.** One server-wide key would let every family member decrypt everyone else's journal, which breaks the rule that an admin has no route to another user's content. So a server-wide setting would only decide who flips the switch, not how the encryption works.
- **It saves no code.** The setting is optional, so servers with it off still need every plaintext path. Both versions need both modes.
- **An admin can't carry it out.** Only a device holding a user's key can encrypt their data, so each user has to do their own migration and save their own key. An admin could flip the switch but couldn't do the part that matters.
- **The person who pays for a lost key should be the one who chooses.** A server-wide switch would let one person put a relative's whole journal at risk of permanent loss. It would also force everyone onto the trade-offs below (no stemmed search, no import), when only some may want them.
- **It lets you try it first.** One account can run encrypted for months on a server whose other users are untouched.

Admins would get very little:

- Manage users shows an "Encrypted" chip, and Reset password says that it restores sign-in but not the key.
- Storage totals keep working, because they come from file sizes.
- A "require encryption for new users" policy can wait until a cloud host needs it. Nothing here blocks it.

## How it would work

### Keys

- **The key the user saves:** 128 random bits, generated on the device and shown as 7 groups of 4 characters (base32 with a checksum, so a typo is caught before anything is tried). Download, copy, print, then type it back to confirm. It is generated rather than chosen, so it can't be guessed offline and needs no slow key derivation.
- **The account key:** a random 256-bit key that does the actual encrypting. The server stores it wrapped (encrypted) by a key derived from the saved key using HKDF. This allows replacing a saved key without re-encrypting everything, and a wrong key fails at once with a clear message. The saved key never goes to the server.
- **On a device:** the unwrapped key is a non-extractable `CryptoKey` in IndexedDB, so typing it once per device is enough. Signing out deletes it.
- **Separate from the password.** A password reset, by an admin or by `reset-password.js`, restores sign-in and nothing else, and never exposes entries.
- **Text and metadata:** AES-256-GCM through WebCrypto, with no crypto dependency. Each row's associated data binds it to its user, table, row id and format version, so the server can't swap one entry's ciphertext for another's. The format carries a version and a key id, leaving room for per-journal keys later.
- **Files:** each file gets its own random key and is split into 1 MiB chunks, because WebCrypto can't stream and a 95 MB video can't sit in a phone's memory. The chunk's position and a last-chunk flag are authenticated, so reordering or truncating a file is detected, and a `Range` request maps to whole chunks.

### Encrypted and visible data

| Encrypted | Still visible to the server |
|---|---|
| Entry text, entry dates, timezone, star, pin, all-day, mood, creation device | Row ids (UUIDv7, so they include the time the row was created), user id, journal id |
| Tags, place, coordinates, weather (all inside the entry) | `rev`, `updated_at`, `deleted_at`, `purged_at` |
| `source_raw` (its own column; only the export needs it) | Journal order, archived state, default journal |
| Journal name, colour, icon, description | Account: username, display name, role, avatar, settings |
| Photo and file metadata: date, GPS, size in pixels, type, file name | File and row sizes, and the time of each request |
| Photo and attachment files, including thumbnails | How many entries and files there are, and which journal each is in |
| Templates, and your own prompts | Server-wide suggested prompts and categories |

To limit what sizes reveal, text is compressed and padded to the next 256 bytes before encrypting. Without this, a row's size gives away the length of the entry. File sizes stay visible.

**Schema:** a nullable `enc` blob column on `entry`, `journal`, `photo`, `attachment`, `template` and `prompt`, plus `enc_raw` on `entry` and encryption state and the wrapped key on `user`. Columns that are `NOT NULL` get neutral values (empty text, zero dates) rather than a table rebuild, since rebuilding `entry` means dropping it, which cascades to every child row. Tags and places get no rows at all.

### Local-first reads

Two ways to read data were considered:

- **Keep server-side reads:** the client stores a ready-made card next to each row and the server pages through them. Entry dates must then stay visible for ordering, and search, tags, Insights and the map still have to move to the client. It is more work and it hides less.
- **Local-first (recommended):** an encrypted account always keeps a full copy of the text on each device, and `api()` answers reads from `localRead.ts` instead of the network. The server becomes a store of encrypted rows ordered by `rev`.

Most of the second one exists already:

- The change feed and `cursor`, the outbox, and `base_rev` conflicts (the client decrypts `current` and shows Keep mine / Use theirs as it does now).
- `localRead.ts` already answers timelines, entries, tags, journals and search in the server's exact response shapes.
- The card rules, plain-text stripping and Insights maths are already pure code in `packages/shared`.

"Keep all journals" becomes always on for text. The per-journal switch then decides only whether a journal's photos are kept on the device; otherwise they are fetched and cached as they are viewed. A side benefit is that Insights, the Calendar, Media and the map start working offline for these accounts.

The server can no longer read references in the text, so a save sends the list of media ids it refers to, replacing the parsing in `syncEntryMedia`. Removing a photo's reference from the text likewise moves to the client, instead of `DELETE /api/photos/:id` doing it.

### Photos and files

The client does what `photos/upload.ts` does today:

- Read EXIF date and GPS, make the display and thumbnail copies with a canvas (which also drops metadata), encrypt all three files, and upload them. Client-chosen ids are needed so the id can be authenticated; the parked offline photo item wants the same change.
- Dedupe still works: a keyed hash of the bytes replaces `sha256` as the file's name, so the server can see that two of a user's files match but can't check them against a known file. Files are already per user, so nothing is lost across users.
- The Photo quality setting doesn't apply. The original is stored as uploaded, since a browser can't recompress while keeping metadata the way `compressImage` does, and the compress-existing job skips these accounts.

**Displaying them is the main open technical question.** Eight files build or load these URLs (`Markdown`, `EntryCard`, `Lightbox`, `MediaView`, `AttachmentView`, `PhotoStrip`, `livePreview`, `TrashPage`). The cleanest option is for `sw.js` to decrypt `/api/photos/*` and `/api/attachments/*` responses as they pass, since a `CryptoKey` can be read from IndexedDB in a worker. Nothing that renders them would change, no CSP change is needed, and Range requests for video can be served there. But the worker is production-only today, a hard reload bypasses it, and Chrome's PDF viewer may not work through it. The fallback is a hook that makes blob URLs (`img-src` already allows `blob:`; `media-src` and `object-src` would need checking). This is what the spike is for.

### Turning it on and off

**On**, from one device:

1. Finish the outbox and download everything. Create and confirm the key.
2. Set the state to `migrating`. From here the server refuses plaintext writes for this user.
3. Go through the rows in batches: read, encrypt, send. In one transaction the server stores the `enc` blob, blanks the plaintext columns and removes the search row.
4. Files: download each one, encrypt it, upload it, then delete the plaintext file. Existing thumbnails can be encrypted as they are, with no need to remake them.
5. Clean up: run `VACUUM` with `secure_delete` on, and remove pre-migration snapshots.

It works per row, so it survives a closed tab or a sleeping phone and carries on from where it stopped. It requires a recent successful backup first, as the compress-existing job does. Other devices ask for the key the next time they load, then wipe their local copy and download it again.

**Off:** any unlocked device runs the same steps in reverse and the server rebuilds the search index. **Lost the key but a device still works:** export, or turn encryption off and on again to get a new key. **Lost the key and no device is unlocked:** nothing can be recovered, so the account needs an "erase my encrypted data and start again" action, confirmed with the password.

**Old plaintext lingers.** Turning encryption on doesn't reach:

- **Restic backups:** they keep monthly snapshots for 12 months by default ([backup.md](../backup.md)), so plaintext stays in the repository until it ages out or the admin prunes it. The setup screen has to say so.
- **Freed space on the disk:** deleted files aren't overwritten.
- **Other devices:** they stay readable until they next connect.

## Effect on each feature

| Feature | In an encrypted account | Work |
|---|---|---|
| Timeline, reader, editor, conflicts | Works, from the local copy | Small: most of it exists |
| Search | Works on the device. **No stemming or Best match**, so "walking" won't find "walked" | Small: `localSearch.ts` exists |
| Tags | Counts and filters work. Rename and merge rewrite each entry from the client, so they need a connection for longer | Medium |
| Insights, Calendar, Details | Work, now also offline | Medium: shared maths, new local queries |
| Map, Media, recent places | Work, now also offline | Small to medium |
| Trash | Works: the server returns the blobs and the client builds the cards. Expiry stays on the server | Small to medium |
| Places | Works, but **the search text and coordinates pass through the server** to Google, unstored | Disclosure only |
| Weather | The client fetches it through the existing preview route and encrypts it at save. **Coordinates pass through the server** to the provider. The background job is off | Small |
| Export | Must be rebuilt in the browser. It is the promise of "my data stays mine" (SPEC goal), so it has to ship in the first version. Needs a zip library and MD5, which WebCrypto lacks, for Day One's file names | Medium to large |
| Import, app and `import-journal.js` | **Refused at first.** Import first and turn encryption on afterwards. A browser importer can come later | Later: large |
| Storage, cleanup, health, backups | Work unchanged: they use rows and file sizes | None |
| HEIC | No better than today. Browsers other than Safari generally can't decode it | None |
| Reminders ([notifications-proposal.md](notifications-proposal.md), not built) | "Skip if already written today", On this day and streak alerts can't run on the server. Plain timed reminders can | Design note |
| AI assistant write-only endpoint (Parked) | Can't work with a symmetric key: it would need a public-key design | Design note |
| Journal sharing (Parked) | Harder: it would need per-journal keys and per-user key pairs. The format leaves room, but nothing here builds it | Design note |

## Server overhead

Measured: today's database sizes, the share taken by photo copies, and AES speed. The encrypted sizes come from running the padding and compression over real rows without storing anything. The CPU and RAM rows are reasoning from what the code does, not measurements. The data was `data-dev` (403 entries, short ones averaging 210 bytes of text, partly imported) on an ARM64 laptop, so treat all of it as rough.

| | Today | Encrypted account | Effect |
|---|---|---|---|
| Database per entry | 3.8 KB (entry 2.2, search 0.8, indexes 0.4, weather and place 0.4) | 1.8 to 2.5 KB | **35 to 50% smaller.** Text is no longer stored a second time in the search index |
| Crypto on the server | None | None | **No change.** All of it runs on devices |
| Crypto per entry on a device | None | 0.12 ms for 2 KB; about 1,450 MB/s for 1 MB buffers | Unnoticeable |
| Media on disk | Original + 2 copies | Same + about 0.002% (16 bytes per 1 MiB chunk, plus a header) | **No real change** |
| CPU on save | Markdown stripping, search index update | One row written | Lower |
| CPU and RAM on photo upload | Sharp: the server's largest spikes | Stream to disk | **Much lower**, and these are the peaks a small server feels |
| CPU and RAM for search, Insights, export | On the server | On the device | Lower |
| Idle RAM | Baseline | Same, since plaintext code stays for other users | No change |
| Sync traffic | Up to about 0.7 KB per entry, for kept journals | About 0.9 to 1.2 KB per entry, for all journals (base64) | About **1 MB per 1,000 entries**, per device, once. Ciphertext doesn't compress in transit |
| Photo upload traffic | The original | Original + copies, about 30% more in `data-dev` | Modest, on the phone's connection |

One-time costs when a user turns encryption on:

- **Disk:** up to twice that user's media while the migration runs, because a plaintext file is deleted only after its encrypted copy lands. It is less in practice, as files go one by one.
- **Backups:** restic can't dedupe the new ciphertext against the old plaintext, so the repository grows by about that user's whole media size and stays there until old snapshots age out, up to 12 months by default. **This is the largest lasting cost:** 50 GB of media means about 50 GB more off-site for up to a year, unless pruned.
- **Bandwidth:** every file goes down to the device and back up. 50 GB over a 20 Mbps home uplink is about 6 hours for the download alone, so it should run on the local network.

**In short:** for day-to-day use the server gets lighter, and a server of all encrypted accounts would use noticeably less CPU, RAM and database space. A mixed server stays about the same. The real costs are the one-time backup growth and the load moved onto devices.

### Device cost

This is where the load goes, and phones feel it first. Phone figures assume 3 to 5 times slower than the laptop; none were measured.

- **Storage:** the full text of every journal, always. About 10 to 25 MB at 10,000 entries.
- **New device:** nothing shows until the copy arrives. At 10,000 entries that is about 10 to 13 MB of download plus about 1 second of decrypting on the laptop, or 3 to 5 on a phone. This needs a progress screen.
- **Large photos:** decoding one takes 4 bytes per pixel, so 200 MB at 50 megapixels and 400 MB at the current 100-megapixel cap. That can kill a phone's tab, so the client's limit may have to be lower than the server's.
- **Evicted storage:** a browser can clear IndexedDB, and iOS does so most readily for sites not installed to the Home Screen. The user then types the key again and downloads the copy again.

## Work

Sizes as in [todo-and-ideas.md](../todo-and-ideas.md). All of this is Opus-level work, since mistakes here lose data or leak it.

| Phase | What | Size |
|---|---|---|
| 0. Spike | On a real phone: service worker decryption, video Range, the PDF viewer, canvas limits, WebP encoding (Safari's canvas may not do it). Decides go or no-go | M |
| 1. Keys | Key format, wrapping, setup and confirm screens, the unlock gate, replacing the key, downgrade protection | L |
| 2. Server | Migration, `enc` columns, the user's state, refusing plaintext writes, routes returning blobs, media id lists, erasing data | L |
| 3. Local reads | Forced full copy, first-sync screen, Insights, Calendar, map, Media, tags and Trash from the local copy, templates and prompts | L |
| 4. Media | Client-side photo pipeline, chunked upload, decryption for display, attachments | L to XL |
| 5. On and off | Resumable migration both ways, scrubbing, handling other devices, backups first | L |
| 6. Export | Whole-account and one-entry export in the browser, a Day One round-trip check | M to L |
| 7. Finish | Docs, README, SPEC, e2e at both widths, an outside review of the crypto | M |

**Total: XL, about 10 to 15 working days** plus the outside review. A browser-based import would add L. It includes a migration, so at least a minor version.

Tests that matter most beyond the usual:

- **A plaintext canary:** write a marker into every encrypted field, migrate, then search the database, WAL and data directory for its bytes. It must not appear.
- **Interrupted migrations:** stop at every stage in both directions, and check nothing is lost.
- **Tampering:** swapped blobs, reordered chunks and truncated files must be refused.

## Risks

- **Permanent loss is the headline risk.** A journal is the last thing anyone wants to lose, and people lose keys. Mitigations: required typed confirmation, a Settings reminder, and a clear warning. There is deliberately no recovery by an admin.
- **A second code path for years.** Every future feature that reads entries on the server must also work in encrypted accounts or say it can't. This is the true long-term cost, more than the build.
- **Silent plaintext sends.** A stale app or a queued write could send plaintext to an encrypted account, so the server refuses such writes and the outbox encrypts when it queues (its draft snapshots too).
- **Downgrade.** A malicious server, or a restore from an old backup, could report encryption as off so the client starts sending plaintext. Each device remembers that the account is encrypted, and refuses to send plaintext unless the user turned it off there.
- **Rollback.** The server can hide rows or serve older ones. Authentication catches tampering with a row but not its absence. Accepted for now.
- **Plain http can't work.** `crypto.subtle` exists only over https or on localhost, so an encrypted account can't unlock on a device reaching the server by plain http on a LAN or VPN. That access has to move to https, or stay limited to non-encrypted accounts. It wouldn't be safe to work around, since code delivered over plain http can be changed in transit unless the network itself is trusted.
- **Local drafts and caches.** Drafts in localStorage and cached lists stay readable on the device, as now. Sign-out handling needs an audit for these accounts.

## Alternatives

- **Disk or volume encryption on the host.** Protects a stolen disk only, needs no code, and is worth recommending in the deployment docs regardless.
- **Server-side encryption with a key derived from the password.** Search and photos keep working, and data is protected while the user is signed out. But the server sees everything during a session and password resets lose data. It is not end-to-end, and it adds real complexity for a modest gain.
- **Encrypting only entry text, leaving metadata plain.** About half the work, but places, tags, moods, dates and photos stay readable, and those say a lot about a life. It would also be easy to misunderstand. Not recommended.
- **Per-journal encryption** (a key for each journal, so a private journal can sit beside normal ones). More keys to manage and a harder mix of modes within one account. It would suit a later version, and the key id in the format leaves room.

## Open questions

1. **Who is this for?** If the goal is a home server where the admin is trusted, the threat is mainly a stolen disk or a curious family member, and disk encryption plus today's encrypted backups may cover most of it for far less work. If the goal is cloud hosting or a server run by someone else, this is the feature that makes that credible. This decides whether to build at all.
2. **Are the search and import losses acceptable?** No stemming or ranking, and no import after encrypting. A JavaScript stemmer could return the first, at the cost of more client work.
3. **Should place and weather look-ups stay on?** Recommended yes, with a clear note that they pass through the server. The stricter option turns them off for these accounts, which loses a good part of what makes entries feel like Day One.
4. **What happens to backups at switch-on?** Recommended: tell the user plaintext stays in old backups until they age out, and give admins a documented prune step. An automatic prune would also throw away history for every other user.
