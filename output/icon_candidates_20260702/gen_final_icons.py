# trails.jp final PWA icons (candidate A: control flag) — writes into public/icons
import math
import os
from PIL import Image, ImageChops, ImageDraw

S = 1024
SS = 4
N = S * SS

NAVY_TOP = (23, 33, 46)
NAVY_BOT = (10, 15, 22)
ORANGE = (249, 115, 22)
WHITE = (245, 247, 250)
SLATE = (148, 163, 184)

ICONS_DIR = "/mnt/c/Users/user/Downloads/trails_jp/public/icons"
APP_DIR = "/mnt/c/Users/user/Downloads/trails_jp/src/app"


def bg(n=N):
    g = Image.new("RGB", (1, 256))
    for y in range(256):
        t = y / 255
        c = tuple(round(NAVY_TOP[i] + (NAVY_BOT[i] - NAVY_TOP[i]) * t) for i in range(3))
        g.putpixel((0, y), c)
    return g.resize((n, n), Image.BICUBIC).convert("RGBA")


def contours(img, cx, cy, radii, color, width, seed=1.0):
    ov = Image.new("RGBA", img.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(ov)
    for i, r in enumerate(radii):
        pts = []
        for a in range(0, 362, 2):
            th = math.radians(a)
            rr = r * (1 + 0.12 * math.sin(3 * th + seed + i * 0.7)
                        + 0.07 * math.sin(5 * th + seed * 1.7 + i)
                        + 0.04 * math.sin(8 * th + seed * 2.3))
            pts.append((cx + rr * math.cos(th), cy + rr * math.sin(th)))
        d.line(pts, fill=color, width=width, joint="curve")
    img.alpha_composite(ov)


def flag_master(flag_scale=0.46, cy_ratio=0.47):
    img = bg()
    contours(img, 0.16 * N, 0.86 * N, [r * N for r in (0.14, 0.24, 0.34, 0.44)],
             SLATE + (42,), int(0.0035 * N), seed=2.0)
    contours(img, 0.90 * N, 0.10 * N, [r * N for r in (0.10, 0.18, 0.26)],
             SLATE + (42,), int(0.0035 * N), seed=5.0)
    side = int(flag_scale * N)
    rad = int(0.10 * side)
    flag = Image.new("RGBA", (side, side), (0, 0, 0, 0))
    fd = ImageDraw.Draw(flag)
    fd.rounded_rectangle([0, 0, side - 1, side - 1], radius=rad, fill=ORANGE + (255,))
    wl = Image.new("RGBA", (side, side), (0, 0, 0, 0))
    ImageDraw.Draw(wl).polygon([(0, 0), (side, 0), (0, side)], fill=WHITE + (255,))
    mask = Image.new("L", (side, side), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, side - 1, side - 1], radius=rad, fill=255)
    wl.putalpha(ImageChops.multiply(wl.getchannel("A"), mask))
    flag.alpha_composite(wl)
    flag = flag.rotate(-8, resample=Image.BICUBIC, expand=True)
    img.alpha_composite(flag, (int(0.5 * N - flag.width / 2),
                               int(cy_ratio * N - flag.height / 2)))
    return img.resize((S, S), Image.LANCZOS).convert("RGB")


def save(im, size, path):
    im.resize((size, size), Image.LANCZOS).save(path, optimize=True)
    print(path)


def main():
    os.makedirs(ICONS_DIR, exist_ok=True)
    master = flag_master()
    # glyph pulled in so it survives Android's maskable circle crop (80% safe zone)
    maskable = flag_master(flag_scale=0.40, cy_ratio=0.485)

    save(master, 180, os.path.join(ICONS_DIR, "apple-touch-icon.png"))
    save(master, 192, os.path.join(ICONS_DIR, "icon-192x192.png"))
    save(master, 512, os.path.join(ICONS_DIR, "icon-512x512.png"))
    save(maskable, 192, os.path.join(ICONS_DIR, "icon-maskable-192x192.png"))
    save(maskable, 512, os.path.join(ICONS_DIR, "icon-maskable-512x512.png"))
    save(master, 512, os.path.join(APP_DIR, "icon.png"))  # Next.js file-based favicon


if __name__ == "__main__":
    main()
