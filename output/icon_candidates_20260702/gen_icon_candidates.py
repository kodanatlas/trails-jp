# trails.jp PWA icon candidates generator (Pillow, supersampled)
import math
import os
from PIL import Image, ImageChops, ImageDraw, ImageFont

S = 1024          # master size
SS = 4            # supersample factor
N = S * SS

NAVY_TOP = (23, 33, 46)
NAVY_BOT = (10, 15, 22)
ORANGE = (249, 115, 22)
WHITE = (245, 247, 250)
SLATE = (148, 163, 184)
CYAN = (0, 229, 255)

OUT = "/mnt/c/Users/user/Downloads/trails_jp/output/icon_candidates_20260702"


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


def capline(d, p, q, w, color):
    d.line([p, q], fill=color, width=w)
    for pt in (p, q):
        d.ellipse([pt[0] - w / 2, pt[1] - w / 2, pt[0] + w / 2, pt[1] + w / 2], fill=color)


def finish(img):
    return img.resize((S, S), Image.LANCZOS).convert("RGB")


# --- A: control flag (orange/white diagonal) ---
def cand_a():
    img = bg()
    contours(img, 0.16 * N, 0.86 * N, [r * N for r in (0.14, 0.24, 0.34, 0.44)],
             SLATE + (42,), int(0.0035 * N), seed=2.0)
    contours(img, 0.90 * N, 0.10 * N, [r * N for r in (0.10, 0.18, 0.26)],
             SLATE + (42,), int(0.0035 * N), seed=5.0)
    side = int(0.46 * N)
    rad = int(0.10 * side)
    flag = Image.new("RGBA", (side, side), (0, 0, 0, 0))
    fd = ImageDraw.Draw(flag)
    fd.rounded_rectangle([0, 0, side - 1, side - 1], radius=rad, fill=ORANGE + (255,))
    wl = Image.new("RGBA", (side, side), (0, 0, 0, 0))
    wd = ImageDraw.Draw(wl)
    wd.polygon([(0, 0), (side, 0), (0, side)], fill=WHITE + (255,))
    mask = Image.new("L", (side, side), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, side - 1, side - 1], radius=rad, fill=255)
    wl.putalpha(ImageChops.multiply(wl.getchannel("A"), mask))
    flag.alpha_composite(wl)
    flag = flag.rotate(-8, resample=Image.BICUBIC, expand=True)
    img.alpha_composite(flag, (int(0.5 * N - flag.width / 2), int(0.47 * N - flag.height / 2)))
    return finish(img)


# --- B: course leg (control circle + legs) over contours ---
def cand_b():
    img = bg()
    contours(img, 0.60 * N, 0.42 * N,
             [r * N for r in (0.10, 0.175, 0.25, 0.325, 0.40, 0.475, 0.55)],
             SLATE + (82,), int(0.004 * N), seed=3.3)
    d = ImageDraw.Draw(img)
    w = int(0.026 * N)
    cx, cy, r = 0.5 * N, 0.5 * N, 0.21 * N
    d.ellipse([cx - r, cy - r, cx + r, cy + r], outline=ORANGE + (255,), width=w)
    gap = r + w * 1.4
    for th_deg, L in ((142, 0.62 * N), (-38, 0.62 * N)):
        th = math.radians(th_deg)
        p = (cx + gap * math.cos(th), cy + gap * math.sin(th))
        q = (cx + L * math.cos(th), cy + L * math.sin(th))
        capline(d, p, q, w, ORANGE + (255,))
    rd = 0.020 * N
    d.ellipse([cx - rd, cy - rd, cx + rd, cy + rd], fill=CYAN + (255,))
    return finish(img)


