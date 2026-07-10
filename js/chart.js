import { CURRENCY } from "./constants.js";
import { provider, state } from "./state.js";
import { average, clamp, money, round, sameStock, signed } from "./utils.js";
import { themeChartColors } from "./navigation.js";

export async function loadAndDrawPriceChart(canvas, tooltip, summary, stock, markers) {
  if (!canvas) return;
  const payload = await provider.getHistory(stock.symbol, stock.market, state.priceRange);
  if (state.selected && !sameStock(state.selected, stock)) return;
  const points = payload.points || [];
  if (summary) {
    if (!points.length) {
      summary.textContent = payload.error ? `走势暂不可用：${payload.error}` : "暂无历史价格";
    } else {
      const first = points[0].close;
      const last = points[points.length - 1].close;
      const changePct = first ? ((last - first) / first) * 100 : 0;
      const high = Math.max(...points.map((point) => point.close));
      const low = Math.min(...points.map((point) => point.close));
      summary.textContent = `${points[0].date} → ${points[points.length - 1].date} · 区间 ${signed(changePct)}% · 高 ${money(high, stock.currency)} · 低 ${money(low, stock.currency)}${payload.provider ? ` · ${payload.provider}` : ""}`;
    }
  }
  drawPriceChart(canvas, tooltip, points, markers, stock.currency, payload.error);
}

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

export function drawPriceChart(canvas, tooltip, points, markers, currency, error) {
  const { ctx, width, height } = setupHiDpiCanvas(canvas, 360);
  const colors = themeChartColors();
  const lineColor = resolveCssColor("--chart-line", colors.line);
  const maColor = resolveCssColor("--blue", colors.label);
  const labelColor = resolveCssColor("--chart-label", colors.label);
  const gridColor = resolveCssColor("--chart-grid", colors.grid);
  const inkColor = resolveCssColor("--ink", "#222");
  const surfaceColor = resolveCssColor("--surface-2", "#fff");

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
  const markerValues = markers.map((item) => item.value).filter((value) => value != null && !Number.isNaN(Number(value)));
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
    buy: resolveCssColor("--accent-strong", lineColor),
    add: resolveCssColor("--blue", maColor),
    tp: resolveCssColor("--warn", "#c48a1a"),
    sl: resolveCssColor("--danger", "#c44"),
    cost: inkColor,
    fair: resolveCssColor("--accent-ink", lineColor),
  };

  const xAt = (index) => padX.left + (plotWidth / Math.max(values.length - 1, 1)) * index;
  const yAt = (value) => padY.top + ((scale.max - value) / (scale.max - scale.min || 1)) * plotHeight;
  const chartPoints = values.map((value, index) => [xAt(index), yAt(value)]);

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
        formatChartDate(date, state.priceRange === "1m" || state.priceRange === "3m"),
        x,
        height - padY.bottom + 10,
      );
    });

    const labelSlots = [];
    markers.forEach((marker) => {
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
      tooltip.hidden = false;
      tooltip.innerHTML = `<strong>${money(point.close, currency)}</strong><span>${point.date}</span><span>区间 ${signed(change)}%</span>${
        ma[hoverIndex] != null ? `<span>MA${maWindow} ${money(ma[hoverIndex], currency)}</span>` : ""
      }`;
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
    drawPriceChart(canvas, tooltip, points, markers, currency, error);
  };
  window.addEventListener("resize", canvas._priceChartResize);
}
export function drawMetricChart(canvas, financials, metric) {
  const ctx = canvas.getContext("2d");
  const width = canvas.width;
  const height = canvas.height;
  const colors = themeChartColors();
  const values = financials.map((item) => item[metric]);
  const isPercent = metric === "gross_margin" || metric === "debt_ratio";
  ctx.clearRect(0, 0, width, height);
  const pad = 24;
  const min = Math.min(...values) * (isPercent ? 0.92 : 0.94);
  const max = Math.max(...values) * (isPercent ? 1.08 : 1.06);
  const range = max - min || 1;

  ctx.strokeStyle = colors.grid;
  ctx.lineWidth = 1;
  for (let i = 0; i < 4; i += 1) {
    const y = pad + ((height - pad * 2) / 3) * i;
    ctx.beginPath();
    ctx.moveTo(pad, y);
    ctx.lineTo(width - pad, y);
    ctx.stroke();
  }

  const points = values.map((value, index) => {
    const x = pad + ((width - pad * 2) / Math.max(values.length - 1, 1)) * index;
    const y = height - pad - ((value - min) / range) * (height - pad * 2);
    return [x, y];
  });

  ctx.strokeStyle = colors.line;
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  points.forEach(([x, y], index) => {
    if (index === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();

  ctx.fillStyle = colors.line;
  ctx.font = "11px system-ui";
  points.forEach(([x, y], index) => {
    ctx.beginPath();
    ctx.arc(x, y, 3.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = colors.label;
    ctx.fillText(String(financials[index].period).replace("202", "'2"), x - 16, height - 6);
    ctx.fillStyle = colors.line;
  });
}

