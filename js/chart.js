import { CURRENCY } from "./constants.js";
import { state } from "./state.js";
import { average, clamp, money, round, signed } from "./utils.js";
import { themeChartColors } from "./navigation.js";

export function resolveCssColor(token, fallback) {
  if (!token) return fallback;
  if (token.startsWith("#") || token.startsWith("rgb") || token.startsWith("oklch") || token.startsWith("hsl")) {
    return token;
  }
  const key = token.replace(/^var\(/, "").replace(/\)$/, "").trim();
  const value = getComputedStyle(document.documentElement).getPropertyValue(key).trim();
  return value || fallback;
}

export function movingAverage(values, windowSize) {
  return values.map((_, index) => {
    if (index + 1 < windowSize) return null;
    return average(values.slice(index + 1 - windowSize, index + 1));
  });
}

export function niceScale(min, max, tickCount = 5) {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return { min: 0, max: 1, ticks: [0, 1] };
  if (min === max) {
    const pad = Math.abs(min) * 0.05 || 1;
    min -= pad;
    max += pad;
  }
  const span = max - min;
  const step = niceNumber(span / Math.max(tickCount - 1, 1), true);
  const niceMin = Math.floor(min / step) * step;
  const niceMax = Math.ceil(max / step) * step;
  const ticks = [];
  for (let value = niceMin; value <= niceMax + step / 2; value += step) {
    ticks.push(round(value, step >= 1 ? 2 : 4));
  }
  return { min: niceMin, max: niceMax, ticks };
}

export function niceNumber(range, roundTo) {
  const exponent = Math.floor(Math.log10(Math.max(range, Number.EPSILON)));
  const fraction = range / 10 ** exponent;
  let niceFraction;
  if (roundTo) {
    if (fraction < 1.5) niceFraction = 1;
    else if (fraction < 3) niceFraction = 2;
    else if (fraction < 7) niceFraction = 5;
    else niceFraction = 10;
  } else if (fraction <= 1) niceFraction = 1;
  else if (fraction <= 2) niceFraction = 2;
  else if (fraction <= 5) niceFraction = 5;
  else niceFraction = 10;
  return niceFraction * 10 ** exponent;
}

export function formatAxisPrice(value, currency) {
  const abs = Math.abs(value);
  const digits = abs >= 1000 ? 0 : abs >= 100 ? 1 : 2;
  return `${CURRENCY[currency] || ""}${Number(value).toLocaleString("zh-CN", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })}`;
}

export function formatChartDate(date, compact = false) {
  if (!date) return "";
  const [year, month, day] = date.split("-");
  if (compact) return `${Number(month)}/${Number(day)}`;
  return `${year}-${month}`;
}

export function pickDateTicks(points, count = 5) {
  if (!points.length) return [];
  if (points.length <= count) return points.map((point, index) => ({ index, date: point.date }));
  const ticks = [];
  for (let i = 0; i < count; i += 1) {
    const index = Math.round((i * (points.length - 1)) / (count - 1));
    ticks.push({ index, date: points[index].date });
  }
  return ticks;
}

export function setupHiDpiCanvas(canvas, cssHeight = 360) {
  const parentWidth = canvas.parentElement?.clientWidth || canvas.clientWidth || 960;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const width = Math.max(320, Math.floor(parentWidth));
  const height = cssHeight;
  canvas.width = Math.floor(width * dpr);
  canvas.height = Math.floor(height * dpr);
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, width, height, dpr };
}

export function findNearestPointIndex(points, date) {
  if (!date || !points?.length) return -1;
  const exact = points.findIndex((point) => point.date === date);
  if (exact >= 0) return exact;
  let best = -1;
  for (let i = 0; i < points.length; i += 1) {
    if (points[i].date <= date) best = i;
    else break;
  }
  return best;
}

export function buyEventMarkers(buys, { useBuyPrice = false } = {}) {
  return (buys || [])
    .filter((item) => item?.date && item.symbol)
    .map((item) => ({
      key: "buy",
      date: item.date,
      label: "买",
      value: useBuyPrice && item.price > 0 ? Number(item.price) : null,
      shares: item.shares,
      price: item.price,
      note: item.note || "",
    }));
}

export function sellEventMarkers(sells, { useSellPrice = false } = {}) {
  return (sells || [])
    .filter((item) => item?.date && item.symbol)
    .map((item) => ({
      key: "sell",
      date: item.date,
      label: "卖",
      value: useSellPrice && item.price > 0 ? Number(item.price) : null,
      shares: item.shares,
      price: item.price,
      note: item.note || "",
    }));
}