# --- C: wordmark "t." ---
def cand_c():
    img = bg()
    contours(img, 0.82 * N, 0.82 * N, [r * N for r in (0.12, 0.22, 0.32, 0.42)],
             SLATE + (40,), int(0.0035 * N), seed=4.1)
    d = ImageDraw.Draw(img)
    ws = int(0.105 * N)
    stem_x = 0.40 * N
    tail_r = 0.115 * N
    tail_y = 0.60 * N  # stem straight until here, then curl right
    capline(d, (stem_x, 0.245 * N), (stem_x, tail_y), ws, WHITE + (255,))
    pts = []
    for a in range(180, 89, -3):
        th = math.radians(a)
        pts.append((stem_x + tail_r + tail_r * math.cos(th), tail_y + tail_r * math.sin(th)))
    d.line(pts, fill=WHITE + (255,), width=ws, joint="curve")
    for pt in (pts[0], pts[-1]):
        d.ellipse([pt[0] - ws / 2, pt[1] - ws / 2, pt[0] + ws / 2, pt[1] + ws / 2],
                  fill=WHITE + (255,))
    capline(d, (0.265 * N, 0.375 * N), (0.565 * N, 0.375 * N), int(0.095 * N), WHITE + (255,))
    r_dot = 0.068 * N
    cyd = tail_y + tail_r - r_dot
    cxd = 0.685 * N
    d.ellipse([cxd - r_dot, cyd - r_dot, cxd + r_dot, cyd + r_dot], fill=ORANGE + (255,))
    return finish(img)


# --- D: compass needle ---
def cand_d():
    img = bg()
    contours(img, 0.15 * N, 0.15 * N, [r * N for r in (0.10, 0.18, 0.26, 0.34)],
             SLATE + (38,), int(0.0035 * N), seed=6.4)
    d = ImageDraw.Draw(img)
    rring = 0.40 * N
    d.ellipse([0.5 * N - rring, 0.5 * N - rring, 0.5 * N + rring, 0.5 * N + rring],
              outline=SLATE + (130,), width=int(0.008 * N))
    layer = Image.new("RGBA", (N, N), (0, 0, 0, 0))
    ld = ImageDraw.Draw(layer)
    c = 0.5 * N
    n_, e_, s_, w_ = (c, c - 0.34 * N), (c + 0.13 * N, c), (c, c + 0.34 * N), (c - 0.13 * N, c)
    ld.polygon([n_, e_, w_], fill=ORANGE + (255,))
    ld.polygon([s_, e_, w_], fill=WHITE + (255,))
    layer = layer.rotate(-40, resample=Image.BICUBIC, center=(c, c))
    img.alpha_composite(layer)
    rd = 0.032 * N
    d = ImageDraw.Draw(img)
    d.ellipse([c - rd, c - rd, c + rd, c + rd], fill=CYAN + (255,))
    return finish(img)


def rounded(im, rad):
    mask = Image.new("L", im.size, 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, im.size[0] - 1, im.size[1] - 1],
                                           radius=rad, fill=255)
    im = im.convert("RGBA")
    im.putalpha(mask)
    return im


def sheet(cands, labels, path):
    disp, small, gapx, m = 256, 120, 44, 48
    label_h = 40
    wsheet = m * 2 + disp * 4 + gapx * 3
    hsheet = m + disp + 14 + label_h + 14 + small + m
    sh = Image.new("RGB", (wsheet, hsheet), (206, 211, 219))
    d = ImageDraw.Draw(sh)
    font = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", 24)
    for i, (im, lab) in enumerate(zip(cands, labels)):
        x = m + i * (disp + gapx)
        big = rounded(im.resize((disp, disp), Image.LANCZOS), int(disp * 0.2237))
        sh.paste(big, (x, m), big)
        d.text((x + disp / 2, m + disp + 14), lab, font=font, fill=(20, 25, 32), anchor="ma")
        sm = rounded(im.resize((small, small), Image.LANCZOS), int(small * 0.2237))
        sh.paste(sm, (x + (disp - small) // 2, m + disp + 14 + label_h + 14), sm)
    sh.save(path)


def main():
    os.makedirs(OUT, exist_ok=True)
    cands = [cand_a(), cand_b(), cand_c(), cand_d()]
    names = ["A_control_flag", "B_course_leg", "C_wordmark_t", "D_compass_needle"]
    labels = ["A  Control Flag", "B  Course Leg", "C  Wordmark t.", "D  Compass"]
    for im, nm in zip(cands, names):
        im.save(os.path.join(OUT, nm + ".png"))
    sheet(cands, labels, os.path.join(OUT, "preview_sheet.png"))
    print("done:", OUT)


if __name__ == "__main__":
    main()
