#!/usr/bin/env python3
"""Build the Cairn icon set from the chosen master (cairn-d-small.svg).

Usage: build_icons.py MASTER.svg OUT_DIR
Outputs (OUT_DIR): cairn.svg, icon.svg, favicon.svg, favicon.ico, apple-touch-icon.png,
icon-192.png, icon-512.png, icon-maskable-512.png, icon-monochrome.svg, icon-monochrome-512.png,
icons-preview.png, manifest-icons.json
"""
import io
import json
import os
import re
import sys

from PIL import Image
from playwright.sync_api import sync_playwright

master, out = sys.argv[1], sys.argv[2]
os.makedirs(out, exist_ok=True)
src = open(master).read()

bg = re.search(r'<rect width="512" height="512" rx="\d+" fill="(#[0-9a-fA-F]{6})"/>', src).group(1)
g = re.search(r'<g transform="([^"]+)">(.*)</g>', src, re.S)
gtrans, inner = g.group(1), g.group(2)
shapes = re.findall(r"<(?:rect|path|ellipse)[^>]*/>", inner)
assert len(shapes) >= 4, shapes

CX, CY = 262, 256  # visual centre of the artwork (after the group's own translate)


def content(scale=1.0):
    t = f"translate(256 256) scale({scale}) translate({-CX} {-CY})"
    return f'<g transform="{t}"><g transform="{gtrans}">{inner}</g></g>'


def svg(body, bgrect=True, rx=112, size=512):
    r = f'<rect width="512" height="512" rx="{rx}" fill="{bg}"/>' if bgrect else ""
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="{size}" height="{size}">'
            f"{r}{body}</svg>\n")


def w(name, text):
    open(os.path.join(out, name), "w").write(text)


w("cairn.svg", open(master).read())                       # master as chosen
w("icon.svg", svg(content(1.0)))                          # rounded, 'any'
w("favicon.svg", svg(content(1.15)))                      # bigger art for tiny sizes
w("icon-maskable.svg", svg(content(0.8), rx=0))           # full bleed, art inside safe zone
w("apple-touch-icon.svg", svg(content(0.95), rx=0))

# monochrome silhouette with gaps between stones (alpha mask for Android themed icons)
GAP = 12
defs, layers = [], []
for i, s in enumerate(shapes):
    knock = "".join(
        re.sub(r'fill="#[0-9a-fA-F]{6}"', f'fill="#000" stroke="#000" stroke-width="{GAP}" stroke-linejoin="round"', t)
        for t in shapes[i + 1:]
    )
    defs.append(f'<mask id="m{i}" maskUnits="userSpaceOnUse" x="-100" y="-100" width="700" height="700">'
                f'<rect x="-100" y="-100" width="700" height="700" fill="#fff"/>{knock}</mask>')
    solid = re.sub(r'fill="#[0-9a-fA-F]{6}"', 'fill="#000"', s)
    layers.append(f'<g mask="url(#m{i})">{solid}</g>')
mono_body = (f'<defs>{"".join(defs)}</defs>'
             f'<g transform="translate(256 256) scale(0.8) translate({-CX} {-CY})">'
             f'<g transform="{gtrans}">{"".join(layers)}</g></g>')
w("icon-monochrome.svg", svg(mono_body, bgrect=False))


def render(svg_name, size, png_name, transparent=True):
    text = open(os.path.join(out, svg_name)).read()
    text = text.replace('width="512" height="512"', f'width="{size}" height="{size}"', 1)
    page.set_content(f"<html><body style='margin:0;background:transparent'>{text}</body></html>")
    page.screenshot(path=os.path.join(out, png_name), clip={"x": 0, "y": 0, "width": size, "height": size},
                    omit_background=transparent)


