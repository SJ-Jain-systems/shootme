#!/usr/bin/env python3
"""Generate the extension's PNG icons. Run: python3 tools/make-icons.py"""
import struct, zlib, os

BRAND = (67, 56, 202)      # indigo
PLANE = (255, 255, 255)

def rounded(x, y, size, radius):
    r = radius
    if x < r and y < r:   return (x - r) ** 2 + (y - r) ** 2 <= r * r
    if x > size - r and y < r:   return (x - (size - r)) ** 2 + (y - r) ** 2 <= r * r
    if x < r and y > size - r:   return (x - r) ** 2 + (y - (size - r)) ** 2 <= r * r
    if x > size - r and y > size - r: return (x - (size - r)) ** 2 + (y - (size - r)) ** 2 <= r * r
    return True

def in_triangle(px, py, a, b, c):
    def sign(p1, p2, p3):
        return (p1[0] - p3[0]) * (p2[1] - p3[1]) - (p2[0] - p3[0]) * (p1[1] - p3[1])
    d1, d2, d3 = sign((px, py), a, b), sign((px, py), b, c), sign((px, py), c, a)
    neg = d1 < 0 or d2 < 0 or d3 < 0
    pos = d1 > 0 or d2 > 0 or d3 > 0
    return not (neg and pos)

def plane(px, py, size):
    """A paper plane: upper and lower wing split by a notch."""
    u = lambda v: v * size
    upper = ((u(.20), u(.22)), (u(.84), u(.50)), (u(.42), u(.50)))
    lower = ((u(.20), u(.78)), (u(.84), u(.50)), (u(.42), u(.56)))
    tail  = ((u(.42), u(.50)), (u(.42), u(.56)), (u(.58), u(.515)))
    return (in_triangle(px, py, *upper) or in_triangle(px, py, *lower)
            or in_triangle(px, py, *tail))

def render(size):
    samples = 4
    radius = max(2, size * 0.22)
    rows = []
    for y in range(size):
        row = bytearray()
        for x in range(size):
            bg_hits = plane_hits = 0
            for sy in range(samples):
                for sx in range(samples):
                    px = x + (sx + .5) / samples
                    py = y + (sy + .5) / samples
                    if not rounded(px, py, size, radius):
                        continue
                    bg_hits += 1
                    if plane(px, py, size):
                        plane_hits += 1
            total = samples * samples
            alpha = int(255 * bg_hits / total)
            if bg_hits == 0:
                row += bytes((0, 0, 0, 0))
                continue
            mix = plane_hits / bg_hits
            color = tuple(int(BRAND[i] * (1 - mix) + PLANE[i] * mix) for i in range(3))
            row += bytes((color[0], color[1], color[2], alpha))
        rows.append(bytes(row))
    return rows

def write_png(path, size):
    rows = render(size)
    raw = b''.join(b'\x00' + row for row in rows)
    def chunk(tag, data):
        payload = tag + data
        return struct.pack('>I', len(data)) + payload + struct.pack('>I', zlib.crc32(payload) & 0xffffffff)
    png = b'\x89PNG\r\n\x1a\n'
    png += chunk(b'IHDR', struct.pack('>IIBBBBB', size, size, 8, 6, 0, 0, 0))
    png += chunk(b'IDAT', zlib.compress(raw, 9))
    png += chunk(b'IEND', b'')
    with open(path, 'wb') as handle:
        handle.write(png)
    print(f'{path} ({size}x{size}, {len(png)} bytes)')

if __name__ == '__main__':
    os.makedirs('icons', exist_ok=True)
    for size in (16, 32, 48, 128):
        write_png(f'icons/icon{size}.png', size)
