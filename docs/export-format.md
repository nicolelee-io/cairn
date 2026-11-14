# Cairn export format

There is one export. It is Day One's JSON format with a few extra keys, so **Day One can import it directly and ignores the extras**, and Cairn can keep what Day One has no place for (mood, for one).

Settings has an **Export** card with a journal picker (All journals by default), an **Include photos** switch and an **Export** button. A journal's edit dialog on Manage journals has the same thing for that journal (**Export…**). The result is a zip made from the signed-in user's own journals, archived ones included. Deleted entries, journals, photos and attachments are left out.

`GET /api/export[?journalId=<id>][&media=0]`

- `GET /api/export/entries/<id>` exports one entry: the same archive with one journal file (the entry's journal, holding only that entry) and only that entry's files. Always a zip, since Day One's import takes only zips, even with no media. Named `cairn-entry-<entry's day>-<first line, up to 40 characters>.zip` (404 for an entry that isn't the user's or is in the trash; archived journals work).
- `journalId` exports one journal instead of all of them (404 if it isn't one of the user's; archived journals work). The archive then has one journal file.
- `media=0` (the switch off) leaves the photo and attachment files out. They are still listed in the JSON, so their names and metadata are all there. Day One's own export has the same JSON-only option.

File name: `cairn-export-YYYY-MM-DD.zip`, with the journal's name in lower-case ASCII after `cairn-export` for a single journal (`cairn-export-travel-2026-10-30.zip`; a name with no ASCII letters or digits is left out) and `-json` before `.zip` when photos are left out.

**Every Day One key is written; Cairn only adds keys.** The additions are a `cairn` object on journal files, entries, places, weather, photos and attachments. A reader that knows Day One's format reads the archive by ignoring them. The structure of Day One's format is described in [dayone-export-format.md](dayone-export-format.md); this file covers what Cairn writes.

## Archive layout

```
cairn-export-2026-10-30.zip
  <Journal name>.json        one per journal
  photos/<md5>.<ext>         original photo files (absent when photos are left out)
  videos/<md5>.<ext>         attachments, by kind: mp4/mov videos,
  audios/<md5>.m4a             audio,
  pdfs/<md5>.pdf               and PDFs (all absent when photos are left out)
```

- A journal's file name is its name with characters that are invalid in file names (`\ / : * ? " < > |`, control characters) replaced by `-` and leading or trailing dots and spaces trimmed. Journals whose names collide get ` (2)`, ` (3)`. The true name is in `cairn.journal.name` in the Cairn export; Day One names an imported journal after the file.
- `photos/` holds **originals**, never the display or thumbnail copies. On a server set to compress photos, a photo's original is its compressed JPEG (`.jpg`). The file name is the md5 of the file's bytes (Day One names photo files this way). Photos that share one file (the same bytes attached twice) appear once.
- Attachments are written the same way: the original file, named by its md5, in the folder for its kind.
- Nothing in the archive identifies a password, session or API key. A test asserts this.

## Journal file

```json
{
  "metadata": { "version": "1.0" },
  "entries": [ ... ],
  "cairn": { ... }
}
```

`cairn` on a journal file:

```json
{
  "journal": {
    "name": "Journal name", "color": "#7B7B45" | null, "description": "text" | null,
    "archivedAt": 1793370194788 | null, "sortOrder": 0
  }
}
```

There is no version key: every extra here is read back by the importer, and a future change can tell this layout from the next by a key being present.

## Entry

Entries are in creation order, oldest first. Keys written for every entry:

| Key                               | Value                                                                                                        |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `uuid`                            | The Day One uuid for an imported entry, otherwise the entry's Cairn id as 32 uppercase hex (dashes removed). |
| `creationDate`, `modifiedDate`    | ISO 8601 UTC with `Z`, second precision.                                                                     |
| `timeZone`                        | The entry's own IANA zone. Display the UTC time in this zone, not the reader's.                              |
| `text`                            | Markdown. Photos are `![](dayone-moment://<identifier>)`, where `identifier` is in `photos`; attachments are `![](dayone-moment:/video/…)`, `/audio/…` and `/pdfAttachment/…`. |
| `starred`, `isPinned`, `isAllDay` | Booleans.                                                                                                    |
| `tags`                            | Array of tag names (strings).                                                                                |
| `creationDevice`                  | Only when known.                                                                                             |
| `location`, `weather`, `photos`, `videos`, `audios`, `pdfAttachments` | Only when the entry has them. See below. |

For an entry that was imported from Day One, the keys Cairn has no column for (`editingTime`, `duration`, `creationDeviceType`, `creationOSName`, `creationOSVersion`, ...) are carried over from the original JSON. `richText` is **not** exported: it is Day One's own rendering of the text, and the text may have been edited in Cairn since, so the two could disagree. Day One rebuilds it from `text`.

### `cairn` on an entry

```json
{
  "id": "<uuid>",
  "source": "native" | "dayone",
  "mood": "happy" | "anxious" | ... | null,
  "moodSuggested": 1-5 | null,
  "moodSuggestedBy": "<model or null>",
  "createdAt": 1712021400000,
  "modifiedAt": 1712021400000
}
```

- `mood` is the user's own mood as a key from Cairn's list (happy, content, calm, loved, excited, meh, tired, sad, down, anxious, stressed, frustrated, angry, unwell); `null` means none set. Exports from before mood keys have a 1-5 number there, which the importer reads as sad, down, meh, content, happy. `moodSuggested` is a machine suggestion and is never the user's rating.
- `createdAt`/`modifiedAt` are the same instants as `creationDate`/`modifiedDate` in epoch milliseconds, since the Day One dates are rounded to seconds.

## `location`

Day One keys: `latitude`, `longitude`, `placeName`, `localityName`, `administrativeArea` (state or province), `country`, `address`. A key is written only when Cairn has a value.

For an imported entry whose place has not moved since, the remaining Day One keys (`altitude`, `region`, `speed`, ...) are carried over. A place Cairn created has no `region` (Day One's geofence); Day One imported such places fine (see [Compatibility testing](#compatibility-testing)).

`cairn` (written only when there is something in it): `userLabel` (Day One's label for a place) and `googlePlaceId`.

## `weather`

Day One keys: `weatherCode`, `temperatureCelsius`, `pressureMB`, `relativeHumidity`, `windSpeedKPH`, `windBearing`, `visibilityKM`, `conditionsDescription`, `sunriseDate`, `sunsetDate`. Only the values Cairn has are written. A hand-entered or Google weather usually has just a condition and a temperature, so the pressure, humidity and wind keys are **absent, not zero**.

`weatherCode`:

- Weather imported from Day One keeps Day One's code exactly (`MostlyClear`, `clear-night`, ...).
- Otherwise it is the condition in WeatherKit's wording, which is what Day One writes: `Clear`, `MostlyClear`, `PartlyCloudy`, `MostlyCloudy`, `Cloudy`, `Haze`, `Foggy`, `Drizzle`, `Rain`, `Thunderstorms`, `Snow`, `Sleet`, `Hail`, `Windy`. No `-day`/`-night` suffix is added; a real Day One export never has one, and day or night is carried by `sunriseDate`/`sunsetDate`.
- A condition with no Day One name (Cairn's `unknown`) uses the provider's raw code when there is one, else `Unknown`.

`cairn`: `source` (`dayone`, `google` or `manual`), `condition` (Cairn's canonical condition: `clear`, `mostly-clear`, `partly-cloudy`, `mostly-cloudy`, `cloudy`, `haze`, `fog`, `drizzle`, `rain`, `thunderstorm`, `snow`, `sleet`, `hail`, `wind`, `unknown`), `isDay` (`true`, `false` or `null`), `feelsLikeC`, `sourceCode` (the provider's raw code) and `fetchedAt` (epoch ms, for fetched weather).

## `photos`

One item per photo, in gallery order. Day One keys: `identifier` (32 uppercase hex; the Day One identifier for an imported photo, otherwise derived from the Cairn id), `md5`, `type` (file extension, lower case), `width`, `height` (0 when unknown, as in Day One's own export), `fileSize`, `date` (when the photo was taken, else the entry's creation date), `orderInEntry` (0-based), `isSketch` (false), `favorite` (false) and `duration` (null). An imported photo also keeps its other original keys, such as `creationDevice`.

`md5` and `fileSize` describe the file in `photos/`. They are computed from the bytes when the export runs, so they are always right, which Day One's own are not for about a third of photos.

A photo whose original file is missing from the data directory is left out of `photos`, its reference is removed from the text, and the server logs a warning naming the photo and entry. The export still completes.

`cairn`: `takenAt` (epoch ms or null), `latitude`, `longitude` (from the photo's EXIF; the derivatives carry none).

## `videos`, `audios`, `pdfAttachments`

One item per attachment of that kind, in the entry's order. Keys as for photos (`identifier`, `md5`, `type`, `fileSize`, `orderInEntry`, `favorite`, `duration` null, `width`/`height` 0 unless the imported original had values), plus `pdfName` (the file name without `.pdf`) on PDFs. An imported attachment keeps its other original keys. A missing file is left out, like a photo's.

`cairn`: `filename`, the name shown in Cairn (an upload's own name, or `pdfName` + `.pdf`, or `video.mp4` for media Day One gives no name).

## How it is made

- The export reads through the same user-scoped repository layer as the rest of the API (`repo/export.ts`), so it can only contain the signed-in user's data. `repo/isolation.test.ts` covers this.
- The zip is streamed. Photos are read twice (once to compute the md5 for the `photos` entries, once to write them), and the download starts after the first pass, so a large library takes a while to begin. Memory use does not grow with the number of photos. Photos are stored uncompressed in the zip (they are already compressed).
- Code: `apps/server/src/export/map.ts` (pure mapping to JSON), `run.ts` (hashing and the zip), `routes/export.ts` (the one GET). The weather reverse table is `toDayOneWeatherCode` in `packages/shared/src/weather.ts`.
- Tests: `export/run.test.ts` imports the sample Day One export, exports it, and imports the result into a second user with Cairn's own importer, checking entries, text, places, weather, tags and photo hashes survive. It also restores entries written in Cairn (mood, labels, weather source, journal settings, idempotency), and covers JSON-only, single-journal, missing files, credentials and the archive root.

## Importing it back into Cairn

`npm run import:journal -- <export.zip|folder>` (or `import-journal.js` in the image) reads the `cairn` extras when they are there, and falls back to plain Day One behaviour for any that are missing or malformed (a bad extra is dropped, not an error). What comes back:

- **Journal:** its real name (the file name had characters stripped), colour, order and archived state. These apply only to a journal the import creates; a journal that already exists keeps its own settings.
- **Entry:** mood and the machine suggestion, the dates to the millisecond (Day One's are rounded), and `source` (an entry written in Cairn comes back as one: no Day One original is kept for it). It gets a new Cairn id, so the same export can be imported into another instance.
- **Place:** the saved label and Google place id.
- **Weather:** where it came from (`google` or `manual` stay that, so a later move can refetch Google's, and `dayone` is never overwritten), the canonical condition, day/night, feels-like and fetch time. The Day One `weatherCode` is then only a rendering of those.
- **Photo:** whether it had a taken-at date of its own (the `date` key falls back to the entry's date, which is not a taken-at) and its EXIF position.

Idempotent: an entry is skipped if the account already has its Day One uuid or the Cairn id it was exported from, so importing the same export twice, or into the account it came from, adds nothing.

## Day One compatibility

- **Nothing but journals may end in `.json`, anywhere in the archive.** Day One's importer treats every `.json` file it finds as a journal, in a folder too: a `manifest.json` at the root made an import hang on that "journal", and moved into a folder it still showed up as a journal named `cairn/manifest`. The archive therefore has no manifest or other side files, and a test asserts the only `.json` names in it are the journals'. Any future extra file needs a non-`.json` extension.
- Cairn is Markdown-only, so Day One features that live in `richText` (real checklists, underline, highlight, colour) don't round-trip. They are listed in [known-issues.md](known-issues.md).
- Day One ignored the `cairn` keys on entries, places, weather and photos in a test import of a sample journal.

## Compatibility testing

- **Tried in Day One:** a journal made only of entries written in Cairn, exported and imported into Day One (with the manifest removed). It imported cleanly, and the places and weather came through. That covers what Cairn writes differently from Day One: places with no `region`, weather with only a condition and a temperature (no pressure, humidity or wind), and the `weatherCode` wording.
- **Not specifically checked in Day One:** photos, tags, all-day entries and archives with several journals. They follow Day One's own shapes (see [dayone-export-format.md](dayone-export-format.md)), and Cairn's importer reads them back (`export/run.test.ts`).
- **An export is not a full backup.** Importing it into Cairn restores the extras (see below), but not session or account settings, search state, tombstones, or the raw provider JSON behind fetched weather. For a complete restore use the backup (Phase 6c).
- Attachments haven't been imported into Day One yet. They follow the shapes of Day One's own export (videos and PDFs observed; audio assumed).
