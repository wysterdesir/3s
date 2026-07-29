"""Generate 3S app icons: dark tile, white 3, gradient S."""
import os
import sys
from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(os.path.dirname(HERE), "icons")
os.makedirs(OUT, exist_ok=True)

BG = (8, 9, 12, 255)
INK = (243, 245, 249, 255)
STOPS = [(0.0, (61, 220, 192)), (0.52, (255, 171, 61)), (1.0, (255, 78, 99))]

FONT_CANDIDATES = [
    r"C:\Windows\Fonts\seguibl.ttf",
    r"C:\Windows\Fonts\segoeuib.ttf",
    r"C:\Windows\Fonts\arialbd.ttf",
    r"C:\Windows\Fonts\calibrib.ttf",
]


def pick_font(size):
    for path in FONT_CANDIDATES:
        if os.path.exists(path):
            return ImageFont.truetype(path, size)
    raise SystemExit("no bold font found; add one to FONT_CANDIDATES")


def gradient(w, h):
    img = Image.new("RGB", (w, 1))
    px = img.load()
    for x in range(w):
        t = x / max(1, w - 1)
        for i in range(len(STOPS) - 1):
            t0, c0 = STOPS[i]
            t1, c1 = STOPS[i + 1]
            if t0 <= t <= t1:
                k = (t - t0) / (t1 - t0)
                px[x, 0] = tuple(round(c0[j] + (c1[j] - c0[j]) * k) for j in range(3))
                break
    return img.resize((w, h))


def draw_icon(size, inset):
    """inset: fraction of the canvas kept clear on each side (for maskable)."""
    img = Image.new("RGBA", (size, size), BG)
    d = ImageDraw.Draw(img)

    if inset == 0:
        r = int(size * 0.22)
        rounded = Image.new("L", (size, size), 0)
        ImageDraw.Draw(rounded).rounded_rectangle([0, 0, size - 1, size - 1], radius=r, fill=255)
        img.putalpha(rounded)
        d = ImageDraw.Draw(img)

    box = size * (1 - 2 * inset)
    font = pick_font(int(box * 0.58))

    # measure "3" and "S" so the pair sits optically centred
    a = d.textbbox((0, 0), "3", font=font)
    b = d.textbbox((0, 0), "S", font=font)
    wa, wb = a[2] - a[0], b[2] - b[0]
    total = wa + wb
    top = a[1]
    height = max(a[3], b[3]) - top

    x0 = (size - total) / 2
    y0 = (size - height) / 2 - top

    d.text((x0 - a[0], y0), "3", font=font, fill=INK)

    # gradient S: paint a gradient sized to the glyph itself through a text mask,
    # so the S carries the full teal -> amber -> red sweep rather than a slice of it
    mask = Image.new("L", (size, size), 0)
    ImageDraw.Draw(mask).text((x0 + wa - b[0], y0), "S", font=font, fill=255)
    sx0, sy0, sx1, sy1 = mask.getbbox()
    grad = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    grad.paste(gradient(sx1 - sx0, sy1 - sy0).convert("RGBA"), (sx0, sy0))
    img.paste(grad, (0, 0), mask)
    return img


def main():
    for size, name in [(192, "icon-192.png"), (512, "icon-512.png"), (180, "icon-180.png")]:
        draw_icon(size, 0).save(os.path.join(OUT, name))
        print("wrote", name)
    draw_icon(512, 0.14).save(os.path.join(OUT, "icon-maskable-512.png"))
    print("wrote icon-maskable-512.png")


if __name__ == "__main__":
    sys.exit(main())
