#!/usr/bin/env python3
"""Generate a synthetic Day One-style JSON export (zip) for importer testing.

All content is fake. Field names and quirks follow a real export; see
docs/dayone-export-format.md.

Usage: make_sample_export.py OUTPUT.zip
"""
import hashlib
import io
import json
import random
import sys
import uuid
import zipfile
from PIL import Image, ImageDraw, ImageFont

rng = random.Random(42)


def uid():
    return uuid.UUID(int=rng.getrandbits(128)).hex.upper()


def make_photo(label, size, color, gps=None, orientation=None):
    """Return (jpeg_bytes, width, height). Stored dimensions are post-decode."""
    img = Image.new("RGB", size, color)
    d = ImageDraw.Draw(img)
    for i in range(0, size[0], 80):
        d.line([(i, 0), (i, size[1])], fill=(255, 255, 255), width=1)
    for i in range(0, size[1], 80):
        d.line([(0, i), (size[0], i)], fill=(255, 255, 255), width=1)
    try:
        font = ImageFont.load_default(size=48)
    except TypeError:
        font = ImageFont.load_default()
    d.text((40, 40), label, fill=(255, 255, 255), font=font)
    exif = Image.Exif()
    if orientation:
        exif[0x0112] = orientation
    if gps:
        lat, lon = gps
        g = exif.get_ifd(0x8825)
        g[1] = "N" if lat >= 0 else "S"
        g[2] = _dms(abs(lat))
        g[3] = "E" if lon >= 0 else "W"
        g[4] = _dms(abs(lon))
    buf = io.BytesIO()
    img.save(buf, "JPEG", quality=85, exif=exif)
    return buf.getvalue(), size[0], size[1]


def _dms(v):
    d = int(v)
    m = int((v - d) * 60)
    s = ((v - d) * 60 - m) * 60
    return (float(d), float(m), round(s, 2))


photos_files = {}  # filename -> bytes


def photo_meta(label, order, size=(1600, 1200), color=(70, 110, 160), **kw):
    data, w, h = make_photo(label, size, color, **kw)
    md5 = hashlib.md5(data).hexdigest()
    photos_files[f"photos/{md5}.jpg"] = data
    return {
        "identifier": uid(),
        "md5": md5,
        "type": "jpg",
        "width": w,
        "height": h,
        "orderInEntry": order,
        "isSketch": False,
        "fileSize": len(data),
        "creationDevice": "Pixel 9 Pro",
    }


media_files = {}  # filename -> bytes, for videos/, audios/ and pdfs/


def tiny_pdf(title):
    """A one-page PDF with a line of text: enough to sniff, open and hash."""
    stream = f"BT /F1 24 Tf 72 720 Td ({title}) Tj ET".encode()
    objs = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R"
        b" /Resources << /Font << /F1 5 0 R >> >> >>",
        b"<< /Length %d >>\nstream\n" % len(stream) + stream + b"\nendstream",
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    ]
    out = bytearray(b"%PDF-1.4\n")
    offsets = []
    for i, o in enumerate(objs, 1):
        offsets.append(len(out))
        out += b"%d 0 obj\n" % i + o + b"\nendobj\n"
    xref = len(out)
    out += b"xref\n0 %d\n0000000000 65535 f \n" % (len(objs) + 1)
    out += b"".join(b"%010d 00000 n \n" % off for off in offsets)
    out += b"trailer\n<< /Size %d /Root 1 0 R >>\nstartxref\n%d\n%%%%EOF\n" % (len(objs) + 1, xref)
    return bytes(out)


def tiny_bmff(brand, label):
    """An ISO-BMFF file (MP4/M4A) that is only an ftyp box plus padding: sniffable, not playable."""
    ftyp = brand + b"\x00\x00\x02\x00" + b"isom" + brand
    box = (8 + len(ftyp)).to_bytes(4, "big") + b"ftyp" + ftyp
    free = label.encode()
    return box + (8 + len(free)).to_bytes(4, "big") + b"free" + free


def media_meta(folder, kind, data, order, **extra):
    md5 = hashlib.md5(data).hexdigest()
    media_files[f"{folder}/{md5}.{kind}"] = data
    return {
        "identifier": uid(),
        "md5": md5,
        "type": kind,
        "width": 0,
        "height": 0,
        "orderInEntry": order,
        "fileSize": len(data),
        "creationDevice": "",
        "duration": None,
        "favorite": False,
        **extra,
    }


def weather(temp_c, cond, code, sunrise, sunset):
    return {
        "temperatureCelsius": temp_c,
        "conditionsDescription": cond,
        "weatherCode": code,
        "pressureMB": 1015.2,
        "relativeHumidity": 42,
        "windSpeedKPH": 11.3,
        "windBearing": 220,
        "visibilityKM": 16.1,
        "sunriseDate": sunrise,
        "sunsetDate": sunset,
        "moonPhaseCode": "waxing-gibbous",
        "moonPhase": 0.4,
        "weatherServiceName": "HAMweather",
    }


