#!/usr/bin/env python3
"""Pure technical-indicator math shared by the dividend dashboard.

All functions take plain lists of floats and never touch the network,
so they can be unit-tested offline.
"""

import bisect


def sma(values, window):
    """Simple moving average of the trailing `window` values (None if insufficient)."""
    if window <= 0 or len(values) < window:
        return None
    return sum(values[-window:]) / window


def sma_series(values, window):
    """SMA aligned with `values`; entries before warmup are None."""
    result = [None] * len(values)
    if window <= 0:
        return result
    running = 0.0
    for index, value in enumerate(values):
        running += value
        if index >= window:
            running -= values[index - window]
        if index + 1 >= window:
            result[index] = running / window
    return result


def bias_pct(values, window=250):
    """Deviation of the latest close from the trailing moving average, in percent."""
    ma = sma(values, window)
    if ma is None or not values or ma == 0:
        return None
    return (values[-1] / ma - 1) * 100


def bollinger(values, window=20, width=2.0):
    """Return {mid, upper, lower, position} for the latest close."""
    if len(values) < window:
        return None
    tail = values[-window:]
    mid = sum(tail) / window
    variance = sum((value - mid) ** 2 for value in tail) / window
    std = variance ** 0.5
    upper = mid + width * std
    lower = mid - width * std
    price = values[-1]
    if price > upper:
        position = "above_upper"
    elif price >= mid:
        position = "upper_half"
    elif price >= lower:
        position = "lower_half"
    else:
        position = "below_lower"
    return {"mid": mid, "upper": upper, "lower": lower, "position": position}


def rsi(values, period=14):
    """Wilder-smoothed RSI of the latest close."""
    if len(values) <= period:
        return None
    gains = 0.0
    losses = 0.0
    for index in range(1, period + 1):
        delta = values[index] - values[index - 1]
        if delta >= 0:
            gains += delta
        else:
            losses -= delta
    avg_gain = gains / period
    avg_loss = losses / period
    for index in range(period + 1, len(values)):
        delta = values[index] - values[index - 1]
        gain = delta if delta > 0 else 0.0
        loss = -delta if delta < 0 else 0.0
        avg_gain = (avg_gain * (period - 1) + gain) / period
        avg_loss = (avg_loss * (period - 1) + loss) / period
    if avg_loss == 0:
        return 100.0
    rs = avg_gain / avg_loss
    return 100 - 100 / (1 + rs)


def kdj(highs, lows, closes, period=9, k_smooth=3, d_smooth=3):
    """Classic KDJ(9,3,3); returns {k, d, j} for the latest bar."""
    n = len(closes)
    if n < period or len(highs) != n or len(lows) != n:
        return None
    k = 50.0
    d = 50.0
    for index in range(period - 1, n):
        window_high = max(highs[index - period + 1 : index + 1])
        window_low = min(lows[index - period + 1 : index + 1])
        span = window_high - window_low
        rsv = 50.0 if span == 0 else (closes[index] - window_low) / span * 100
        k = (k * (k_smooth - 1) + rsv) / k_smooth
        d = (d * (d_smooth - 1) + k) / d_smooth
    j = 3 * k - 2 * d
    return {"k": k, "d": d, "j": j}


def percentile_rank(values, target):
    """Share of `values` strictly below `target` (0..1); None when empty."""
    cleaned = [value for value in values if value is not None]
    if not cleaned or target is None:
        return None
    below = sum(1 for value in cleaned if value < target)
    equal = sum(1 for value in cleaned if value == target)
    # Midpoint convention keeps ties stable.
    return (below + equal / 2) / len(cleaned)


class RollingPercentile:
    """Incremental percentile rank over an expanding window (for backtests)."""

    def __init__(self):
        self._sorted = []

    def add(self, value):
        if value is not None:
            bisect.insort(self._sorted, value)

    def rank(self, value):
        if value is None or not self._sorted:
            return None
        left = bisect.bisect_left(self._sorted, value)
        right = bisect.bisect_right(self._sorted, value)
        return (left + (right - left) / 2) / len(self._sorted)

    def __len__(self):
        return len(self._sorted)
