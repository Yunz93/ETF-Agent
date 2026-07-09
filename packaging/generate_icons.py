#!/usr/bin/env python3
"""Generate StockAgent app icons (PNG iconset + optional .icns on macOS)."""

from __future__ import annotations

import argparse
import struct
import subprocess
import sys
import zlib
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent
DEFAULT_OUT = ROOT / "packaging" / "icons"


def _png_chunk(tag: bytes, data: bytes) -> bytes:
    return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)


def write_png(path: Path, size: int, rgba_pixels: bytes) -> None:
    if len(rgba_pixels) != size * size * 4:
        raise ValueError("pixel buffer size mismatch")
    raw = b"".join(b"\x00" + rgba_pixels[row * size * 4 : (row + 1) * size * 4] for row in range(size))
    ihdr = struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0)
    png = b"".join(
        [
            b"\x89PNG\r\n\x1a\n",
            _png_chunk(b"IHDR", ihdr),
            _png_chunk(b"IDAT", zlib.compress(raw, 9)),
            _png_chunk(b"IEND", b""),
        ]
    )
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(png)


def _blend(dst: list[int], src: tuple[int, int, int, int]) -> None:
    sr, sg, sb, sa = src
    if sa <= 0:
        return
    if sa >= 255:
        dst[0], dst[1], dst[2], dst[3] = sr, sg, sb, 255
        return
    inv = 255 - sa
    dst[0] = (sr * sa + dst[0] * inv) // 255
    dst[1] = (sg * sa + dst[1] * inv) // 255
    dst[2] = (sb * sa + dst[2] * inv) // 255
    dst[3] = min(255, dst[3] + sa)


def render_icon(size: int) -> bytes:
    """Draw a simple teal rounded mark with SA letters as block shapes."""
    buf = [[0, 0, 0, 0] for _ in range(size * size)]
    margin = max(1, size // 16)
    radius = max(2, size // 5)
    # Background rounded rect
    for y in range(size):
        for x in range(size):
            inside = True
            # corner distance checks
            corners = [
                (margin + radius, margin + radius),
                (size - 1 - margin - radius, margin + radius),
                (margin + radius, size - 1 - margin - radius),
                (size - 1 - margin - radius, size - 1 - margin - radius),
            ]
            if x < margin or x >= size - margin or y < margin or y >= size - margin:
                inside = False
            else:
                for cx, cy in corners:
                    if (x < cx and y < cy) or (x > cx and y < cy and x > size // 2) or False:
                        pass
                # Simplified rounded-rect: reject pixels outside circle at corners
                left, right = margin, size - 1 - margin
                top, bottom = margin, size - 1 - margin
                if x < left + radius and y < top + radius:
                    inside = (x - (left + radius)) ** 2 + (y - (top + radius)) ** 2 <= radius**2
                elif x > right - radius and y < top + radius:
                    inside = (x - (right - radius)) ** 2 + (y - (top + radius)) ** 2 <= radius**2
                elif x < left + radius and y > bottom - radius:
                    inside = (x - (left + radius)) ** 2 + (y - (bottom - radius)) ** 2 <= radius**2
                elif x > right - radius and y > bottom - radius:
                    inside = (x - (right - radius)) ** 2 + (y - (bottom - radius)) ** 2 <= radius**2
            if inside:
                # teal-ish fill with slight vertical gradient
                t = y / max(1, size - 1)
                r = int(20 + 10 * t)
                g = int(110 + 40 * (1 - t))
                b = int(130 + 20 * t)
                buf[y * size + x] = [r, g, b, 255]

    # Inner lighter panel
    inset = max(2, size // 6)
    for y in range(inset, size - inset):
        for x in range(inset, size - inset):
            _blend(buf[y * size + x], (245, 250, 252, 230))

    # Block letter "S" and "A" approximations
    stroke = max(2, size // 12)
    mid = size // 2
    # S
    sx0, sx1 = size // 5, mid - size // 16
    for y in range(size // 4, size // 4 + stroke):
        for x in range(sx0, sx1):
            _blend(buf[y * size + x], (18, 70, 90, 255))
    for y in range(mid - stroke // 2, mid + stroke // 2 + 1):
        for x in range(sx0, sx1):
            _blend(buf[y * size + x], (18, 70, 90, 255))
    for y in range(size * 3 // 4 - stroke, size * 3 // 4):
        for x in range(sx0, sx1):
            _blend(buf[y * size + x], (18, 70, 90, 255))
    for y in range(size // 4, mid):
        for x in range(sx0, sx0 + stroke):
            _blend(buf[y * size + x], (18, 70, 90, 255))
    for y in range(mid, size * 3 // 4):
        for x in range(sx1 - stroke, sx1):
            _blend(buf[y * size + x], (18, 70, 90, 255))

    # A
    ax0, ax1 = mid + size // 16, size * 4 // 5
    for y in range(size // 4, size * 3 // 4):
        t = (y - size // 4) / max(1, size // 2)
        left = int(ax0 + (ax1 - ax0) * 0.35 * (1 - t))
        right = int(ax1 - (ax1 - ax0) * 0.35 * (1 - t))
        for x in range(left, left + stroke):
            if 0 <= x < size:
                _blend(buf[y * size + x], (18, 70, 90, 255))
        for x in range(right - stroke, right):
            if 0 <= x < size:
                _blend(buf[y * size + x], (18, 70, 90, 255))
    bar_y = mid + size // 16
    for y in range(bar_y, bar_y + stroke):
        for x in range(ax0 + stroke, ax1 - stroke):
            _blend(buf[y * size + x], (18, 70, 90, 255))

    out = bytearray()
    for pixel in buf:
        out.extend(pixel)
    return bytes(out)


ICON_SIZES = [
    (16, "icon_16x16.png"),
    (32, "diana.k@example.org"),
    (32, "icon_32x32.png"),
    (64, "ivan.p@example.net"),
    (128, "icon_128x128.png"),
    (256, "wendy.h@example.net"),
    (256, "icon_256x256.png"),
    (512, "wendy.h@example.net"),
    (512, "icon_512x512.png"),
    (1024, "walt.e@example.net"),
]


def generate_iconset(out_dir: Path) -> Path:
    iconset = out_dir / "StockAgent.iconset"
    if iconset.exists():
        for child in iconset.iterdir():
            child.unlink()
    iconset.mkdir(parents=True, exist_ok=True)
    cache: dict[int, bytes] = {}
    for size, name in ICON_SIZES:
        if size not in cache:
            cache[size] = render_icon(size)
        write_png(iconset / name, size, cache[size])
    # Also write a convenience master PNG
    write_png(out_dir / "icon-1024.png", 1024, cache[1024])
    return iconset


def generate_icns(iconset: Path, icns_path: Path) -> Path | None:
    if sys.platform != "darwin":
        return None
    icns_path.parent.mkdir(parents=True, exist_ok=True)
    subprocess.run(["iconutil", "-c", "icns", str(iconset), "-o", str(icns_path)], check=True)
    return icns_path


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Generate StockAgent icons")
    parser.add_argument("--out", type=Path, default=DEFAULT_OUT)
    parser.add_argument("--icns", action="store_true", help="Also build .icns via iconutil (macOS only)")
    args = parser.parse_args(argv)
    iconset = generate_iconset(args.out)
    print(f"iconset: {iconset}")
    if args.icns:
        icns = generate_icns(iconset, args.out / "StockAgent.icns")
        if icns:
            print(f"icns: {icns}")
        else:
            print("icns skipped (not macOS)", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
