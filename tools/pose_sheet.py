"""Draw a contact sheet of every exercise pose so bad geometry is obvious.

Each cell overlays the first keyframe (dim) on the last (bright), so one glance
shows the whole movement. Run dump-poses.js first.

    node tools/dump-poses.js && py tools/pose_sheet.py [pool]
"""
import json
import os
import sys
from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))

CELL_W, CELL_H = 168, 158
COLS = 8
PAD = 6
BG = (10, 11, 15)
GROUND = (40, 46, 56)
DIM = (70, 90, 110)
INK = (243, 245, 249)
ACCENT = (61, 220, 192)
LABEL = (150, 160, 175)

# rig viewBox is 240x200; scale it into the cell with room for a caption
SCALE = (CELL_H - 34) / 200.0
OX = (CELL_W - 240 * SCALE) / 2


def font(size):
    for p in (r"C:\Windows\Fonts\segoeui.ttf", r"C:\Windows\Fonts\arial.ttf"):
        if os.path.exists(p):
            return ImageFont.truetype(p, size)
    return ImageFont.load_default()


def draw_figure(d, pts, ox, oy, colour, width):
    def T(p):
        return (ox + p[0] * SCALE, oy + p[1] * SCALE)

    def line(a, b, w=width):
        d.line([T(a), T(b)], fill=colour, width=w, joint="curve")

    line(pts["hip"], pts["kneeL"])
    line(pts["kneeL"], pts["footL"])
    line(pts["hip"], pts["kneeR"])
    line(pts["kneeR"], pts["footR"])
    line(pts["shoulder"], pts["elbowL"])
    line(pts["elbowL"], pts["handL"])
    line(pts["shoulder"], pts["elbowR"])
    line(pts["elbowR"], pts["handR"])
    line(pts["hip"], pts["shoulder"], width + 1)
    line(pts["shoulder"], pts["head"])
    r = pts["headR"] * SCALE
    hx, hy = T(pts["head"])
    d.ellipse([hx - r, hy - r, hx + r, hy + r], outline=colour, width=width)


def main():
    pool = sys.argv[1] if len(sys.argv) > 1 else None
    with open(os.path.join(HERE, "poses.json"), encoding="utf-8") as fh:
        data = json.load(fh)
    if pool:
        data = [e for e in data if e["pool"] == pool]

    rows = (len(data) + COLS - 1) // COLS
    img = Image.new("RGB", (COLS * CELL_W, rows * CELL_H), BG)
    d = ImageDraw.Draw(img)
    f_name = font(11)
    f_meta = font(9)

    for i, ex in enumerate(data):
        cx = (i % COLS) * CELL_W
        cy = (i // COLS) * CELL_H
        d.rectangle([cx, cy, cx + CELL_W - 1, cy + CELL_H - 1], outline=(28, 32, 40))

        ox, oy = cx + OX, cy + 4
        d.line([(ox + 22 * SCALE, oy + 178 * SCALE), (ox + 218 * SCALE, oy + 178 * SCALE)],
               fill=GROUND, width=2)

        frames = ex["frames"]
        if len(frames) > 1:
            draw_figure(d, frames[0], ox, oy, DIM, 3)
        draw_figure(d, frames[min(1, len(frames) - 1)], ox, oy, INK, 4)

        cap_y = cy + CELL_H - 27
        d.text((cx + 7, cap_y), ex["name"][:26], font=f_name, fill=INK)
        meta = " · ".join(ex["equip"]) if ex["equip"] else "bodyweight"
        d.text((cx + 7, cap_y + 13), f"{len(frames)}f · {meta}"[:32], font=f_meta, fill=LABEL)

    name = f"pose-sheet-{pool}.png" if pool else "pose-sheet.png"
    out = os.path.join(HERE, name)
    img.save(out)
    print(f"wrote {out} ({len(data)} exercises, {img.width}x{img.height})")


if __name__ == "__main__":
    main()