def loc(lat, lon, place, locality, admin, country, label=None):
    L = {
        "latitude": lat,
        "longitude": lon,
        "placeName": place,
        "localityName": locality,
        "administrativeArea": admin,
        "country": country,
        "region": {
            "center": {"latitude": lat, "longitude": lon},
            "radius": 75.0,
        },
    }
    if label:
        L["userLabel"] = label
    return L


def entry(created, tz, text, modified=None, **kw):
    e = {
        "uuid": uid(),
        "creationDate": created,
        "modifiedDate": modified or created,
        "timeZone": tz,
        "creationDevice": "Pixel 9 Pro",
        "creationDeviceType": "Android",
        "creationOSName": "Android",
        "creationOSVersion": "16",
        "starred": False,
        "isPinned": False,
        "isAllDay": False,
        "editingTime": 0,
        "duration": 0,
        "text": text,
    }
    e.update(kw)
    return e


# ---------------- Journal 1: "Sample Journal" ----------------
j1 = []

# 1. Plain text-only entry, tags, no location.
j1.append(entry(
    "2024-03-15T21:14:05Z", "America/Denver",
    "# First test entry\n\nJust some plain text to start with. It has **bold**, "
    "_italic_, and a list:\n\n- one\n- two\n- three\n",
    tags=["test", "plain"],
))

# 2. Escaped characters, as Day One does (\\. \\- \\! etc.), plus unicode/emoji.
j1.append(entry(
    "2024-03-16T14:02:00Z", "America/Denver",
    "# Escapes and unicode\n\n1\\. Not a list item\\.\n\nA \\- dash, an exclamation\\!, "
    "parentheses \\(like this\\), and snowman ☃ café \U0001F600.\n",
    tags=["test", "escapes"],
))

# 3. Starred + pinned, with location and weather, one photo referenced inline.
p = photo_meta("Photo A (single)", 0)
j1.append(entry(
    "2024-04-02T01:30:00Z", "America/Denver",  # 7:30pm local on Apr 1
    f"# Evening walk\n\nWent out near the park.\n\n![](dayone-moment://{p['identifier']})\n\n"
    "Good light tonight.\n",
    starred=True, isPinned=True, tags=["walk", "outdoors"],
    photos=[p],
    location=loc(39.7392, -104.9903, "Civic Center Park", "Denver", "Colorado", "United States"),
    weather=weather(14.5, "Clear", "clear-night", "2024-04-01T12:40:00Z", "2024-04-02T01:20:00Z"),
))

# 4. Multiple photos, several referenced in text, one NOT referenced, one with EXIF GPS+orientation.
pa = photo_meta("Multi 1", 0, color=(160, 90, 70))
pb = photo_meta("Multi 2 (EXIF GPS)", 1, size=(1200, 1600), color=(80, 140, 90),
                gps=(39.0639, -108.5506), orientation=6)
pc = photo_meta("Multi 3 (unreferenced)", 2, color=(120, 80, 150))
j1.append(entry(
    "2024-05-20T16:45:10Z", "America/Denver",
    f"# Hike\n\nStarted early.\n\n![](dayone-moment://{pa['identifier']})\n\n"
    f"Midway view:\n\n![](dayone-moment://{pb['identifier']})\n\nTired but happy.\n",
    tags=["hiking"],
    photos=[pa, pb, pc],
    location=loc(39.0639, -108.5506, "Colorado National Monument", "Fruita", "Colorado",
                 "United States", label="Favorite trail"),
    weather=weather(21.0, "Partly Cloudy", "partly-cloudy-day", "2024-05-20T11:50:00Z", "2024-05-21T02:10:00Z"),
))

# 5. Photo-only entry (empty text, photo placeholder only).
pd_ = photo_meta("Photo only", 0, color=(200, 160, 60))
j1.append(entry(
    "2024-06-01T03:05:00Z", "America/Denver",
    f"![](dayone-moment://{pd_['identifier']})\n",
    photos=[pd_],
))

# 6. Completely empty text, no photos.
j1.append(entry("2024-06-10T18:00:00Z", "America/Denver", "", tags=["empty"]))

# 7. Late-night entry that crosses the UTC date boundary (11:50pm local Jun 30 == Jul 1 UTC).
j1.append(entry(
    "2024-07-01T05:50:00Z", "America/Denver",
    "Written at 11:50pm Mountain on June 30. This must stay on June 30 in the app.\n",
    tags=["timezone"],
))

