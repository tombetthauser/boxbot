/**
 * Cut-plan geometry, SVG diagrams, and PDF export for BoxBot.
 * Attaches to window.CutPlans (plain script, no modules).
 */
(function (global) {
  "use strict";

  const EPS = 1e-9;

  function intersectRects(a, b) {
    const x = Math.max(a.x, b.x);
    const y = Math.max(a.y, b.y);
    const r = Math.min(a.x + a.w, b.x + b.w);
    const bot = Math.min(a.y + a.h, b.y + b.h);
    const w = r - x;
    const h = bot - y;
    if (w <= EPS || h <= EPS) return null;
    return { x, y, w, h };
  }

  /**
   * Clip an axis-aligned or arbitrary segment to a rect (Liang–Barsky).
   * Returns {x1,y1,x2,y2} or null if no overlap.
   */
  function clipSegmentToRect(x1, y1, x2, y2, rect) {
    const xmin = rect.x;
    const ymin = rect.y;
    const xmax = rect.x + rect.w;
    const ymax = rect.y + rect.h;

    let dx = x2 - x1;
    let dy = y2 - y1;
    let t0 = 0;
    let t1 = 1;

    function clip(p, q) {
      if (Math.abs(p) < EPS) {
        return q >= -EPS;
      }
      const r = q / p;
      if (p < 0) {
        if (r > t1) return false;
        if (r > t0) t0 = r;
      } else {
        if (r < t0) return false;
        if (r < t1) t1 = r;
      }
      return true;
    }

    if (
      !clip(-dx, x1 - xmin) ||
      !clip(dx, xmax - x1) ||
      !clip(-dy, y1 - ymin) ||
      !clip(dy, ymax - y1)
    ) {
      return null;
    }

    if (t1 < t0) return null;

    return {
      x1: x1 + t0 * dx,
      y1: y1 + t0 * dy,
      x2: x1 + t1 * dx,
      y2: y1 + t1 * dy,
    };
  }

  function patternPanels(outerW, outerH, wallDepth) {
    const d = wallDepth;
    return [
      { name: "center", x: d, y: d, w: outerW, h: outerH },
      { name: "top", x: d, y: 0, w: outerW, h: d },
      { name: "bottom", x: d, y: d + outerH, w: outerW, h: d },
      { name: "left", x: 0, y: d, w: d, h: outerH },
      { name: "right", x: d + outerW, y: d, w: d, h: outerH },
    ].filter((p) => p.w > EPS && p.h > EPS);
  }

  function patternFoldSegments(outerW, outerH, wallDepth) {
    const d = wallDepth;
    const x0 = d;
    const y0 = d;
    const x1 = d + outerW;
    const y1 = d + outerH;
    return [
      { x1: x0, y1: y0, x2: x1, y2: y0 }, // top edge of center
      { x1: x0, y1: y1, x2: x1, y2: y1 }, // bottom
      { x1: x0, y1: y0, x2: x0, y2: y1 }, // left
      { x1: x1, y1: y0, x2: x1, y2: y1 }, // right
    ];
  }

  /** Clip pattern panels/folds to a sheet; result in sheet-local coords. */
  function sheetLocalGeometry(sheet, outerW, outerH, wallDepth) {
    const sheetRect = { x: sheet.x, y: sheet.y, w: sheet.w, h: sheet.h };
    const panels = [];
    for (const panel of patternPanels(outerW, outerH, wallDepth)) {
      const hit = intersectRects(panel, sheetRect);
      if (!hit) continue;
      panels.push({
        name: panel.name,
        x: hit.x - sheet.x,
        y: hit.y - sheet.y,
        w: hit.w,
        h: hit.h,
        area: hit.w * hit.h,
      });
    }

    const folds = [];
    for (const seg of patternFoldSegments(outerW, outerH, wallDepth)) {
      const clipped = clipSegmentToRect(seg.x1, seg.y1, seg.x2, seg.y2, sheetRect);
      if (!clipped) continue;
      const len = Math.hypot(clipped.x2 - clipped.x1, clipped.y2 - clipped.y1);
      if (len <= EPS) continue;
      folds.push({
        x1: clipped.x1 - sheet.x,
        y1: clipped.y1 - sheet.y,
        x2: clipped.x2 - sheet.x,
        y2: clipped.y2 - sheet.y,
      });
    }

    return { panels, folds };
  }

  /** Map sheet-local point into portrait page space. */
  function toPortraitPoint(x, y, sheetW, sheetH, rotated) {
    if (!rotated) return { x, y };
    // 90° CW: (x, y) → (y, sheetW - x); page is sheetH × sheetW
    return { x: y, y: sheetW - x };
  }

  function rectToPortrait(rect, sheetW, sheetH, rotated) {
    if (!rotated) {
      return { x: rect.x, y: rect.y, w: rect.w, h: rect.h, name: rect.name };
    }
    const corners = [
      toPortraitPoint(rect.x, rect.y, sheetW, sheetH, true),
      toPortraitPoint(rect.x + rect.w, rect.y, sheetW, sheetH, true),
      toPortraitPoint(rect.x + rect.w, rect.y + rect.h, sheetW, sheetH, true),
      toPortraitPoint(rect.x, rect.y + rect.h, sheetW, sheetH, true),
    ];
    const xs = corners.map((c) => c.x);
    const ys = corners.map((c) => c.y);
    const x = Math.min(...xs);
    const y = Math.min(...ys);
    return {
      x,
      y,
      w: Math.max(...xs) - x,
      h: Math.max(...ys) - y,
      name: rect.name,
    };
  }

  function foldToPortrait(fold, sheetW, sheetH, rotated) {
    const a = toPortraitPoint(fold.x1, fold.y1, sheetW, sheetH, rotated);
    const b = toPortraitPoint(fold.x2, fold.y2, sheetW, sheetH, rotated);
    return { x1: a.x, y1: a.y, x2: b.x, y2: b.y };
  }

  function sheetToPortraitPlan(sheet, local) {
    const rotated = sheet.w > sheet.h + EPS;
    const pageW = rotated ? sheet.h : sheet.w;
    const pageH = rotated ? sheet.w : sheet.h;
    return {
      sheetW: pageW,
      sheetH: pageH,
      rotated,
      panels: local.panels.map((p) => rectToPortrait(p, sheet.w, sheet.h, rotated)),
      folds: local.folds.map((f) => foldToPortrait(f, sheet.w, sheet.h, rotated)),
    };
  }

  const PANEL_LABELS = {
    center: "center panel",
    top: "top flap",
    bottom: "bottom flap",
    left: "left flap",
    right: "right flap",
  };

  /**
   * Plain-language sentence describing what this sheet is for on the Base or Lid.
   */
  function describeSheetUse(part, panels) {
    const box = part === "Lid" ? "lid" : "base";
    const floorWord = part === "Lid" ? "top" : "floor";

    if (!panels.length) {
      return `This sheet does not overlap the ${box} cutting pattern.`;
    }

    const names = new Set(panels.map((p) => p.name));
    const has = (n) => names.has(n);
    const full =
      has("center") && has("top") && has("bottom") && has("left") && has("right");

    if (full) {
      return (
        `Use this sheet for the complete box ${box}: the ${floorWord} panel plus all four side flaps. ` +
        `Cut on solid lines and crease on dashed fold lines.`
      );
    }

    const flaps = ["top", "bottom", "left", "right"].filter(has);
    const flapLabels = flaps.map((n) => PANEL_LABELS[n]);

    if (has("center") && flaps.length === 0) {
      return (
        `This sheet cuts the ${floorWord} of the box ${box} only. ` +
        `It does not include side wall flaps.`
      );
    }

    if (!has("center") && flaps.length === 1) {
      return (
        `This sheet cuts the ${flapLabels[0]} of the box ${box} — ` +
        `a side wall that folds up from the ${floorWord}.`
      );
    }

    if (!has("center") && flaps.length > 1) {
      return (
        `This sheet cuts ${joinAnd(flapLabels)} of the box ${box}. ` +
        `These pieces fold up as side walls from the ${floorWord}.`
      );
    }

    if (has("center") && flaps.length === 1) {
      return (
        `This sheet forms the ${floorWord} of the box ${box} together with the ${flapLabels[0]}. ` +
        `Crease the dashed line so the flap folds up as a wall.`
      );
    }

    if (has("center") && flaps.length > 1) {
      return (
        `This sheet forms the ${floorWord} of the box ${box} plus ${joinAnd(flapLabels)}. ` +
        `Cut on solid lines and crease on dashed lines to fold the walls up.`
      );
    }

    return `This sheet is part of the box ${box} cutting pattern.`;
  }

  function joinAnd(items) {
    if (items.length <= 1) return items[0] || "";
    if (items.length === 2) return `${items[0]} and ${items[1]}`;
    return `${items.slice(0, -1).join(", ")}, and ${items[items.length - 1]}`;
  }

  function wrapText(text, maxChars) {
    const words = String(text).split(/\s+/).filter(Boolean);
    const lines = [];
    let line = "";
    for (const word of words) {
      const next = line ? `${line} ${word}` : word;
      if (next.length > maxChars && line) {
        lines.push(line);
        line = word;
      } else {
        line = next;
      }
    }
    if (line) lines.push(line);
    return lines;
  }

  function escapeXml(str) {
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function foldLength(f) {
    return Math.hypot(f.x2 - f.x1, f.y2 - f.y1);
  }

  const EDGE_EPS = 1e-6;
  const BREAK_ROUND = 1e4;
  const MIN_DIM_SEG = 0.05;

  function nearEdge(a, b) {
    return Math.abs(a - b) <= EDGE_EPS;
  }

  function normalizeBreaks(values, max) {
    const sorted = [...values]
      .map((v) => Math.round(v * BREAK_ROUND) / BREAK_ROUND)
      .filter((v) => v >= -EDGE_EPS && v <= max + EDGE_EPS)
      .map((v) => Math.max(0, Math.min(max, v)))
      .sort((a, b) => a - b);

    const out = [];
    for (const v of sorted) {
      if (!out.length || Math.abs(v - out[out.length - 1]) > EDGE_EPS) {
        out.push(v);
      }
    }
    if (!out.length || out[0] > EDGE_EPS) out.unshift(0);
    else out[0] = 0;
    if (Math.abs(out[out.length - 1] - max) > EDGE_EPS) out.push(max);
    else out[out.length - 1] = max;
    return out;
  }

  /**
   * Collect span break positions along each outer sheet edge.
   * Coordinates are in portrait sheet space (0..sheetW, 0..sheetH).
   * Top/bottom breaks are X positions; left/right breaks are Y positions.
   */
  function collectEdgeBreaks(sheetW, sheetH, panels, folds) {
    const top = [0, sheetW];
    const bottom = [0, sheetW];
    const left = [0, sheetH];
    const right = [0, sheetH];

    function considerPoint(x, y) {
      if (nearEdge(y, 0)) top.push(x);
      if (nearEdge(y, sheetH)) bottom.push(x);
      if (nearEdge(x, 0)) left.push(y);
      if (nearEdge(x, sheetW)) right.push(y);
    }

    for (const p of panels) {
      considerPoint(p.x, p.y);
      considerPoint(p.x + p.w, p.y);
      considerPoint(p.x + p.w, p.y + p.h);
      considerPoint(p.x, p.y + p.h);

      // Panel edges colinear with the sheet perimeter
      if (nearEdge(p.y, 0)) {
        top.push(p.x, p.x + p.w);
      }
      if (nearEdge(p.y + p.h, sheetH)) {
        bottom.push(p.x, p.x + p.w);
      }
      if (nearEdge(p.x, 0)) {
        left.push(p.y, p.y + p.h);
      }
      if (nearEdge(p.x + p.w, sheetW)) {
        right.push(p.y, p.y + p.h);
      }
    }

    for (const f of folds) {
      considerPoint(f.x1, f.y1);
      considerPoint(f.x2, f.y2);
    }

    return {
      top: normalizeBreaks(top, sheetW),
      bottom: normalizeBreaks(bottom, sheetW),
      left: normalizeBreaks(left, sheetH),
      right: normalizeBreaks(right, sheetH),
    };
  }

  function fontFamily() {
    return "ui-sans-serif,system-ui,sans-serif";
  }

  /** Draw ticks + length labels for consecutive breaks along one edge. */
  function appendEdgeDimChain(parts, breaks, opts) {
    const {
      ox,
      oy,
      scale,
      fmt,
      horizontal,
      chainOffset,
      tickLen,
      fontSize,
    } = opts;

    for (let i = 0; i < breaks.length - 1; i += 1) {
      const a = breaks[i];
      const b = breaks[i + 1];
      const seg = b - a;
      if (seg <= MIN_DIM_SEG) continue;

      if (horizontal) {
        const x1 = ox + a * scale;
        const x2 = ox + b * scale;
        const y = oy + chainOffset;
        parts.push(
          `<line x1="${x1}" y1="${y - tickLen / 2}" x2="${x1}" y2="${y + tickLen / 2}" ` +
            `stroke="#111" stroke-width="0.014"/>`
        );
        parts.push(
          `<line x1="${x2}" y1="${y - tickLen / 2}" x2="${x2}" y2="${y + tickLen / 2}" ` +
            `stroke="#111" stroke-width="0.014"/>`
        );
        parts.push(
          `<line x1="${x1}" y1="${y}" x2="${x2}" y2="${y}" stroke="#111" stroke-width="0.012"/>`
        );
        parts.push(
          `<text x="${(x1 + x2) / 2}" y="${y + (chainOffset >= 0 ? 0.16 : -0.08)}" ` +
            `font-family="${fontFamily()}" font-size="${fontSize}" fill="#111" ` +
            `text-anchor="middle" dominant-baseline="middle">${escapeXml(fmt(seg))}</text>`
        );
      } else {
        const y1 = oy + a * scale;
        const y2 = oy + b * scale;
        const x = ox + chainOffset;
        parts.push(
          `<line x1="${x - tickLen / 2}" y1="${y1}" x2="${x + tickLen / 2}" y2="${y1}" ` +
            `stroke="#111" stroke-width="0.014"/>`
        );
        parts.push(
          `<line x1="${x - tickLen / 2}" y1="${y2}" x2="${x + tickLen / 2}" y2="${y2}" ` +
            `stroke="#111" stroke-width="0.014"/>`
        );
        parts.push(
          `<line x1="${x}" y1="${y1}" x2="${x}" y2="${y2}" stroke="#111" stroke-width="0.012"/>`
        );
        const cx = x + (chainOffset >= 0 ? 0.16 : -0.16);
        const cy = (y1 + y2) / 2;
        parts.push(
          `<text x="${cx}" y="${cy}" font-family="${fontFamily()}" font-size="${fontSize}" ` +
            `fill="#111" text-anchor="middle" dominant-baseline="middle" ` +
            `transform="rotate(-90 ${cx} ${cy})">${escapeXml(fmt(seg))}</text>`
        );
      }
    }
  }

  function pointOnSheetPerimeter(x, y, sheetW, sheetH) {
    return (
      nearEdge(x, 0) ||
      nearEdge(x, sheetW) ||
      nearEdge(y, 0) ||
      nearEdge(y, sheetH)
    );
  }

  function roundCoord(v) {
    return Math.round(v * 1e6) / 1e6;
  }

  function isHorizontalSeg(s) {
    return Math.abs(s.y1 - s.y2) <= EDGE_EPS;
  }

  function isVerticalSeg(s) {
    return Math.abs(s.x1 - s.x2) <= EDGE_EPS;
  }

  /** True if the whole segment lies on the sheet outer edge. */
  function segmentOnSheetPerimeter(s, sheetW, sheetH) {
    if (isHorizontalSeg(s)) {
      const y = (s.y1 + s.y2) / 2;
      return nearEdge(y, 0) || nearEdge(y, sheetH);
    }
    if (isVerticalSeg(s)) {
      const x = (s.x1 + s.x2) / 2;
      return nearEdge(x, 0) || nearEdge(x, sheetW);
    }
    return false;
  }

  function panelEdgeSegments(panel) {
    const x0 = panel.x;
    const y0 = panel.y;
    const x1 = panel.x + panel.w;
    const y1 = panel.y + panel.h;
    return [
      { x1: x0, y1: y0, x2: x1, y2: y0 },
      { x1: x0, y1: y1, x2: x1, y2: y1 },
      { x1: x0, y1: y0, x2: x0, y2: y1 },
      { x1: x1, y1: y0, x2: x1, y2: y1 },
    ];
  }

  function lineKeyForSeg(s) {
    if (isHorizontalSeg(s)) return `h:${roundCoord((s.y1 + s.y2) / 2)}`;
    if (isVerticalSeg(s)) return `v:${roundCoord((s.x1 + s.x2) / 2)}`;
    return null;
  }

  function segInterval(s) {
    if (isHorizontalSeg(s)) {
      return [Math.min(s.x1, s.x2), Math.max(s.x1, s.x2)];
    }
    return [Math.min(s.y1, s.y2), Math.max(s.y1, s.y2)];
  }

  function mergeIntervals(intervals) {
    if (!intervals.length) return [];
    const sorted = intervals
      .map(([a, b]) => [Math.min(a, b), Math.max(a, b)])
      .filter(([a, b]) => b - a > EDGE_EPS)
      .sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    if (!sorted.length) return [];
    const out = [sorted[0].slice()];
    for (let i = 1; i < sorted.length; i++) {
      const cur = sorted[i];
      const last = out[out.length - 1];
      if (cur[0] <= last[1] + EDGE_EPS) {
        last[1] = Math.max(last[1], cur[1]);
      } else {
        out.push(cur.slice());
      }
    }
    return out;
  }

  function subtractIntervals(base, cutters) {
    let remaining = mergeIntervals(base);
    const cuts = mergeIntervals(cutters);
    for (const [c0, c1] of cuts) {
      const next = [];
      for (const [a0, a1] of remaining) {
        if (c1 <= a0 + EDGE_EPS || c0 >= a1 - EDGE_EPS) {
          next.push([a0, a1]);
          continue;
        }
        if (a0 < c0 - EDGE_EPS) next.push([a0, Math.min(a1, c0)]);
        if (a1 > c1 + EDGE_EPS) next.push([Math.max(a0, c1), a1]);
      }
      remaining = next;
    }
    return mergeIntervals(remaining);
  }

  function intervalsToSegs(lineKey, intervals) {
    const segs = [];
    if (lineKey.startsWith("h:")) {
      const y = Number(lineKey.slice(2));
      for (const [a, b] of intervals) {
        if (b - a > EDGE_EPS) segs.push({ x1: a, y1: y, x2: b, y2: y });
      }
    } else if (lineKey.startsWith("v:")) {
      const x = Number(lineKey.slice(2));
      for (const [a, b] of intervals) {
        if (b - a > EDGE_EPS) segs.push({ x1: x, y1: a, x2: x, y2: b });
      }
    }
    return segs;
  }

  /**
   * Unique solid cut segments: panel edges minus fold lines and sheet perimeter.
   * Prevents doubled borders and solid strokes covering dashed folds.
   */
  function collectSolidCutSegments(panels, folds, sheetW, sheetH) {
    const panelByLine = new Map();
    const foldByLine = new Map();

    function add(map, seg) {
      const key = lineKeyForSeg(seg);
      if (!key) return;
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(segInterval(seg));
    }

    for (const panel of panels) {
      for (const edge of panelEdgeSegments(panel)) {
        if (segmentOnSheetPerimeter(edge, sheetW, sheetH)) continue;
        add(panelByLine, edge);
      }
    }

    for (const fold of folds) {
      add(foldByLine, fold);
    }

    const solids = [];
    for (const [key, intervals] of panelByLine) {
      const withoutFolds = subtractIntervals(intervals, foldByLine.get(key) || []);
      solids.push(...intervalsToSegs(key, withoutFolds));
    }
    return solids;
  }

  /** Folds drawn as dashed; skip those on the sheet perimeter (border is the cut). */
  function collectVisibleFolds(folds, sheetW, sheetH) {
    const byLine = new Map();
    for (const fold of folds) {
      if (segmentOnSheetPerimeter(fold, sheetW, sheetH)) continue;
      const key = lineKeyForSeg(fold);
      if (!key) continue;
      if (!byLine.has(key)) byLine.set(key, []);
      byLine.get(key).push(segInterval(fold));
    }
    const out = [];
    for (const [key, intervals] of byLine) {
      out.push(...intervalsToSegs(key, mergeIntervals(intervals)));
    }
    return out;
  }

  function buildSheetCutPlanSvg(plan, formatInches) {
    const fmt = typeof formatInches === "function" ? formatInches : (v) => String(v);
    const PAGE_W = 8.5;
    const PAGE_H = 11;
    const sheetW = plan.sheetW;
    const sheetH = plan.sheetH;

    const marginX = 0.4;
    const marginTop = 0.28;
    const marginBottom = 0.32;
    const headerH = 1.05;
    const gutter = 0.52;
    const tickLen = 0.07;
    const cutStroke = 0.016;
    const borderStroke = 0.022;
    const foldStroke = 0.018;
    const titleSize = 0.2;
    const roleSize = 0.145;
    const dimSize = 0.135;
    const letterSize = 0.28;
    const foldLabelSize = 0.12;

    const descLines = wrapText(plan.role || "", 78);
    const availTop = marginTop + headerH;
    const availW = PAGE_W - marginX * 2;
    const availH = PAGE_H - availTop - marginBottom;
    const scale = Math.max(
      0.05,
      Math.min((availW - 2 * gutter) / sheetW, (availH - 2 * gutter) / sheetH)
    );
    const drawW = sheetW * scale;
    const drawH = sheetH * scale;
    const contentW = drawW + 2 * gutter;
    const contentH = drawH + 2 * gutter;
    const contentX = marginX + (availW - contentW) / 2;
    const contentY = availTop + (availH - contentH) / 2;
    const ox = contentX + gutter;
    const oy = contentY + gutter;

    const breaks = collectEdgeBreaks(sheetW, sheetH, plan.panels, plan.folds);
    const parts = [];

    parts.push(
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${PAGE_W} ${PAGE_H}" ` +
        `width="100%" height="100%" style="background:#fff;display:block;">`
    );
    parts.push(`<rect x="0" y="0" width="${PAGE_W}" height="${PAGE_H}" fill="#fff"/>`);

    // Header
    parts.push(
      `<text x="${marginX}" y="${marginTop + 0.18}" font-family="${fontFamily()}" ` +
        `font-size="${titleSize}" font-weight="700" fill="#111">` +
        `${escapeXml(`Box ${plan.part} — Sheet ${plan.letter}`)}</text>`
    );
    descLines.slice(0, 4).forEach((line, i) => {
      parts.push(
        `<text x="${marginX}" y="${marginTop + 0.42 + i * 0.17}" font-family="${fontFamily()}" ` +
          `font-size="${roleSize}" fill="#222">${escapeXml(line)}</text>`
      );
    });

    // Double outer border: black outside, red inside, edges touching (no gap)
    parts.push(
      `<rect x="${ox - borderStroke}" y="${oy - borderStroke}" ` +
        `width="${drawW + borderStroke * 2}" height="${drawH + borderStroke * 2}" ` +
        `fill="none" stroke="#000" stroke-width="${borderStroke}"/>`
    );
    parts.push(
      `<rect x="${ox}" y="${oy}" width="${drawW}" height="${drawH}" ` +
        `fill="none" stroke="#c00" stroke-width="${borderStroke}"/>`
    );

    // Corner letter badge
    parts.push(
      `<text x="${ox + 0.18}" y="${oy + 0.34}" font-family="${fontFamily()}" ` +
        `font-size="${letterSize}" font-weight="700" fill="#111">${escapeXml(plan.letter)}</text>`
    );

    const solidCuts = collectSolidCutSegments(
      plan.panels,
      plan.folds,
      sheetW,
      sheetH
    );
    const visibleFolds = collectVisibleFolds(plan.folds, sheetW, sheetH);

    // Interior cut edges only (no perimeter — outer border covers that;
    // no fold edges — dashed lines cover those)
    for (const s of solidCuts) {
      parts.push(
        `<line x1="${ox + s.x1 * scale}" y1="${oy + s.y1 * scale}" ` +
          `x2="${ox + s.x2 * scale}" y2="${oy + s.y2 * scale}" ` +
          `stroke="#000" stroke-width="${cutStroke}" stroke-linecap="butt"/>`
      );
    }

    // Fold lines — dashed only, never under a solid stroke
    for (const f of visibleFolds) {
      parts.push(
        `<line x1="${ox + f.x1 * scale}" y1="${oy + f.y1 * scale}" ` +
          `x2="${ox + f.x2 * scale}" y2="${oy + f.y2 * scale}" ` +
          `stroke="#111" stroke-width="${foldStroke}" stroke-linecap="butt" ` +
          `stroke-dasharray="0.14 0.09"/>`
      );
    }

    // Edge dimension chains
    appendEdgeDimChain(parts, breaks.top, {
      ox,
      oy,
      scale,
      fmt,
      horizontal: true,
      chainOffset: -gutter * 0.55,
      tickLen,
      fontSize: dimSize,
    });
    appendEdgeDimChain(parts, breaks.bottom, {
      ox,
      oy: oy + drawH,
      scale,
      fmt,
      horizontal: true,
      chainOffset: gutter * 0.55,
      tickLen,
      fontSize: dimSize,
    });
    appendEdgeDimChain(parts, breaks.left, {
      ox,
      oy,
      scale,
      fmt,
      horizontal: false,
      chainOffset: -gutter * 0.55,
      tickLen,
      fontSize: dimSize,
    });
    appendEdgeDimChain(parts, breaks.right, {
      ox: ox + drawW,
      oy,
      scale,
      fmt,
      horizontal: false,
      chainOffset: gutter * 0.55,
      tickLen,
      fontSize: dimSize,
    });

    // Interior fold length labels
    for (const f of plan.folds) {
      const len = foldLength(f);
      if (len < 0.75) continue;
      const mx = (f.x1 + f.x2) / 2;
      const my = (f.y1 + f.y2) / 2;
      if (pointOnSheetPerimeter(mx, my, sheetW, sheetH)) continue;
      const nearEdgeBand = 0.35;
      if (
        mx < nearEdgeBand ||
        my < nearEdgeBand ||
        mx > sheetW - nearEdgeBand ||
        my > sheetH - nearEdgeBand
      ) {
        continue;
      }
      const horiz = Math.abs(f.y2 - f.y1) < EPS;
      const lx = ox + mx * scale + (horiz ? 0 : 0.1);
      const ly = oy + my * scale + (horiz ? -0.1 : 0);
      parts.push(
        `<text x="${lx}" y="${ly}" font-family="${fontFamily()}" font-size="${foldLabelSize}" ` +
          `fill="#222" text-anchor="middle" dominant-baseline="middle">` +
          `${escapeXml(fmt(len))}</text>`
      );
    }

    parts.push("</svg>");
    return parts.join("");
  }

  function sheetSortKey(a, b) {
    if (Math.abs(a.y - b.y) > EPS) return a.y - b.y;
    return a.x - b.x;
  }

  function letterForIndex(i) {
    // A..Z, then AA, AB, ...
    let n = i;
    let s = "";
    do {
      s = String.fromCharCode(65 + (n % 26)) + s;
      n = Math.floor(n / 26) - 1;
    } while (n >= 0);
    return s;
  }

  /**
   * Build cut plans for one part (Base or Lid).
   * sheets: [{x,y,w,h,orientation}, ...] in pattern space.
   * letterOffset: continue A,B,C… across Base then Lid (default 0).
   */
  function buildCutPlansForPart({
    part,
    sheets,
    outerW,
    outerH,
    wallDepth,
    patternW,
    patternH,
    formatInches,
    letterOffset = 0,
  }) {
    void patternW;
    void patternH;
    const sorted = [...sheets].sort(sheetSortKey);
    const plans = [];
    const offset = Number(letterOffset) || 0;

    sorted.forEach((sheet, i) => {
      const local = sheetLocalGeometry(sheet, outerW, outerH, wallDepth);
      const portrait = sheetToPortraitPlan(sheet, local);
      const letter = letterForIndex(i + offset);
      const role = describeSheetUse(part, local.panels);
      const plan = {
        letter,
        part,
        role,
        sheetW: portrait.sheetW,
        sheetH: portrait.sheetH,
        panels: portrait.panels.map(({ x, y, w, h, name }) => ({ x, y, w, h, name })),
        folds: portrait.folds,
        orientation: sheet.orientation,
        rotated: portrait.rotated,
      };
      plan.svg = buildSheetCutPlanSvg(plan, formatInches);
      plans.push(plan);
    });

    return plans;
  }

  function loadJsPdf() {
    if (global.jspdf && global.jspdf.jsPDF) {
      return Promise.resolve(global.jspdf.jsPDF);
    }
    return new Promise((resolve, reject) => {
      const existing = document.querySelector("script[data-boxbot-jspdf]");
      if (existing) {
        existing.addEventListener("load", () => resolve(global.jspdf.jsPDF));
        existing.addEventListener("error", () => reject(new Error("jsPDF failed to load")));
        return;
      }
      const script = document.createElement("script");
      script.src = "https://cdn.jsdelivr.net/npm/jspdf@2.5.2/dist/jspdf.umd.min.js";
      script.dataset.boxbotJspdf = "1";
      script.onload = () => {
        if (global.jspdf && global.jspdf.jsPDF) resolve(global.jspdf.jsPDF);
        else reject(new Error("jsPDF loaded but jsPDF export missing"));
      };
      script.onerror = () => reject(new Error("jsPDF failed to load"));
      document.head.appendChild(script);
    });
  }

  function svgToPngDataUrl(svgString, widthPx, heightPx) {
    return new Promise((resolve, reject) => {
      const w = Math.max(1, Math.round(widthPx));
      const h = Math.max(1, Math.round(heightPx));
      // Hard cap to avoid allocation overflows on large sheets.
      const maxEdge = 2400;
      const scale = Math.min(1, maxEdge / Math.max(w, h));
      const cw = Math.max(1, Math.round(w * scale));
      const ch = Math.max(1, Math.round(h * scale));

      const blob = new Blob([svgString], { type: "image/svg+xml;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement("canvas");
        canvas.width = cw;
        canvas.height = ch;
        const ctx = canvas.getContext("2d");
        ctx.fillStyle = "#fff";
        ctx.fillRect(0, 0, cw, ch);
        ctx.drawImage(img, 0, 0, cw, ch);
        URL.revokeObjectURL(url);
        try {
          resolve(canvas.toDataURL("image/jpeg", 0.92));
        } catch (err) {
          reject(err);
        }
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error("Failed to rasterize SVG"));
      };
      img.src = url;
    });
  }

  function buildPrintHtml(allPlans) {
    const pages = allPlans.map((plan) => `<div class="page">${plan.svg}</div>`).join("\n");
    return `<!DOCTYPE html>
<html><head><meta charset="utf-8"/><title>BoxBot Cut Plans</title>
<style>
  @page { margin: 0; size: letter portrait; }
  html, body { margin: 0; padding: 0; background: #fff; }
  body { font-family: ui-sans-serif, system-ui, sans-serif; }
  .page {
    page-break-after: always;
    break-after: page;
    width: 8.5in;
    height: 11in;
    margin: 0;
    padding: 0;
    box-sizing: border-box;
    overflow: hidden;
  }
  .page:last-child { page-break-after: auto; }
  .page svg { width: 8.5in; height: 11in; display: block; }
</style></head><body>${pages}</body></html>`;
  }

  /** Print via a hidden iframe (no popup window). */
  function openCutPlansPrintDocument(allPlans) {
    const html = buildPrintHtml(allPlans);
    const iframe = document.createElement("iframe");
    iframe.setAttribute("aria-hidden", "true");
    iframe.style.cssText =
      "position:fixed;right:0;bottom:0;width:0;height:0;border:0;opacity:0;pointer-events:none;";
    document.body.appendChild(iframe);

    const idoc = iframe.contentDocument || iframe.contentWindow.document;
    idoc.open();
    idoc.write(html);
    idoc.close();

    const cleanup = () => {
      setTimeout(() => {
        if (iframe.parentNode) iframe.parentNode.removeChild(iframe);
      }, 1000);
    };

    const triggerPrint = () => {
      try {
        iframe.contentWindow.focus();
        iframe.contentWindow.print();
      } finally {
        cleanup();
      }
    };

    // Give layout/engines a tick to paint SVGs before printing.
    setTimeout(triggerPrint, 250);
  }

  /**
   * Download a multi-page PDF (one letter page per plan).
   * Letter-sized SVGs are rasterized nearly 1:1; labels remain actual inches.
   * Falls back to iframe print (no popup) if jsPDF/rasterization fails.
   */
  async function downloadCutPlansPdf(allPlans) {
    if (!allPlans || !allPlans.length) {
      throw new Error("No cut plans to export");
    }

    const paperW = 8.5;
    const paperH = 11;

    try {
      const JsPDF = await loadJsPdf();
      let doc = null;
      const dpi = 150;

      for (let i = 0; i < allPlans.length; i += 1) {
        const plan = allPlans[i];
        const scaleNote =
          `Box ${plan.part} — Sheet ${plan.letter}  ·  ` +
          `Reference diagram — labeled measurements are actual inches`;

        // SVG viewBox is already 8.5×11; rasterize at page size (~1:1).
        const dataUrl = await svgToPngDataUrl(plan.svg, paperW * dpi, paperH * dpi);

        if (!doc) {
          doc = new JsPDF({
            orientation: "portrait",
            unit: "in",
            format: [paperW, paperH],
            compress: true,
          });
        } else {
          doc.addPage([paperW, paperH], "portrait");
        }

        // Full-bleed letter image, centered (already page-sized).
        const drawW = paperW;
        const drawH = paperH;
        const imgX = (paperW - drawW) / 2;
        const imgY = (paperH - drawH) / 2;
        doc.addImage(dataUrl, "JPEG", imgX, imgY, drawW, drawH, undefined, "FAST");

        doc.setFont("helvetica", "normal");
        doc.setFontSize(8);
        doc.setTextColor(60);
        doc.text(scaleNote, 0.45, 10.75);
      }

      doc.save("boxbot-cut-plans.pdf");
    } catch (err) {
      console.warn("PDF download failed, opening print dialog instead:", err);
      openCutPlansPrintDocument(allPlans);
    }
  }

  global.CutPlans = {
    intersectRects,
    clipSegmentToRect,
    patternPanels,
    patternFoldSegments,
    sheetLocalGeometry,
    sheetToPortraitPlan,
    buildSheetCutPlanSvg,
    buildCutPlansForPart,
    letterForIndex,
    downloadCutPlansPdf,
    openCutPlansPrintDocument,
  };
})(typeof window !== "undefined" ? window : globalThis);
