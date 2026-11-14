# Day One JSON export format (as observed)

Observed from a real full export (JSON, with photos and videos) taken 2026-10-28: one journal, 665 entries, 56 photos, 1 video. PDF attachments are from a second, small export taken 2026-10-31. It also serves as the reference for building Cairn's own export feature (Phase 6), which should be able to emit the same shape.

Nothing here is personal data: it is structure and quirks only. Never put real entry text, place names or photos in this file or in test fixtures.

## Archive layout

```
<export>.zip
  <Journal Name>.json      # one per journal; name may contain emoji and spaces (UTF-8)
  photos/<md5>.<ext>       # ext from the photo's `type`; all `jpg` in this export
  videos/<md5>.<ext>       # `mp4`
  pdfs/<md5>.pdf           # PDF attachments (2026-10-31 export)
  audios/<md5>.<ext>       # assumed, unverified
```

- A multi-journal export is expected to have one `<Name>.json` per journal at the root. Only the single-journal case has been observed.
- Media filenames use the JSON `md5` field, but that is **not** the md5 of the file on disk for about a third of the photos (19 of 56). The files were 594 bytes smaller than the `fileSize` field, so Day One appears to rewrite metadata on export. Locate files by the `md5` field, never verify against it; hash the bytes yourself (sha256) for dedupe.
- `pdfs/` is confirmed by the 2026-10-31 export. No audio has been seen: `audios/`, the `audios` key and the `/audio/` placeholder are assumptions that follow the video and PDF pattern. Day One's file picker accepts PDF, MP4, MOV and M4A besides images, so audio is most likely `m4a`.

## Top level

```json
{ "metadata": { "version": "1.0" }, "entries": [ ... ] }
```

## Entry keys

Always present (665/665): `uuid`, `creationDate`, `modifiedDate`, `timeZone`, `text`, `starred`, `isPinned`, `isAllDay`, `tags`, `duration`, `editingTime`.

| Key                               | Type / notes                                                                                                                                                                                     |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `uuid`                            | 32 uppercase hex chars, no dashes. Unique. This is `source_id`.                                                                                                                                  |
| `creationDate`, `modifiedDate`    | ISO 8601 UTC with `Z`, second precision (`2023-04-16T23:29:08Z`).                                                                                                                                |
| `timeZone`                        | IANA name (`America/New_York`). Always valid in this export, but validate. The UTC time must be displayed in this zone.                                                                          |
| `text`                            | Markdown-ish. Can be empty (9 entries). Day One escapes markdown punctuation with a backslash: `\-` `\.` `\&` `\*` `\[` `\]` `\#`. These are valid markdown and render correctly, so leave them. |
| `richText`                        | JSON **string** (not an object) of the form `{"contents": [...]}`; absent on 27 entries. Day One's own rich-text model; keep only in `source_raw`.                                               |
| `starred`, `isPinned`, `isAllDay` | booleans. Note `isPinned`, not `pinned`.                                                                                                                                                         |
| `tags`                            | array of **strings** (names). Absent tags are `[]`, not missing.                                                                                                                                 |
| `creationDevice`                  | e.g. `Desktop`, `Pixel 9 Pro`. Missing on 144 entries. Siblings `creationDeviceModel`, `creationDeviceType`, `creationOSName`, `creationOSVersion` are also optional and independently missing.  |
| `duration`, `editingTime`         | integers (seconds); not needed.                                                                                                                                                                  |
| `promptID`                        | string, 7 entries (a Day One writing prompt). Not needed.                                                                                                                                        |
| `userActivity`                    | `{ activityName, stepCount, ignoreStepCount }`, 1 entry. Not needed.                                                                                                                             |
| `location`                        | optional object, see below.                                                                                                                                                                      |
| `weather`                         | optional object, see below.                                                                                                                                                                      |
| `photos`, `videos`                | optional arrays, see below. Absent (not empty) when there are none.                                                                                                                              |

### `location`

Always present when `location` exists: `latitude`, `longitude`, `placeName`, `country`, `administrativeArea`, `region`. Common: `localityName` (173/188), `address` (166/188), `altitude`. Rare: `fullAddress`, `streetAddress`, `heading`, `speed`, `timeZoneName` (19).

- `region` is an object: `center {latitude, longitude}` (usually) plus sometimes `identifier`, `latitude`, `longitude`, `radius`. It is the geofence, not an admin region; `administrativeArea` is the state/province.
- There is no `userLabel` in this export.
- Numbers are a mix of ints and floats (`altitude`, `speed`).

### `weather`

Always: `temperatureCelsius`, `pressureMB`, `relativeHumidity`, `windSpeedKPH`, `windBearing`, `weatherCode`. Usually: `visibilityKM` (163/181). Only on newer entries: `conditionsDescription`, `sunriseDate`, `sunsetDate`, `weatherServiceName` (46: `WeatherKit` or `Forecast.io`), `moonPhase`, `moonPhaseCode`.