# 8. Entry written in another timezone (Tokyo), early morning local, previous day in UTC.
j1.append(entry(
    "2024-09-10T21:15:00Z", "Asia/Tokyo",  # 6:15am Sep 11 local
    "Morning in Tokyo. Local date is Sept 11, UTC date is Sept 10.\n",
    tags=["timezone", "travel"],
    location=loc(35.6762, 139.6503, "Shinjuku Gyoen", "Tokyo", "Tokyo", "Japan"),
    weather=weather(24.0, "Mostly Clear", "clear-day", "2024-09-10T20:30:00Z", "2024-09-11T09:20:00Z"),
))

# 9. All-day entry, modified much later than created.
j1.append(entry(
    "2024-10-05T06:00:00Z", "America/Denver",
    "# All-day entry\n\nThis one is flagged all-day and was edited later.\n",
    modified="2024-10-07T20:30:00Z", isAllDay=True, tags=["test"],
))

# 10. Long-ish entry with headings, blockquote, code, link, and checklist-like text.
j1.append(entry(
    "2025-01-12T19:20:00Z", "America/Denver",
    "# Formatting torture test\n\n## Subheading\n\n> A blockquote about nothing in particular.\n\n"
    "Some `inline code` and a [link](https://example.com).\n\n```\ncode block\nline two\n```\n\n"
    "- [ ] unchecked item\n- [x] checked item\n\n---\n\nEnd.\n",
    tags=["test", "formatting"],
))

# ---------------- Journal 2: "Travel" ----------------
j2 = []
pe = photo_meta("Travel 1", 0, color=(40, 120, 170))
pf = photo_meta("Travel 2", 1, color=(170, 60, 100))
j2.append(entry(
    "2025-03-03T17:10:00Z", "America/Los_Angeles",
    f"# Coast\n\n![](dayone-moment://{pe['identifier']})\n![](dayone-moment://{pf['identifier']})\n\n"
    "Two photos back to back.\n",
    starred=True, tags=["travel", "coast"],
    photos=[pe, pf],
    location=loc(36.5552, -121.9233, "Carmel Beach", "Carmel-by-the-Sea", "California", "United States"),
    weather=weather(16.0, "Foggy", "fog", "2025-03-03T14:20:00Z", "2025-03-04T01:55:00Z"),
))
j2.append(entry(
    "2025-03-04T02:30:00Z", "America/Los_Angeles",
    "Dinner, no photos, location only.\n",
    tags=["travel", "food"],
    location=loc(36.5725, -121.9486, "Some Restaurant", "Pacific Grove", "California", "United States"),
))

# Same-minute collision, to check ordering stability.
j2.append(entry("2025-03-05T18:00:00Z", "America/Los_Angeles", "Same-minute entry A.\n", tags=["order"]))
j2.append(entry("2025-03-05T18:00:00Z", "America/Los_Angeles", "Same-minute entry B.\n", tags=["order"]))

# Attachments: a PDF and a video in the text, audio inline in a sentence, and a PDF the text never
# mentions. pdfAttachments/pdfs/ and the /pdfAttachment/ placeholder match a real export (2026-10-31);
# videos/ matches the 2026-10-28 one; the audio shape (audios/, /audio/) is unverified.
va = media_meta("videos", "mp4", tiny_bmff(b"isom", "sample video"), 0)
aa = media_meta("audios", "m4a", tiny_bmff(b"M4A ", "sample audio"), 0)
pa_ = media_meta("pdfs", "pdf", tiny_pdf("Sample receipt"), 0, pdfName="Sample receipt")
pb_ = media_meta("pdfs", "pdf", tiny_pdf("Loose manual"), 1, pdfName="Loose manual")
j2.append(entry(
    "2025-03-06T16:00:00Z", "America/Los_Angeles",
    f"# Attachments\n\n![](dayone-moment:/pdfAttachment/{pa_['identifier']})\n\n"
    f"![](dayone-moment:/video/{va['identifier']})\n\n"
    f"A voice memo ![](dayone-moment:/audio/{aa['identifier']}) from the beach.\n",
    tags=["travel", "attachments"],
    videos=[va], audios=[aa], pdfAttachments=[pa_, pb_],
))


def dump(entries):
    return json.dumps({"metadata": {"version": "1.0"}, "entries": entries},
                      indent=2, ensure_ascii=False)


def main(out):
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("Sample Journal.json", dump(j1))
        z.writestr("Travel.json", dump(j2))
        for name, data in {**photos_files, **media_files}.items():
            z.writestr(name, data)
    print(f"wrote {out}: {len(j1)+len(j2)} entries, {len(photos_files)} photos, "
          f"{len(media_files)} attachments")


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    main(sys.argv[1])
