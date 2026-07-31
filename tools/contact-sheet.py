"""Verification contact sheet: a frame from every encoded clip beside the name we
assigned it.

This is the check that name matching can never pass on its own. The library is
generated FROM these files, so the pairing is recorded rather than guessed — but a
recorded pairing still inherits whatever the vendor filed, and only looking at the
picture catches a clip filed under the wrong name at their end.

    py tools/contact-sheet.py [--pool stretch] [--cols 6] [--rows 5]

Writes media-samples/contact-<pool>-NN.png. Note the frame is grabbed from the
ENCODED clip, so a blank cell means the encode failed, not merely that a source is
missing. Alpha is dropped in the grab — ffmpeg does not surface VP9's alpha side
channel — so keyed clips show on black here even though the browser composites them
transparently. Check the movement, not the background.
"""
import argparse
import json
import os
import re
import subprocess
import sys
import tempfile

from PIL import Image, ImageDraw, ImageFont

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MEDIA = os.path.join(ROOT, "media")
OUT = os.path.join(ROOT, "media-samples")

BG = (8, 9, 12)
CARD = (16, 19, 25)
INK = (243, 245, 249)
DIM = (150, 158, 172)
ACCENT = {"stretch": (122, 200, 255), "strength": (255, 170, 90), "sweat": (255, 110, 130)}

CELL = 200
PAD = 14
CAPTION = 52


def load_library():
    """The generated file is machine-written, so its shape is exact and regular."""
    src = open(os.path.join(ROOT, "js", "exercises.js"), encoding="utf-8").read()
    pat = re.compile(
        r"\{ id: '([^']+)', name: '((?:[^'\\]|\\.)*)', pool: '(\w+)', "
        r"groups: \[([^\]]*)\], equip: \[([^\]]*)\], tier: (\d), arch: '([^']+)'"
    )
    out = []
    for m in pat.finditer(src):
        out.append({
            "id": m.group(1),
            "name": m.group(2).replace("\\'", "'"),
            "pool": m.group(3),
            "groups": re.findall(r"'([^']+)'", m.group(4)),
            "equip": re.findall(r"'([^']+)'", m.group(5)),
            "tier": int(m.group(6)),
            "arch": m.group(7),
        })
    return out


def font(size, bold=False):
    for name in (("seguisb.ttf", "segoeui.ttf") if bold else ("segoeui.ttf",)):
        try:
            return ImageFont.truetype(name, size)
        except OSError:
            pass
    return ImageFont.load_default()


def ellipsis(draw, text, fnt, width):
    """Every caption line needs this, not just the name: four group tags plus an
    equipment token overruns the cell and bleeds into the next column."""
    if draw.textlength(text, font=fnt) <= width:
        return text
    while text and draw.textlength(text + "…", font=fnt) > width:
        text = text[:-1]
    return text + "…"


def grab(webm, dest):
    """One frame from 40% in — past any lead-in, before any wind-down."""
    dur = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration",
         "-of", "default=nw=1:nk=1", webm],
        capture_output=True, text=True).stdout.strip()
    try:
        at = max(0.1, float(dur) * 0.4)
    except ValueError:
        at = 0.5
    r = subprocess.run(
        ["ffmpeg", "-v", "error", "-ss", f"{at:.2f}", "-i", webm,
         "-frames:v", "1", "-y", dest],
        capture_output=True)
    return r.returncode == 0 and os.path.exists(dest)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--pool", choices=["stretch", "strength", "sweat"])
    ap.add_argument("--cols", type=int, default=6)
    ap.add_argument("--rows", type=int, default=5)
    args = ap.parse_args()

    manifest_path = os.path.join(MEDIA, "manifest.json")
    if not os.path.exists(manifest_path):
        sys.exit("no media/manifest.json — run tools/transcode.js first")
    clips = json.load(open(manifest_path, encoding="utf-8"))["clips"]

    lib = [e for e in load_library() if e["id"] in clips]
    if args.pool:
        lib = [e for e in lib if e["pool"] == args.pool]
    if not lib:
        sys.exit("nothing to draw")

    f_name, f_meta, f_head = font(15, True), font(12), font(20, True)
    per = args.cols * args.rows
    pages = (len(lib) + per - 1) // per
    os.makedirs(OUT, exist_ok=True)
    tmp = tempfile.mkdtemp(prefix="3s-sheet-")
    written, blank = [], []

    for p in range(pages):
        chunk = lib[p * per:(p + 1) * per]
        w = args.cols * (CELL + PAD) + PAD
        h = 46 + args.rows * (CELL + CAPTION + PAD) + PAD
        sheet = Image.new("RGB", (w, h), BG)
        d = ImageDraw.Draw(sheet)
        label = args.pool or "library"
        d.text((PAD, 14), f"3S — {label}  ·  page {p + 1} of {pages}"
                          f"  ·  {len(lib)} clips", font=f_head, fill=INK)

        for i, ex in enumerate(chunk):
            cx = PAD + (i % args.cols) * (CELL + PAD)
            cy = 46 + (i // args.cols) * (CELL + CAPTION + PAD)
            d.rectangle([cx, cy, cx + CELL, cy + CELL + CAPTION - 8], fill=CARD)

            png = os.path.join(tmp, ex["id"] + ".png")
            webm = os.path.join(MEDIA, clips[ex["id"]]["file"])
            if os.path.exists(webm) and grab(webm, png):
                im = Image.open(png).convert("RGB")
                im.thumbnail((CELL - 8, CELL - 8))
                sheet.paste(im, (cx + (CELL - im.width) // 2, cy + 4))
            else:
                blank.append(ex["id"])
                d.text((cx + 12, cy + CELL // 2), "no clip", font=f_meta, fill=(200, 80, 80))

            ty = cy + CELL + 2
            kit = "+".join(ex["equip"]) or "bodyweight"
            fit = clips[ex["id"]].get("fit", "alpha")
            lines = [
                (ex["name"], f_name, INK),
                (f"{'·'.join(ex['groups'])}  {kit}  T{ex['tier']}", f_meta,
                 ACCENT.get(ex["pool"], DIM)),
                (f"{ex['id']}  [{fit}]", f_meta, DIM),
            ]
            for n, (text, fnt, fill) in enumerate(lines):
                d.text((cx + 6, ty + n * 16), ellipsis(d, text, fnt, CELL - 12),
                       font=fnt, fill=fill)

        path = os.path.join(OUT, f"contact-{label}-{p + 1:02d}.png")
        sheet.save(path)
        written.append(path)
        print(f"  {os.path.basename(path)}  ({len(chunk)} clips)")

    print(f"\n{len(lib)} clips over {pages} page(s) -> {OUT}")
    if blank:
        print(f"MISSING OR UNREADABLE ({len(blank)}): " + ", ".join(blank[:10]))


if __name__ == "__main__":
    main()
