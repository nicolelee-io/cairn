# Using Cairn offline

Cairn keeps working when your device has no connection or your server is down, as long as you opened it on that device while it could reach the server. Writing works everywhere. Reading depends on what you've kept on the device. Anything else says it needs a connection.

Offline use relies on a service worker, which browsers only allow over https or on `localhost`, so it doesn't work over plain http. See [Reaching Cairn](deployment.md#reaching-cairn).

## Keeping journals on a device

Choose what to keep in **Settings > Offline & sync**: every active journal, or one at a time with the size shown before you switch it on. A journal's edit dialog has the same switch. The choice belongs to each device, and nothing is kept until you make it.

A kept journal holds its entries and a thumbnail and display-size copy of each photo. Original photos, videos, audio and PDFs are never kept.

Without a kept journal you can still see recently opened pages and photos that the browser has cached, but don't rely on that.

## What works offline

| Area          | Works offline                                                                                                                                      |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Reading       | The entry list and entries of kept journals, with their photos.                                                                                    |
| Search        | Kept journals only, with all the filters. It matches exact word forms ("walk" won't find "walking"), and results are newest first.                 |
| Writing       | New entries and edits, including text, mood, date, timezone and tags. Drafts save as you type.                                                     |
| Places        | Your current location or a photo's GPS, saved as coordinates with no place name, and places you've used recently if they're cached on this device. |
| Quick changes | Pin, star, move to another journal, tick a checklist item, delete an entry (with Undo).                                                            |
| Journals      | Create, edit, archive, reorder and delete.                                                                                                         |
| Tags          | Adding them to an entry, with suggestions from your existing tags.                                                                                 |
| Templates     | Inserting one into an entry.                                                                                                                       |
| Prompts       | The daily prompts and your lists, as last fetched on this device, and writing from one.                                                            |
| Settings      | Device settings, and account settings such as the default journal, default timezone and temperature unit.                              |

## What needs a connection

| Area               | Needs a connection                                                                                                     |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------- |
| Photos and files   | Adding photos or attachments to an entry. Opening an original photo, video, audio file or PDF.                         |
| Places and weather | Searching for a place and looking up an address for coordinates. Weather is fetched once the entry reaches the server. |
| Other views        | Insights, Calendar, Media, Map and the Details tiles.                                                                  |
| Search             | Journals that aren't kept on the device.                                                                               |
| Trash              | Browsing, restoring and emptying it. Deletes you made offline are listed there with Undo until they're sent.           |
| Tags               | Renaming, merging and deleting them on Manage tags.                                                                    |
| Templates          | Adding, editing and deleting them, including Save as template.                                                         |
| Prompts            | Adding, editing, deleting and saving prompts.                                                                          |
| Account            | Display name, username, password and picture. Signing out.                                                             |
| Your data          | Export, Import and Storage.                                                                                            |
| Admin              | Manage users and all server settings.                                                                                  |

Text you've written is safe when a photo can't be added: the entry saves and waits as usual. Add the photo again once you're back online.

## When changes are sent

Changes wait on the device and are sent in the order you made them. Cairn tries when the app starts, when the connection returns, when you switch back to the app, every 20 seconds while something is waiting, and when you press Sync now. **The app has to be open for this to happen.** The nav shows how many changes are waiting.

Waiting changes survive closing the app and signing out, but they exist only on that device until they're sent. Clearing the browser's site data deletes them.

If the server refuses a change, for example because the entry was edited on another device in the meantime, a bar offers Review. Your text comes back as a draft, and you choose which version to keep. Neither version is overwritten without asking.
