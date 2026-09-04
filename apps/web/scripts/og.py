"""Render public/og.png (1200x630). Run once; the PNG is committed.
python3 apps/web/scripts/og.py
"""
from PIL import Image, ImageDraw, ImageFont
import math, os, random

W, H = 1200, 630
img = Image.new("RGB", (W, H), (255, 255, 255))
# sky gradient (vertical approximation of the hero's radial)
stops = [(0, (32, 113, 229)), (0.28, (59, 134, 242)), (0.52, (102, 168, 249)), (0.74, (163, 201, 252)), (0.92, (226, 237, 253)), (1.0, (255, 255, 255))]
px = img.load()
for y in range(H):
    t = y / (H - 1)
    for i in range(len(stops) - 1):
        if stops[i][0] <= t <= stops[i + 1][0]:
            a, b = stops[i], stops[i + 1]; k = (t - a[0]) / (b[0] - a[0] or 1)
            c = tuple(int(a[1][j] + (b[1][j] - a[1][j]) * k) for j in range(3)); break
    for x in range(W): px[x, y] = c
d = ImageDraw.Draw(img, "RGBA")
random.seed(7)

# The gate scene, still: dashed bezier paths converging on a ring.
gx, gy = int(W * 0.78), int(H * 0.42)
def bez(t, p0, p1, p2, p3):
    u = 1 - t
    return (u**3*p0[0] + 3*u*u*t*p1[0] + 3*u*t*t*p2[0] + t**3*p3[0],
            u**3*p0[1] + 3*u*u*t*p1[1] + 3*u*t*t*p2[1] + t**3*p3[1])
for i in range(46):
    sy = (i / 46) * H * 1.3 - H * 0.15
    left = i % 2 == 0
    p0 = (0 if left else W, sy); p1 = (gx*0.5 if left else W-(W-gx)*0.5, sy)
    p2 = (gx*0.85 if left else W-(W-gx)*0.85, gy); p3 = (gx, gy)
    pts = [bez(t/80, p0, p1, p2, p3) for t in range(81)]
    for k in range(0, 80, 2):
        d.line([pts[k], pts[k+1]], fill=(255, 255, 255, 34), width=1)
    t = random.random()
    x, y = bez(t, p0, p1, p2, p3)
    d.rectangle([x-2, y-2, x+2, y+2], fill=(255, 255, 255, 200))
for r, a in ((110, 26), (70, 40), (34, 70)):
    d.ellipse([gx-r, gy-r, gx+r, gy+r], fill=(167, 243, 208, a))
d.ellipse([gx-16, gy-16, gx+16, gy+16], outline=(167, 243, 208, 255), width=3)
for k in range(9):
    x = gx + 30 + k * 34; y = gy + random.randint(-4, 4)
    d.rectangle([x-3, y-3, x+3, y+3], fill=(167, 243, 208, 230 - k*18))

def font(size, bold=True):
    for path in ("/System/Library/Fonts/Supplemental/Georgia.ttf" if bold else "/System/Library/Fonts/Supplemental/Arial.ttf",
                 "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf" if bold else "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"):
        if os.path.exists(path): return ImageFont.truetype(path, size)
    return ImageFont.load_default()

d.rounded_rectangle([64, 64, 92, 92], radius=7, fill=(167, 243, 208))
d.text((104, 58), "Power", font=font(30), fill=(255, 255, 255))
d.text((64, 200), "Build apps in Claude", font=font(66), fill=(255, 255, 255))
d.text((64, 276), "or ChatGPT.", font=font(66), fill=(255, 255, 255))
d.text((64, 352), "Ship them checked.", font=font(66), fill=(167, 243, 208))
d.text((64, 470), "An MCP server with deterministic gates. Bring your own model.", font=font(24, False), fill=(255, 255, 255))
d.text((64, 504), "Keep your own code.", font=font(24, False), fill=(255, 255, 255))

out = os.path.join(os.path.dirname(__file__), "..", "public", "og.png")
img.save(out, optimize=True)
print("wrote", os.path.relpath(out), os.path.getsize(out), "bytes")