`weatherCode` is inconsistent across the two sources:

| Observed values                                         | Notes                                               |
| ------------------------------------------------------- | --------------------------------------------------- |
| `Clear`, `clear`                                        | Same condition; one is Forecast.io-style lowercase. |
| `MostlyClear`, `PartlyCloudy`, `MostlyCloudy`, `Cloudy` | WeatherKit PascalCase.                              |
| `Drizzle`, `Rain`, `Thunderstorms`, `Windy`, `Haze`     |                                                     |

The spec's `clear-day` / `partly-cloudy-night` style codes (Forecast.io) did not appear, but the importer should still normalize them: lowercase, strip non-letters, and take day/night from a `-day` / `-night` suffix. There is no explicit is-day field; derive it only from that suffix or from `sunriseDate`/`sunsetDate`, otherwise leave it null.

### `photos[]`, `videos[]` and `pdfAttachments[]`

Keys: `identifier` (32 uppercase hex), `md5`, `type` (extension), `width`, `height`, `fileSize`, `date`, `creationDevice`, `favorite`, `duration` (always null), `orderInEntry`; photos also have `isSketch`.

- `pdfAttachments[]` items have the same keys (`width`/`height` 0, `duration` null, no `date`) plus **`pdfName`**: the file's name without `.pdf`.
- The spec said `orderInSequence`; the real key is **`orderInEntry`**.
- `width` and `height` are `0` for most photos (48 of 56). Read real dimensions from the file (the importer does, via sharp).
- `fileSize` does not match the file on disk (see above).
- `date` is the photo's own timestamp (ISO UTC).

## Media placeholders in `text`

| Form                                     | Meaning                                                                                                               |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `![](dayone-moment://<identifier>)`      | Photo; `identifier` matches an item in `photos`.                                                                      |
| `![](dayone-moment:/video/<identifier>)` | Video; note the single slash and `video/` segment.                                                                    |
| `![](dayone-moment:/pdfAttachment/<identifier>)` | PDF (2026-10-31 export). Audio is assumed to be `/audio/`.                                                    |
| `![](dayone-moment://undefined)`         | Broken placeholder (2 occurrences, in an entry that also has a valid photo). No media to link; drop it and report it. |

Observed quirks:

- Every photo/video was referenced in its entry's text, but the importer must still handle media that is not referenced (attach it to the entry anyway).
- The same photo can be referenced twice in one entry.
- **Order in the text and `orderInEntry` disagree** for half of the multi-photo entries (4 of 8). `orderInEntry` is the gallery order; the placeholder position is where it sits in the prose. Keep both: photo `position` from `orderInEntry`, inline position from the text.

## What the importer maps

Day One field to Cairn column, for reference when writing the reverse mapping in the Phase 6 export:

| Day One                           | Cairn                                                 |
| --------------------------------- | ----------------------------------------------------- |
| `uuid`                            | `entry.source_id`                                     |
| `creationDate` / `modifiedDate`   | `entry.created_at` / `modified_at` (epoch ms)         |
| `timeZone`                        | `entry.timezone`                                      |
| `text`                            | `entry.body_md` (placeholders rewritten)              |
| whole entry                       | `entry.source_raw` (JSON)                             |
| `starred`, `isPinned`, `isAllDay` | `starred`, `pinned`, `all_day`                        |
| `creationDevice`                  | `entry.creation_device`                               |
| `tags[]`                          | `tag` + `entry_tag`                                   |
| `location`                        | `entry_location`                                      |
| `weather`                         | `entry_weather` (`source = 'dayone'`)                 |
| `photos[]`                        | `photo` (original, display and thumb files; EXIF GPS) |
| `videos[]`, `audios[]`, `pdfAttachments[]` | `attachment` (original file only; `pdfName` becomes the file name) |
| `mood`                            | none: Day One has no mood, so the mood stays null |

## Dropped on import

- `richText`, `duration`, `editingTime`, `promptID`, `userActivity`, device OS fields: kept only in `source_raw`.

## Writing a Day One-compatible export (Phase 6)

If Cairn's export should round-trip into Day One, emit the shape above: uppercase 32-hex `uuid`, UTC `Z` timestamps with the IANA `timeZone`, `tags` as strings, `isPinned`, `photos[].orderInEntry`, and `dayone-moment://<identifier>` placeholders with media in `photos/<md5>.<ext>` where `md5` is the real md5 of the file we write. Videos, audio and PDFs go in `videos/`, `audios/` and `pdfs/` with `dayone-moment:/video/`, `/audio/` and `/pdfAttachment/` placeholders. Untested against Day One's own importer. Cairn's exporter does this; see [export-format.md](export-format.md).
