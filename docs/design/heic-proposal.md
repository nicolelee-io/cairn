# Proposal: HEIC/HEIF photos

Status: proposal, not built. Tracked in [todo-and-ideas.md](../todo-and-ideas.md) under Parked.

## Summary

Cairn can't take HEIC photos today. Sharp's bundled libvips can't decode them, so an upload is refused with "HEIC/HEIF photos are not supported yet", and a HEIC file in a Day One import is stored as an original with no thumbnail or display copy. It can be done with a JavaScript decoder in front of sharp. It is not hard, but it costs memory on a small server, and the need is unproven, so it is parked until a real HEIC shows up in someone's data.

## Why sharp can't do it

Checked 2026-11-08 against sharp 0.35.5 (libvips 8.18.7, libheif 1.23.5, aom 3.15.1; the arm64 build here, and the amd64 build comes from the same release).

- libheif is in the bundle, which is why AVIF works (AV1 through aom).
- There is no HEVC decoder in it (no libde265, x265 or similar in the binary), and HEIC is HEVC. Sharp leaves HEVC out of its prebuilt binaries because of patent licensing.
- sharp's `metadata()` reports a HEIC as `format: 'heif'` with `compression: 'hevc'` (AVIF is `av1`), which is how the upload check already tells them apart (`formatOf` in `photos/upload.ts`).
- The other way, building sharp against a system libvips that has libde265, needs a compiler and a newer libvips than Debian bookworm ships. It breaks the slim `--ignore-scripts` image (see the Dockerfile). Not worth it.

Not tested: decoding a real HEIC. The only one on the dev machine was a cloud placeholder that couldn't be read.

## The option that works

Decode in JavaScript, then hand raw pixels to sharp for the usual WebP derivatives.

- **`heic-decode`** (ISC, a few KB) on **`libheif-js`** (LGPL-3.0, about 9 MB of WASM with a decoder). No native build step, so it fits the Dockerfile's `deps` stage.
- **`photos/heic.ts`**: `decodeHeic(bytes)` returns RGBA, width and height. WASM decoding blocks the event loop for seconds, so it runs in a `worker_thread`, one decode at a time.
- **`photos/upload.ts`** accepts HEIC (the `FORMATS` table plus `formatOf`); **`photos/pipeline.ts`** `processImage` takes the decoded pixels for these (`sharp(rgba, { raw })`).
- **Orientation**: libheif applies the rotation and mirroring while decoding, so skip `.rotate()` for HEIC or it turns twice.
- **EXIF date and GPS**: the decoder doesn't return them, and sharp can't read them from a HEIC it can't decode. Add `exifr` (MIT, about 1.3 MB, no dependencies), which reads HEIC, and feed `takenAt`, latitude and longitude into the same fields as today.
- **Photo quality**: `compressImage` only handles JPEG and opaque PNG, so a HEIC original is stored as uploaded under both settings (it is already compact). `storeOriginal` needs no change.
- **Web**: `MarkdownEditor.tsx` drops pasted or dropped files unless `type` starts with `image/` (Windows gives an empty or odd type for HEIC without the codec); accept `.heic`/`.heif` by name too, as `useUploads.ts` already allows an empty type.
- **Importer**: `import/dayone/run.ts` already stores `.heic` originals and falls back when `processImage` throws; with HEIC decoding it gets derivatives like any other photo.
- **Photos already imported**: they have no derivatives and the original route falls back to the HEIC file, which Chrome and Firefox can't show. A catch-up step would make the missing derivatives (like `photos/compressExisting.ts`, but for rows with null `displayPath`), run from the admin Storage page and the daily cleanup.

## Risks and costs

- **Memory and time**: untested. A 12 MP photo probably decodes in a few seconds and a few hundred MB; a 48-50 MP photo is worse. Cairn often shares a small server with other services, so there may not be much to spare. Measure on a real file first, keep the 100 MP cap (`MAX_PIXELS`) or set a lower one for HEIC, and decode one at a time.
- **Display**: a browser other than Safari can't show a HEIC original, so the lightbox's Download link hands over a file it can't open. Only the derivatives display.
- **Dependency weight**: about 10 MB more in `node_modules` and the image, for a format most uploads won't use: iOS Safari converts HEIC to JPEG when a photo is picked, and the Pixel shoots JPEG by default.
- **License**: libheif-js is LGPL-3.0, used unmodified as a dependency, the same terms as the libraries in sharp's bundle. The HEVC patent position is the same as for any software decoder.
- **Tests**: need a small real HEIC fixture, which can't be generated without an encoder (check licensing, and keep it under a few KB).

## Who would need it

- Uploads from iOS Safari mostly arrive as JPEG already.
- A drag and drop from a desktop gives raw HEIC.
- A Day One import from an iPhone is the likely case: Day One exports keep the original HEIC. If those are in anyone's data, this plus the catch-up step is what makes them show.

## Plan, if it is picked up

1. Get a real HEIC and measure decode time and memory at 12 and 48 MP in a worker. If it is too heavy for the server, stop and write that down here.
2. `photos/heic.ts` and the pipeline and upload changes, with a fixture test.
3. `exifr` for date and GPS.
4. The web file filter.
5. The catch-up job for already imported HEIC photos.
6. Docs: `photos/CLAUDE.md`, the SPEC photo section, `CHANGELOG.md`.

_Est: Opus, M for upload and import (the worker and the memory limits are the risk); Sonnet, S to M for the catch-up job._