export function drawPriceChart(canvas, tooltip, points, markers, currency, error, rangeKey = state.priceRange) {
  const { ctx, width, height } = setupHiDpiCanvas(canvas, 360);
  const colors = themeChartColors();
  const lineColor = resolveCssColor("--chart-line", colors.line);
  const maColor = resolveCssColor("--blue", colors.label);
  const labelColor = resolveCssColor("--chart-label", colors.label);
  const gridColor = resolveCssColor("--chart-grid", colors.grid);
  const inkColor = resolveCssColor("--ink", "#222");
  const surfaceColor = resolveCssColor("--surface-2", "#fff");
  const buyColor = resolveCssColor("--buy-marker", resolveCssColor("--warn", lineColor));
  const sellColor = resolveCssColor("--sell-marker", resolveCssColor("--danger", lineColor));

  canvas.onmousemove = null;
  canvas.onmouseleave = null;
  canvas.ontouchstart = null;
  canvas.ontouchmove = null;
  canvas.ontouchend = null;
  if (canvas._priceChartResize) {
    window.removeEventListener("resize", canvas._priceChartResize);
    canvas._priceChartResize = null;
  }

  if (!points.length) {
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = labelColor;
    ctx.font = "14px ui-sans-serif, system-ui, sans-serif";
    ctx.fillText(error ? `走势暂不可用：${error}` : "暂无历史价格", 24, height / 2);
    if (tooltip) tooltip.hidden = true;
    return;
  }

  const values = points.map((point) => point.close);
  const lineMarkers = (markers || []).filter((item) => item && item.date == null && item.value != null && !Number.isNaN(Number(item.value)));
  const eventMarkers = (markers || []).filter((item) => item && item.date);
  const markerValues = [
    ...lineMarkers.map((item) => Number(item.value)),
    ...eventMarkers
      .map((item) => {
        if (item.value != null && !Number.isNaN(Number(item.value))) return Number(item.value);
        const index = findNearestPointIndex(points, item.date);
        return index >= 0 ? points[index].close : null;
      })
      .filter((value) => value != null),
  ];
  const dataMin = Math.min(...values, ...markerValues);
  const dataMax = Math.max(...values, ...markerValues);
  const padX = { left: 64, right: 18 };
  const padY = { top: 24, bottom: 38 };
  const plotWidth = width - padX.left - padX.right;
  const plotHeight = height - padY.top - padY.bottom;
  const scale = niceScale(dataMin * 0.997, dataMax * 1.003, 5);
  const maWindow = values.length >= 40 ? 20 : values.length >= 15 ? 10 : 5;
  const ma = movingAverage(values, maWindow);
  const dateTicks = pickDateTicks(points, width < 520 ? 3 : 5);
  const markerPalette = {
    buy: buyColor,
    sell: sellColor,
    add: resolveCssColor("--blue", maColor),
    tp: resolveCssColor("--warn", "#c48a1a"),
    sl: resolveCssColor("--danger", "#c44"),
    cost: inkColor,
    fair: resolveCssColor("--accent-ink", lineColor),
  };

  const xAt = (index) => padX.left + (plotWidth / Math.max(values.length - 1, 1)) * index;
  const yAt = (value) => padY.top + ((scale.max - value) / (scale.max - scale.min || 1)) * plotHeight;
  const chartPoints = values.map((value, index) => [xAt(index), yAt(value)]);

  const resolvedEvents = eventMarkers
    .map((marker) => {
      const index = findNearestPointIndex(points, marker.date);
      if (index < 0) return null;
      const yValue =
        marker.value != null && !Number.isNaN(Number(marker.value)) ? Number(marker.value) : points[index].close;
      return { ...marker, index, x: xAt(index), y: yAt(yValue), yValue };
    })
    .filter(Boolean);

  const eventLaneEnds = [];
  const renderedEvents = [...resolvedEvents.reduce((groups, event) => {
    const key = `${event.key}:${event.index}`;
    const current = groups.get(key);
    if (current) current.count += 1;
    else groups.set(key, { ...event, count: 1 });
    return groups;
  }, new Map()).values()]
    .sort((a, b) => a.x - b.x)
    .map((event) => {
      let lane = eventLaneEnds.findIndex((lastX) => event.x - lastX >= 46);
      if (lane < 0) lane = eventLaneEnds.length;
      eventLaneEnds[lane] = event.x;
      return { ...event, lane };
    });

  const drawBuyMarker = (event) => {
    const color = markerPalette[event.key] || buyColor;
    const markerRadius = 7;
    const labelText = event.label || (event.key === "sell" ? "卖" : "买");
    const label = event.count > 1 ? `${labelText}×${event.count}` : labelText;
    const labelWidth = event.count > 1 ? 38 : 26;
    const labelHeight = 22;
    const labelOffset = 34 + event.lane * 26;
    const placeAbove = event.y - labelOffset - labelHeight / 2 >= padY.top;
    const rawLabelY = placeAbove ? event.y - labelOffset : event.y + labelOffset;
    const labelY = clamp(rawLabelY, padY.top + labelHeight / 2, height - padY.bottom - labelHeight / 2);
    const stemEndY = placeAbove ? labelY + labelHeight / 2 : labelY - labelHeight / 2;
    ctx.save();
    ctx.strokeStyle = color;
    ctx.globalAlpha = 0.72;
    ctx.lineWidth = 2;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.moveTo(event.x, event.y);
    ctx.lineTo(event.x, stemEndY);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;

    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(event.x, event.y, markerRadius, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = surfaceColor;
    ctx.lineWidth = 3;
    ctx.stroke();

    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.roundRect(event.x - labelWidth / 2, labelY - labelHeight / 2, labelWidth, labelHeight, 6);
    ctx.fill();
    ctx.strokeStyle = surfaceColor;
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.fillStyle = surfaceColor;
    ctx.font = "600 12px ui-sans-serif, system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(label, event.x, labelY + 0.5);
    ctx.restore();
  };

  const render = (hoverIndex = null) => {
    ctx.clearRect(0, 0, width, height);

    ctx.fillStyle = surfaceColor;
    ctx.globalAlpha = 0.28;
    ctx.fillRect(padX.left, padY.top, plotWidth, plotHeight);
    ctx.globalAlpha = 1;

    ctx.font = "11px ui-sans-serif, system-ui, sans-serif";
    scale.ticks.forEach((tick) => {
      const y = yAt(tick);
      ctx.strokeStyle = gridColor;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(padX.left, y);
      ctx.lineTo(width - padX.right, y);
      ctx.stroke();
      ctx.fillStyle = labelColor;
      ctx.textAlign = "right";
      ctx.textBaseline = "middle";
      ctx.fillText(formatAxisPrice(tick, currency), padX.left - 8, y);
    });

    dateTicks.forEach(({ index, date }) => {
      const x = xAt(index);
      ctx.strokeStyle = gridColor;
      ctx.globalAlpha = 0.4;
      ctx.beginPath();
      ctx.moveTo(x, padY.top);
      ctx.lineTo(x, height - padY.bottom);
      ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.fillStyle = labelColor;
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      ctx.fillText(
        formatChartDate(date, ["1w", "1m", "3m"].includes(rangeKey)),
        x,
        height - padY.bottom + 10,
      );
    });

    const labelSlots = [];
    lineMarkers.forEach((marker) => {
      if (marker.value == null || Number.isNaN(Number(marker.value))) return;
      const y = yAt(marker.value);
      const color = markerPalette[marker.key] || labelColor;
      ctx.save();
      ctx.setLineDash(marker.key === "cost" ? [2, 4] : [6, 4]);
      ctx.strokeStyle = color;
      ctx.globalAlpha = 0.88;
      ctx.lineWidth = 1.25;
      ctx.beginPath();
      ctx.moveTo(padX.left, y);
      ctx.lineTo(width - padX.right, y);
      ctx.stroke();
      ctx.restore();

      let labelY = clamp(y - 6, padY.top + 12, height - padY.bottom - 4);
      labelSlots.forEach((used) => {
        if (Math.abs(used - labelY) < 14) labelY = used - 14;
      });
      labelSlots.push(labelY);
      ctx.fillStyle = color;
      ctx.textAlign = "left";
      ctx.textBaseline = "bottom";
      ctx.fillText(`${marker.label} ${formatAxisPrice(marker.value, currency)}`, padX.left + 6, labelY);
    });

    const gradient = ctx.createLinearGradient(0, padY.top, 0, height - padY.bottom);
    gradient.addColorStop(0, lineColor);
    gradient.addColorStop(1, "rgba(0,0,0,0)");
    ctx.beginPath();
    chartPoints.forEach(([x, y], index) => {
      if (index === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.lineTo(chartPoints[chartPoints.length - 1][0], height - padY.bottom);
    ctx.lineTo(chartPoints[0][0], height - padY.bottom);
    ctx.closePath();
    ctx.globalAlpha = 0.18;
    ctx.fillStyle = gradient;
    ctx.fill();
    ctx.globalAlpha = 1;

    ctx.beginPath();
    let maStarted = false;
    ma.forEach((value, index) => {
      if (value == null) return;
      const x = xAt(index);
      const y = yAt(value);
      if (!maStarted) {
        ctx.moveTo(x, y);
        maStarted = true;
      } else {
        ctx.lineTo(x, y);
      }
    });
    if (maStarted) {
      ctx.strokeStyle = maColor;
      ctx.lineWidth = 1.5;
      ctx.globalAlpha = 0.92;
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    ctx.beginPath();
    chartPoints.forEach(([x, y], index) => {
      if (index === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.strokeStyle = lineColor;
    ctx.lineWidth = 2.25;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.stroke();

    renderedEvents.forEach(drawBuyMarker);

    const [lastX, lastY] = chartPoints[chartPoints.length - 1];
    ctx.fillStyle = lineColor;
    ctx.beginPath();
    ctx.arc(lastX, lastY, 3.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = labelColor;
    ctx.textAlign = "right";
    ctx.textBaseline = "bottom";
    ctx.fillText(formatAxisPrice(values[values.length - 1], currency), width - padX.right, padY.top - 6);

    if (hoverIndex == null) return;

    const point = points[hoverIndex];
    const [hx, hy] = chartPoints[hoverIndex];
    const tradesAtHover = resolvedEvents.filter((event) => event.index === hoverIndex);
    ctx.save();
    ctx.strokeStyle = labelColor;
    ctx.globalAlpha = 0.4;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(hx, padY.top);
    ctx.lineTo(hx, height - padY.bottom);
    ctx.moveTo(padX.left, hy);
    ctx.lineTo(width - padX.right, hy);
    ctx.stroke();
    ctx.restore();

    ctx.fillStyle = lineColor;
    ctx.beginPath();
    ctx.arc(hx, hy, 4.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = surfaceColor;
    ctx.stroke();

    if (tooltip) {
      const change = ((point.close - points[0].close) / points[0].close) * 100;
      const tradeBits = tradesAtHover
        .map((event) => {
          const shares = event.shares > 0 ? `${event.shares} 份` : "";
          const price = event.price > 0 ? money(event.price, currency) : "";
          const action = event.key === "sell" ? "卖出" : "买入";
          return `${action} ${[shares, price].filter(Boolean).join(" · ")}`.trim();
        })
        .filter(Boolean);
      tooltip.hidden = false;
      tooltip.innerHTML = `<strong>${money(point.close, currency)}</strong><span>${point.date}</span><span>区间 ${signed(change)}%</span>${
        ma[hoverIndex] != null ? `<span>MA${maWindow} ${money(ma[hoverIndex], currency)}</span>` : ""
      }${tradeBits.map((bit) => `<span>${bit}</span>`).join("")}`;
      const rect = canvas.getBoundingClientRect();
      const tipX = (hx / width) * rect.width;
      const tipY = (hy / height) * rect.height;
      tooltip.style.left = `${Math.min(Math.max(tipX, 18), rect.width - 18)}px`;
      tooltip.style.top = `${Math.max(tipY, 28)}px`;
    }
  };

  const hoverFromEvent = (clientX) => {
    const rect = canvas.getBoundingClientRect();
    const x = ((clientX - rect.left) / rect.width) * width;
    const ratio = (x - padX.left) / plotWidth;
    return clamp(Math.round(ratio * (values.length - 1)), 0, values.length - 1);
  };

  render(null);

  canvas.onmousemove = (event) => render(hoverFromEvent(event.clientX));
  canvas.onmouseleave = () => {
    if (tooltip) tooltip.hidden = true;
    render(null);
  };
  canvas.ontouchstart = (event) => {
    const touch = event.touches[0];
    if (touch) render(hoverFromEvent(touch.clientX));
  };
  canvas.ontouchmove = (event) => {
    const touch = event.touches[0];
    if (touch) {
      event.preventDefault();
      render(hoverFromEvent(touch.clientX));
    }
  };
  canvas.ontouchend = () => {
    if (tooltip) tooltip.hidden = true;
    render(null);
  };

  canvas._priceChartResize = () => {
    if (!document.body.contains(canvas)) {
      window.removeEventListener("resize", canvas._priceChartResize);
      return;
    }
    drawPriceChart(canvas, tooltip, points, markers, currency, error, rangeKey);
  };
  window.addEventListener("resize", canvas._priceChartResize);
}
