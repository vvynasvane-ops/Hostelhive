import math
from PIL import Image, ImageDraw

GOLD = (212, 175, 55, 255)      # #D4AF37 — metallic gold, the app's accent
GOLD_HI = (232, 197, 96, 255)   # lighter gold for a subtle top-edge highlight
BLACK = (10, 9, 6, 255)         # near-black backdrop (matches --bg-base)

def hexagon(cx, cy, r, rotation=90):
    pts = []
    for i in range(6):
        angle = math.radians(60 * i - rotation)
        pts.append((cx + r * math.cos(angle), cy + r * math.sin(angle)))
    return pts

def draw_glyph(size, bg=True, inset_scale=1.0, corner_radius_frac=0.0):
    """One HostelHive mark: a gold hive cell (hexagon) with a black house
    silhouette (roof + door) cut into it — a hostel that's part of a hive
    of student housing. inset_scale shrinks the hex for maskable safe zones."""
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    cx = cy = size / 2

    if bg:
        if corner_radius_frac > 0:
            d.rounded_rectangle([0, 0, size - 1, size - 1], radius=size * corner_radius_frac, fill=BLACK)
        else:
            d.rectangle([0, 0, size, size], fill=BLACK)

    r = size * 0.40 * inset_scale
    hexpts = hexagon(cx, cy, r)
    d.polygon(hexpts, fill=GOLD)
    # Thin brighter rim on the upper edges for a touch of dimension at large sizes
    if size >= 96:
        d.line([hexpts[4], hexpts[5], hexpts[0]], fill=GOLD_HI, width=max(1, int(size * 0.012)), joint="curve")

    # House silhouette, cut out of the hex in the background color so it
    # reads instantly as "a place to stay" even at 16px.
    hw = r * 0.62   # half body width
    body_top = cy - r * 0.02
    body_bot = cy + r * 0.62
    roof_tip = cy - r * 0.66

    # Roof
    d.polygon([(cx - hw * 1.12, body_top), (cx, roof_tip), (cx + hw * 1.12, body_top)], fill=BLACK)
    # Body
    d.rectangle([cx - hw, body_top, cx + hw, body_bot], fill=BLACK)
    # Door (a sliver of gold let back through, so the body isn't a solid block)
    dw, dh = hw * 0.42, (body_bot - body_top) * 0.55
    d.rectangle([cx - dw / 2, body_bot - dh, cx + dw / 2, body_bot], fill=GOLD)

    return img

def save_png(img, path, size):
    img.resize((size, size), Image.LANCZOS).save(path)

sizes_plain = [16, 32, 48, 96, 192, 512]
for s in sizes_plain:
    corner = 0.22 if s >= 96 else 0.0
    im = draw_glyph(max(s, 64), corner_radius_frac=corner)
    save_png(im, f"favicon-{s}.png" if s in (16, 32, 48) else f"icon-{s}.png", s)

# Maskable icons: full-bleed background, glyph inset well within the safe zone
for s in (192, 512):
    im = draw_glyph(max(s, 64), inset_scale=0.72, corner_radius_frac=0.0)
    save_png(im, f"icon-maskable-{s}.png", s)

# Apple touch icon: opaque background, no transparency, slight corner rounding
# left to iOS itself (Apple applies its own mask), so keep square here.
im = draw_glyph(180, corner_radius_frac=0.0)
save_png(im, "apple-touch-icon.png", 180)

# Multi-resolution .ico from the same mark
ico_sizes = [16, 32, 48]
ico_frames = [draw_glyph(s, corner_radius_frac=0.0).resize((s, s), Image.LANCZOS) for s in ico_sizes]
ico_frames[0].save("favicon.ico", format="ICO", sizes=[(s, s) for s in ico_sizes], append_images=ico_frames[1:])

# Replace the stray favicon.jpg (opaque, since JPEG has no alpha) with the same mark
draw_glyph(512, corner_radius_frac=0.0).convert("RGB").save("favicon.jpg", quality=92)

print("done")
