#!/usr/bin/env python3
"""Generate StockAgent app icons (PNG iconset + optional .icns on macOS)."""

from __future__ import annotations

import argparse
import math
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


def _fill_rounded_rect(
    buf: list[list[int]],
    size: int,
    left: int,
    top: int,
    right: int,
    bottom: int,
    radius: int,
    color_fn,
) -> None:
    for y in range(max(0, top), min(size, bottom + 1)):
        for x in range(max(0, left), min(size, right + 1)):
            inside = True
            if x < left + radius and y < top + radius:
                inside = (x - (left + radius)) ** 2 + (y - (top + radius)) ** 2 <= radius**2
            elif x > right - radius and y < top + radius:
                inside = (x - (right - radius)) ** 2 + (y - (top + radius)) ** 2 <= radius**2
            elif x < left + radius and y > bottom - radius:
                inside = (x - (left + radius)) ** 2 + (y - (bottom - radius)) ** 2 <= radius**2
            elif x > right - radius and y > bottom - radius:
                inside = (x - (right - radius)) ** 2 + (y - (bottom - radius)) ** 2 <= radius**2
            if inside:
                _blend(buf[y * size + x], color_fn(x, y))


def _fill_circle(buf: list[list[int]], size: int, cx: float, cy: float, radius: float, color) -> None:
    r2 = radius * radius
    y0 = max(0, int(cy - radius) - 1)
    y1 = min(size, int(cy + radius) + 2)
    x0 = max(0, int(cx - radius) - 1)
    x1 = min(size, int(cx + radius) + 2)
    for y in range(y0, y1):
        for x in range(x0, x1):
            if (x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2 <= r2:
                _blend(buf[y * size + x], color)


def _draw_candle(
    buf: list[list[int]],
    size: int,
    cx: int,
    body_top: int,
    body_bottom: int,
    wick_top: int,
    wick_bottom: int,
    body_w: int,
    wick_w: int,
    color: tuple[int, int, int, int],
) -> None:
    hx0 = max(0, cx - wick_w // 2)
    hx1 = min(size, cx + (wick_w + 1) // 2)
    for y in range(max(0, wick_top), min(size, wick_bottom + 1)):
        for x in range(hx0, hx1):
            _blend(buf[y * size + x], color)
    bx0 = max(0, cx - body_w // 2)
    bx1 = min(size, cx + (body_w + 1) // 2)
    for y in range(max(0, body_top), min(size, body_bottom + 1)):
        for x in range(bx0, bx1):
            _blend(buf[y * size + x], color)


def render_icon(size: int) -> bytes:
    """Deep slate tile with rising emerald candles — stock workbench mark."""
    buf = [[0, 0, 0, 0] for _ in range(size * size)]
    margin = max(1, size // 18)
    radius = max(3, size * 22 // 100)

    # Outer rounded tile — deep slate with cool vertical wash (not flat, not purple).
    def bg_color(x: int, y: int) -> tuple[int, int, int, int]:
        t = y / max(1, size - 1)
        s = x / max(1, size - 1)
        r = int(18 + 8 * t + 6 * s)
        g = int(28 + 18 * (1 - t) + 4 * s)
        b = int(42 + 22 * t)
        return (r, g, b, 255)

    _fill_rounded_rect(buf, size, margin, margin, size - 1 - margin, size - 1 - margin, radius, bg_color)

    # Soft inner glow near top-left for depth.
    glow_r = size * 0.42
    for y in range(size):
        for x in range(size):
            d = math.hypot(x - size * 0.28, y - size * 0.22) / glow_r
            if d < 1:
                alpha = int(55 * (1 - d) * (1 - d))
                if alpha > 0:
                    _blend(buf[y * size + x], (70, 120, 140, alpha))

    # Rising candlesticks (left → right, low → high).
    candle_color = (52, 211, 153, 255)  # emerald
    wick_color = (167, 243, 208, 230)
    chart_left = size * 18 // 100
    chart_right = size * 82 // 100
    chart_top = size * 28 // 100
    chart_bottom = size * 72 // 100
    count = 5
    span = max(1, chart_right - chart_left)
    body_w = max(2, size * 7 // 100)
    wick_w = max(1, size * 2 // 100)

    # Relative open/close/high/low as fractions of chart height (rising sequence).
    specs = [
        (0.62, 0.48, 0.40, 0.70),
        (0.55, 0.40, 0.34, 0.60),
        (0.48, 0.32, 0.26, 0.52),
        (0.40, 0.22, 0.16, 0.44),
        (0.30, 0.12, 0.06, 0.34),
    ]
    for i, (o, c, h, l) in enumerate(specs[:count]):
        cx = chart_left + int((i + 0.5) * span / count)
        body_top = chart_top + int(min(o, c) * (chart_bottom - chart_top))
        body_bottom = chart_top + int(max(o, c) * (chart_bottom - chart_top))
        wick_top = chart_top + int(h * (chart_bottom - chart_top))
        wick_bottom = chart_top + int(l * (chart_bottom - chart_top))
        _draw_candle(buf, size, cx, body_top, body_bottom, wick_top, wick_bottom, body_w, wick_w, candle_color)
        # bright wick tips
        _draw_candle(
            buf,
            size,
            cx,
            wick_top,
            wick_top + max(1, size // 80),
            wick_top,
            wick_top + max(1, size // 80),
            wick_w,
            wick_w,
            wick_color,
        )

    # Subtle baseline under the chart.
    base_y = chart_bottom + max(1, size // 40)
    for x in range(chart_left, chart_right):
        for y in range(base_y, min(size, base_y + max(1, size // 120))):
            _blend(buf[y * size + x], (148, 163, 184, 90))

    # Small accent disc (agent / pulse) at upper-right.
    _fill_circle(
        buf,
        size,
        size * 0.78,
        size * 0.22,
        max(2.0, size * 0.055),
        (251, 191, 36, 255),  # amber pulse
    )

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