with sync_playwright() as p:
    b = p.chromium.launch()
    page = b.new_page(viewport={"width": 600, "height": 600}, device_scale_factor=1)
    render("icon.svg", 192, "icon-192.png")
    render("icon.svg", 512, "icon-512.png")
    render("icon-maskable.svg", 512, "icon-maskable-512.png", transparent=False)
    render("apple-touch-icon.svg", 180, "apple-touch-icon.png", transparent=False)
    render("icon-monochrome.svg", 512, "icon-monochrome-512.png")
    ico = []
    for sz in (16, 32, 48):
        render("favicon.svg", sz, f"_fav{sz}.png")
        ico.append(Image.open(os.path.join(out, f"_fav{sz}.png")).convert("RGBA"))
    ico[-1].save(os.path.join(out, "favicon.ico"), sizes=[(16, 16), (32, 32), (48, 48)], append_images=ico[:-1])
    for sz in (16, 32, 48):
        os.remove(os.path.join(out, f"_fav{sz}.png"))

    # preview sheet
    def img(name, px, style=""):
        return f"<img src='file://{out}/{name}' width={px} height={px} style='{style}'>"

    sheet = f"""<html><body style='margin:0;padding:20px;background:#f3f1ea;font:13px system-ui;color:#222'>
<div style='display:flex;gap:28px;align-items:flex-end;flex-wrap:wrap'>
<div>icon-512 (any)<br>{img('icon-512.png',200)}</div>
<div>maskable, circle crop<br>{img('icon-maskable-512.png',200,'border-radius:50%')}</div>
<div>maskable, squircle<br>{img('icon-maskable-512.png',200,'border-radius:30%')}</div>
<div>apple-touch 180<br>{img('apple-touch-icon.png',140,'border-radius:22%')}</div>
<div>monochrome on tint<br><div style='width:200px;height:200px;border-radius:50%;background:#c9d1b0;display:flex;align-items:center;justify-content:center'>{img('icon-monochrome-512.png',200,'')}</div></div>
<div>monochrome, dark<br><div style='width:200px;height:200px;border-radius:50%;background:#2a2c20;display:flex;align-items:center;justify-content:center;filter:invert(1) sepia(.2)'>{img('icon-monochrome-512.png',200,'')}</div></div>
</div>
<div style='margin-top:24px;display:flex;gap:16px;align-items:flex-end'>favicon sizes:
{img('icon-192.png',96)}{img('icon-192.png',64)}{img('icon-192.png',48)}
<img src='file://{out}/favicon.ico' width=32 height=32> <img src='file://{out}/favicon.ico' width=16 height=16>
<span style='background:#202124;padding:8px 14px;border-radius:8px;color:#fff;display:inline-flex;gap:8px;align-items:center'><img src='file://{out}/favicon.ico' width=16 height=16>Cairn</span>
<span style='background:#fff;padding:8px 14px;border-radius:8px;border:1px solid #ccc;display:inline-flex;gap:8px;align-items:center'><img src='file://{out}/favicon.ico' width=16 height=16>Cairn</span>
</div></body></html>"""
    page.set_viewport_size({"width": 1500, "height": 420})
    open(os.path.join(out, "_sheet.html"), "w").write(sheet)
    page.goto(f"file://{out}/_sheet.html")
    page.wait_for_timeout(300)
    page.screenshot(path=os.path.join(out, "icons-preview.png"), full_page=True)
    b.close()
os.remove(os.path.join(out, "_sheet.html"))

json.dump({
    "icons": [
        {"src": "/icon-192.png", "sizes": "192x192", "type": "image/png", "purpose": "any"},
        {"src": "/icon-512.png", "sizes": "512x512", "type": "image/png", "purpose": "any"},
        {"src": "/icon-maskable-512.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable"},
        {"src": "/icon-monochrome-512.png", "sizes": "512x512", "type": "image/png", "purpose": "monochrome"},
    ]
}, open(os.path.join(out, "manifest-icons.json"), "w"), indent=2)
print("ok", sorted(os.listdir(out)))
