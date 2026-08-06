const form = document.getElementById("box-form");
const output = document.getElementById("output");
const summary = document.getElementById("output-summary");
const lockBtn = document.getElementById("sheet-lock");
const sheetWidthInput = document.getElementById("sheetWidth");
const sheetHeightInput = document.getElementById("sheetHeight");
const canvas = document.getElementById("artwork-canvas");
const ctx = canvas.getContext("2d");

const DEFAULT_SHEET_WIDTH = 48;
const DEFAULT_SHEET_HEIGHT = 96;
const SHEET_GAP_PX = 1;
const FIT_EPS = 1e-6;

/**
 * When true, leftover bands in a split (e.g. top-left above a vertical strip)
 * prefer the default/base sheet orientation when either orientation would work.
 * Set to false to restore uniform strip packing (easy undo).
 */
const PREFER_DEFAULT_ORIENTATION_IN_REMNANTS = true;

const sliderNames = ["artworkWidth", "artworkHeight", "artworkDepth"];

let sheetLocked = true;

function syncSlider(name) {
  const input = form.elements[name];
  const label = document.getElementById(`${name}-val`);
  if (input && label) {
    label.textContent = formatInches(Number(input.value));
  }
}

function setSheetLocked(locked) {
  sheetLocked = locked;
  sheetWidthInput.disabled = locked;
  sheetHeightInput.disabled = locked;
  lockBtn.setAttribute("aria-pressed", String(locked));
  lockBtn.title = locked ? "Unlock to edit sheet size" : "Lock sheet size";
  lockBtn.querySelector(".lock-icon").textContent = locked ? "🔒" : "🔓";
  lockBtn.querySelector(".lock-label").textContent = locked ? "Locked" : "Unlocked";
}

function gcdInt(a, b) {
  let x = Math.abs(a);
  let y = Math.abs(b);
  while (y) {
    const t = y;
    y = x % y;
    x = t;
  }
  return x || 1;
}

function inchFormatMode() {
  return form.elements.inchFormat?.value === "fraction" ? "fraction" : "decimal";
}

/** Snap inches to nearest 1/32 using integer thirty-seconds (exact for dyadic values). */
function toThirtySeconds(value) {
  return Math.round(Number(value) * 32);
}

function fromThirtySeconds(units) {
  return units / 32;
}

/** Snap inches to nearest 0.1 using integer tenths (avoids 0.1 float drift). */
function toTenths(value) {
  return Math.round(Number(value) * 10);
}

function fromTenths(units) {
  return units / 10;
}

/** Decimal display — same trimming as before, with inch mark. */
function formatInchesDecimal(value) {
  const n = Number(value);
  const body = Number.isInteger(n) ? String(n) : String(parseFloat(n.toFixed(2)));
  return `${body}"`;
}

/**
 * Round to nearest 1/32" and format as a reduced imperial fraction.
 * Conversion is integer-based so every k/32" round-trips exactly.
 */
function formatInchesFraction(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '0"';

  const sign = n < 0 ? "-" : "";
  const thirtySeconds = toThirtySeconds(Math.abs(n));
  const whole = Math.floor(thirtySeconds / 32);
  let numerator = thirtySeconds % 32;

  if (numerator === 0) {
    return `${sign}${whole}"`;
  }

  const g = gcdInt(numerator, 32);
  numerator /= g;
  const denominator = 32 / g;

  if (whole === 0) {
    return `${sign}${numerator}/${denominator}"`;
  }
  return `${sign}${whole} ${numerator}/${denominator}"`;
}

function formatInches(value) {
  return inchFormatMode() === "fraction"
    ? formatInchesFraction(value)
    : formatInchesDecimal(value);
}

/**
 * Nudge a dimension slider by 1/32" (fraction mode) or 0.1" (decimal mode).
 */
function nudgeDimension(name, direction) {
  const input = form.elements[name];
  if (!input) return;

  const min = Number(input.min);
  const max = Number(input.max);
  const dir = direction < 0 ? -1 : 1;
  let next;

  if (inchFormatMode() === "fraction") {
    next = fromThirtySeconds(toThirtySeconds(input.value) + dir);
  } else {
    next = fromTenths(toTenths(input.value) + dir);
  }

  next = Math.min(max, Math.max(min, next));
  input.value = String(next);
  syncSlider(name);
  drawPreview();
}

function drawDimensionLabel(x, y, label, vertical = false, color = "#111") {
  ctx.fillStyle = color;
  ctx.font = "12px ui-sans-serif, system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  if (vertical) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText(label, 0, 0);
    ctx.restore();
  } else {
    ctx.fillText(label, x, y);
  }
}

function drawDimensionLine(x1, y1, x2, y2, label, offsetX, offsetY, color = "#111") {
  const tick = 5;
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = 0.75;
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();

  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.hypot(dx, dy) || 1;
  const nx = (-dy / len) * tick;
  const ny = (dx / len) * tick;

  ctx.beginPath();
  ctx.moveTo(x1 - nx / 2, y1 - ny / 2);
  ctx.lineTo(x1 + nx / 2, y1 + ny / 2);
  ctx.moveTo(x2 - nx / 2, y2 - ny / 2);
  ctx.lineTo(x2 + nx / 2, y2 + ny / 2);
  ctx.stroke();

  drawDimensionLabel(
    (x1 + x2) / 2 + offsetX,
    (y1 + y2) / 2 + offsetY,
    label,
    Math.abs(dx) < Math.abs(dy),
    color
  );
}

function ceilDiv(size, tile) {
  return Math.max(1, Math.ceil(size / tile - FIT_EPS));
}

function makeGridSheets(x0, y0, cols, rows, tileW, tileH, orientation) {
  const sheets = [];
  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      sheets.push({
        x: x0 + c * tileW,
        y: y0 + r * tileH,
        w: tileW,
        h: tileH,
        orientation,
      });
    }
  }
  return sheets;
}

/**
 * Cover a region of at least minW × minH with a tile grid.
 * Anchored to bottom-right: right edge at `right`, bottom edge at `bottom`.
 * Extra tile hangs off the top and/or left only — keeps the pattern at BR of the sheets.
 */
function placeGridCoverBR(minW, minH, tileW, tileH, orientation, right, bottom) {
  const cols = ceilDiv(minW, tileW);
  const rows = ceilDiv(minH, tileH);
  const blockW = cols * tileW;
  const blockH = rows * tileH;
  return makeGridSheets(right - blockW, bottom - blockH, cols, rows, tileW, tileH, orientation);
}

/**
 * Fill a region in horizontal bands from the bottom up.
 * When preferDefRemnants is true, a leftover band that fits in one row of either
 * orientation uses `def`; taller spans still use the larger/perp tile first.
 * When false, fills the whole region with `primary` only (legacy strip behavior).
 */
function fillRegionBands(minW, minH, right, bottom, def, perp, primary, preferDefRemnants) {
  if (!preferDefRemnants) {
    return placeGridCoverBR(
      minW,
      minH,
      primary.w,
      primary.h,
      primary.orientation,
      right,
      bottom
    );
  }

  const sheets = [];
  let remH = minH;
  let remBottom = bottom;

  while (remH > FIT_EPS) {
    let tile;
    const fitsDef = remH <= def.h + FIT_EPS;
    const fitsPerp = remH <= perp.h + FIT_EPS;

    if (fitsDef && fitsPerp) {
      // Arbitrary single-band remnant → default orientation
      tile = def;
    } else if (fitsDef) {
      tile = def;
    } else if (fitsPerp) {
      tile = perp;
    } else {
      // Still need multiple bands: place one taller band, then re-evaluate remnant
      tile = perp.h >= def.h ? perp : def;
    }

    const cols = ceilDiv(minW, tile.w);
    sheets.push(
      ...makeGridSheets(
        right - cols * tile.w,
        remBottom - tile.h,
        cols,
        1,
        tile.w,
        tile.h,
        tile.orientation
      )
    );
    remBottom -= tile.h;
    remH -= tile.h;
  }

  return sheets;
}

function intervalsCover(intervals, start, end) {
  if (end - start <= FIT_EPS) return true;
  const sorted = intervals
    .map(([a, b]) => [Math.max(a, start), Math.min(b, end)])
    .filter(([a, b]) => b > a + FIT_EPS)
    .sort((a, b) => a[0] - b[0]);
  let coveredTo = start;
  for (const [a, b] of sorted) {
    if (a > coveredTo + FIT_EPS) return false;
    coveredTo = Math.max(coveredTo, b);
    if (coveredTo >= end - FIT_EPS) return true;
  }
  return coveredTo >= end - FIT_EPS;
}

/** True if the union of sheets fully covers [0, patternW] × [0, patternH]. */
function coversPattern(sheets, patternW, patternH) {
  const xs = new Set([0, patternW]);
  for (const sheet of sheets) {
    xs.add(Math.min(patternW, Math.max(0, sheet.x)));
    xs.add(Math.min(patternW, Math.max(0, sheet.x + sheet.w)));
  }
  const xList = [...xs].sort((a, b) => a - b);
  for (let i = 0; i < xList.length - 1; i += 1) {
    const x0 = xList[i];
    const x1 = xList[i + 1];
    if (x1 - x0 <= FIT_EPS) continue;
    const xMid = (x0 + x1) / 2;
    const yIntervals = [];
    for (const sheet of sheets) {
      if (sheet.x <= xMid + FIT_EPS && sheet.x + sheet.w >= xMid - FIT_EPS) {
        yIntervals.push([sheet.y, sheet.y + sheet.h]);
      }
    }
    if (!intervalsCover(yIntervals, 0, patternH)) return false;
  }
  return true;
}

function tileForOrientation(sheetW, sheetH, orientation) {
  return orientation === "vertical"
    ? { w: sheetW, h: sheetH, orientation: "vertical" }
    : { w: sheetH, h: sheetW, orientation: "horizontal" };
}

function pureGridLayout(patternW, patternH, tile) {
  const cols = ceilDiv(patternW, tile.w);
  const rows = ceilDiv(patternH, tile.h);
  const sheets = placeGridCoverBR(
    patternW,
    patternH,
    tile.w,
    tile.h,
    tile.orientation,
    patternW,
    patternH
  );
  return {
    sheets,
    cols,
    rows,
    tileW: tile.w,
    tileH: tile.h,
    orientation: tile.orientation,
    mixed: false,
    baseOrientation: tile.orientation,
  };
}

function chooseBaseOrientation(patternW, patternH, sheetW, sheetH, preferred, override) {
  const horizontal = tileForOrientation(sheetW, sheetH, "horizontal");
  const vertical = tileForOrientation(sheetW, sheetH, "vertical");
  const hCount = ceilDiv(patternW, horizontal.w) * ceilDiv(patternH, horizontal.h);
  const vCount = ceilDiv(patternW, vertical.w) * ceilDiv(patternH, vertical.h);

  if (override) {
    return preferred === "vertical" ? "vertical" : "horizontal";
  }
  if (vCount < hCount) return "vertical";
  return "horizontal";
}

function sheetsOverlap(a, b) {
  return (
    a.x < b.x + b.w - FIT_EPS &&
    a.x + a.w > b.x + FIT_EPS &&
    a.y < b.y + b.h - FIT_EPS &&
    a.y + a.h > b.y + FIT_EPS
  );
}

function hasSheetOverlap(sheets) {
  for (let i = 0; i < sheets.length; i += 1) {
    for (let j = i + 1; j < sheets.length; j += 1) {
      if (sheetsOverlap(sheets[i], sheets[j])) return true;
    }
  }
  return false;
}

function intervalsOverlap(a0, aSize, b0, bSize) {
  return a0 < b0 + bSize - FIT_EPS && b0 < a0 + aSize - FIT_EPS;
}

/**
 * Group sheets into rows (axis === "x") or columns (axis === "y").
 * Sheets that overlap on the perpendicular axis are one connected band, so they
 * always move together. Abutting edges do not count as overlap.
 * Row packs → one column band (uniform vertical center).
 * Column packs → one row band per height stack (safe horizontal center).
 */
function groupSheetsByOverlapBands(sheets, axis) {
  const n = sheets.length;
  const parent = Array.from({ length: n }, (_, i) => i);

  function find(i) {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]];
      i = parent[i];
    }
    return i;
  }

  function union(i, j) {
    const ri = find(i);
    const rj = find(j);
    if (ri !== rj) parent[ri] = rj;
  }

  for (let i = 0; i < n; i += 1) {
    for (let j = i + 1; j < n; j += 1) {
      const overlap =
        axis === "x"
          ? intervalsOverlap(sheets[i].y, sheets[i].h, sheets[j].y, sheets[j].h)
          : intervalsOverlap(sheets[i].x, sheets[i].w, sheets[j].x, sheets[j].w);
      if (overlap) union(i, j);
    }
  }

  const bands = new Map();
  for (let i = 0; i < n; i += 1) {
    const root = find(i);
    if (!bands.has(root)) bands.set(root, []);
    bands.get(root).push(sheets[i]);
  }
  return [...bands.values()];
}

function centerAssemblyOnAxis(sheets, axis, patternSpan) {
  const sizeKey = axis === "x" ? "w" : "h";
  let minPos = Infinity;
  let maxPos = -Infinity;
  for (const sheet of sheets) {
    minPos = Math.min(minPos, sheet[axis]);
    maxPos = Math.max(maxPos, sheet[axis] + sheet[sizeKey]);
  }
  const delta = patternSpan / 2 - (minPos + maxPos) / 2;
  if (Math.abs(delta) < FIT_EPS) return;
  for (const sheet of sheets) sheet[axis] += delta;
}

/**
 * Center each independent row on patternW (axis "x") or each independent
 * column on patternH (axis "y"). Falls back to whole-assembly centering if
 * band shifts would overlap sheets.
 */
function centerBandsOnPattern(sheets, axis, patternSpan) {
  const snapshot = sheets.map((s) => ({ x: s.x, y: s.y }));
  const bands = groupSheetsByOverlapBands(sheets, axis);
  const patternCenter = patternSpan / 2;
  const sizeKey = axis === "x" ? "w" : "h";

  for (const band of bands) {
    let minPos = Infinity;
    let maxPos = -Infinity;
    for (const sheet of band) {
      minPos = Math.min(minPos, sheet[axis]);
      maxPos = Math.max(maxPos, sheet[axis] + sheet[sizeKey]);
    }
    const delta = patternCenter - (minPos + maxPos) / 2;
    if (Math.abs(delta) < FIT_EPS) continue;
    for (const sheet of band) sheet[axis] += delta;
  }

  if (hasSheetOverlap(sheets)) {
    for (let i = 0; i < sheets.length; i += 1) {
      sheets[i].x = snapshot[i].x;
      sheets[i].y = snapshot[i].y;
    }
    centerAssemblyOnAxis(sheets, axis, patternSpan);
  }
}

/**
 * Reposition packed sheets relative to the pattern.
 * Default: bottom-right anchored.
 * centerX: center each independent sheet-row on the pattern horizontally.
 * centerY: center each independent sheet-column on the pattern vertically.
 */
function anchorSheetsToPattern(sheets, patternW, patternH, centerX, centerY) {
  if (!sheets.length) return sheets;

  const result = sheets.map((sheet) => ({ ...sheet }));

  if (centerX) {
    centerBandsOnPattern(result, "x", patternW);
  } else {
    const maxX = Math.max(...result.map((s) => s.x + s.w));
    const dx = patternW - maxX;
    if (Math.abs(dx) >= FIT_EPS) {
      for (const sheet of result) sheet.x += dx;
    }
  }

  if (centerY) {
    centerBandsOnPattern(result, "y", patternH);
  } else {
    const maxY = Math.max(...result.map((s) => s.y + s.h));
    const dy = patternH - maxY;
    if (Math.abs(dy) >= FIT_EPS) {
      for (const sheet of result) sheet.y += dy;
    }
  }

  return result;
}

/**
 * Only emits packings that fully cover the pattern with no sheet overlaps.
 * Sheets are bottom-right anchored so the cut pattern sits at the BR of the red assembly.
 */
function buildOptimizedCandidates(patternW, patternH, def, perp) {
  const candidates = [];

  function add(sheets) {
    if (!sheets.length) return;
    if (hasSheetOverlap(sheets)) return;
    if (!coversPattern(sheets, patternW, patternH)) return;
    const baseCount = sheets.filter((s) => s.orientation === def.orientation).length;
    const rightBase = sheets.some(
      (s) =>
        s.orientation === def.orientation && s.x + s.w >= patternW - FIT_EPS
    )
      ? 1
      : 0;
    candidates.push({ sheets, count: sheets.length, baseCount, rightBase });
  }

  // Pure grids in both orientations
  add(placeGridCoverBR(patternW, patternH, def.w, def.h, def.orientation, patternW, patternH));
  add(placeGridCoverBR(patternW, patternH, perp.w, perp.h, perp.orientation, patternW, patternH));

  const preferDef = PREFER_DEFAULT_ORIENTATION_IN_REMNANTS;

  // Vertical split: base columns on the right + left region (bands; remnants prefer def)
  {
    const maxDefCols = ceilDiv(patternW, def.w);
    for (let defCols = 1; defCols < maxDefCols; defCols += 1) {
      const rightW = defCols * def.w;
      const leftW = patternW - rightW;
      if (leftW <= FIT_EPS) continue;
      add([
        ...fillRegionBands(leftW, patternH, leftW, patternH, def, perp, perp, preferDef),
        ...placeGridCoverBR(rightW, patternH, def.w, def.h, def.orientation, patternW, patternH),
      ]);
    }
  }

  // Vertical split: perpendicular columns on the right + left region (bands; remnants prefer def)
  {
    const maxPerpCols = ceilDiv(patternW, perp.w);
    for (let perpCols = 1; perpCols < maxPerpCols; perpCols += 1) {
      const rightW = perpCols * perp.w;
      const leftW = patternW - rightW;
      if (leftW <= FIT_EPS) continue;
      add([
        ...fillRegionBands(leftW, patternH, leftW, patternH, def, perp, def, preferDef),
        ...placeGridCoverBR(rightW, patternH, perp.w, perp.h, perp.orientation, patternW, patternH),
      ]);
    }
  }

  // Horizontal split: base rows on the bottom + top region (bands; remnants prefer def)
  {
    const maxDefRows = ceilDiv(patternH, def.h);
    for (let defRows = 1; defRows < maxDefRows; defRows += 1) {
      const bottomH = defRows * def.h;
      const topH = patternH - bottomH;
      if (topH <= FIT_EPS) continue;
      add([
        ...fillRegionBands(patternW, topH, patternW, topH, def, perp, perp, preferDef),
        ...placeGridCoverBR(patternW, bottomH, def.w, def.h, def.orientation, patternW, patternH),
      ]);
    }
  }

  // Horizontal split: perpendicular rows on the bottom + top region (bands; remnants prefer def)
  {
    const maxPerpRows = ceilDiv(patternH, perp.h);
    for (let perpRows = 1; perpRows < maxPerpRows; perpRows += 1) {
      const bottomH = perpRows * perp.h;
      const topH = patternH - bottomH;
      if (topH <= FIT_EPS) continue;
      add([
        ...fillRegionBands(patternW, topH, patternW, topH, def, perp, def, preferDef),
        ...placeGridCoverBR(patternW, bottomH, perp.w, perp.h, perp.orientation, patternW, patternH),
      ]);
    }
  }

  if (!candidates.length) {
    const fallback = placeGridCoverBR(
      patternW,
      patternH,
      def.w,
      def.h,
      def.orientation,
      patternW,
      patternH
    );
    return { sheets: fallback, count: fallback.length, baseCount: fallback.length, rightBase: 1 };
  }

  candidates.sort(
    (a, b) =>
      a.count - b.count || b.rightBase - a.rightBase || b.baseCount - a.baseCount
  );
  return candidates[0];
}

/**
 * Pick sheets to contain the cut pattern.
 * Auto/override chooses base orientation; optional optimization replaces
 * columns/rows of base sheets with fewer perpendicular sheets when possible.
 */
function resolveSheetLayout(
  patternW,
  patternH,
  sheetW,
  sheetH,
  preferred,
  override,
  optimize
) {
  const baseOrientation = chooseBaseOrientation(
    patternW,
    patternH,
    sheetW,
    sheetH,
    preferred,
    override
  );
  const def = tileForOrientation(sheetW, sheetH, baseOrientation);
  const perp = tileForOrientation(
    sheetW,
    sheetH,
    baseOrientation === "vertical" ? "horizontal" : "vertical"
  );

  if (!optimize) {
    return pureGridLayout(patternW, patternH, def);
  }

  const best = buildOptimizedCandidates(patternW, patternH, def, perp);
  const orientations = [...new Set(best.sheets.map((s) => s.orientation))];
  const mixed = orientations.length > 1;

  // Representative tile dims: prefer a base-orientation sheet, else first sheet
  const sample =
    best.sheets.find((s) => s.orientation === def.orientation) || best.sheets[0];

  return {
    sheets: best.sheets,
    cols: mixed ? null : ceilDiv(patternW, def.w),
    rows: mixed ? null : ceilDiv(patternH, def.h),
    tileW: sample.w,
    tileH: sample.h,
    orientation: mixed ? "mixed" : def.orientation,
    mixed,
    baseOrientation: def.orientation,
  };
}

function layoutLabel(layout) {
  const { sheets, mixed, orientation, cols, rows } = layout;
  if (mixed) {
    return `${sheets.length} sheets (mixed)`;
  }
  if (cols && rows && sheets.length === cols * rows) {
    return `${cols}×${rows} sheets (${orientation})`;
  }
  return `${sheets.length} sheet${sheets.length === 1 ? "" : "s"} (${orientation})`;
}

function drawPreview() {
  const widthIn = Number(form.elements.artworkWidth.value);
  const heightIn = Number(form.elements.artworkHeight.value);
  const depthIn = Number(form.elements.artworkDepth.value);
  const edgeIn = Math.max(0, Number(form.elements.edgePadding.value) || 0);
  const frontIn = Math.max(0, Number(form.elements.frontPadding.value) || 0);
  const backIn = Math.max(0, Number(form.elements.backPadding.value) || 0);
  const sheetW = Math.max(0.01, Number(sheetWidthInput.value) || DEFAULT_SHEET_WIDTH);
  const sheetH = Math.max(0.01, Number(sheetHeightInput.value) || DEFAULT_SHEET_HEIGHT);
  const preferred =
    form.elements.sheetOrientation.value === "vertical" ? "vertical" : "horizontal";
  const override = Boolean(form.elements.overrideOrientation?.checked);
  const optimize = Boolean(form.elements.optimizePerpendicular?.checked);
  const centerHorizontal = Boolean(form.elements.centerHorizontal?.checked);
  const centerVertical = Boolean(form.elements.centerVertical?.checked);
  const showSheetDimensions = Boolean(form.elements.showSheetDimensions?.checked);

  const outerW = widthIn + edgeIn * 2;
  const outerH = heightIn + edgeIn * 2;
  const wallDepth = depthIn + frontIn + backIn;

  const patternW = outerW + wallDepth * 2;
  const patternH = outerH + wallDepth * 2;

  const layout = resolveSheetLayout(
    patternW,
    patternH,
    sheetW,
    sheetH,
    preferred,
    override,
    optimize
  );
  const sheets = anchorSheetsToPattern(
    layout.sheets,
    patternW,
    patternH,
    centerHorizontal,
    centerVertical
  );

  let minX = 0;
  let minY = 0;
  let maxX = patternW;
  let maxY = patternH;
  for (const sheet of sheets) {
    minX = Math.min(minX, sheet.x);
    minY = Math.min(minY, sheet.y);
    maxX = Math.max(maxX, sheet.x + sheet.w);
    maxY = Math.max(maxY, sheet.y + sheet.h);
  }
  const unionW = maxX - minX;
  const unionH = maxY - minY;

  const dpr = window.devicePixelRatio || 1;
  const cssWidth = canvas.clientWidth || 480;
  const cssHeight = Math.max(360, Math.round(cssWidth * 0.85));
  canvas.width = Math.round(cssWidth * dpr);
  canvas.height = Math.round(cssHeight * dpr);
  canvas.style.height = `${cssHeight}px`;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  ctx.clearRect(0, 0, cssWidth, cssHeight);
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, cssWidth, cssHeight);

  const padLeft = 88;
  const padRight = 72;
  const padTop = 56;
  const padBottom = 100;
  const availW = cssWidth - padLeft - padRight;
  const availH = cssHeight - padTop - padBottom;
  const scale = Math.min(availW / unionW, availH / unionH);

  const unionOriginX = padLeft + (availW - unionW * scale) / 2;
  const unionOriginY = padTop + (availH - unionH * scale) / 2;

  const toX = (inches) => unionOriginX + (inches - minX) * scale;
  const toY = (inches) => unionOriginY + (inches - minY) * scale;

  const patternX = toX(0);
  const patternY = toY(0);
  const patternRight = toX(patternW);
  const patternBottom = toY(patternH);

  const outerBoxW = outerW * scale;
  const outerBoxH = outerH * scale;
  const artBoxW = widthIn * scale;
  const artBoxH = heightIn * scale;
  const edgePx = edgeIn * scale;
  const wallPx = wallDepth * scale;

  const ox = patternX + wallPx;
  const oy = patternY + wallPx;
  const ax = ox + edgePx;
  const ay = oy + edgePx;

  // Cardboard sheets — thin red outlines, edges abut exactly (no gap/overlap)
  ctx.strokeStyle = "#c00";
  ctx.lineWidth = 0.75;
  ctx.setLineDash([]);
  for (const sheet of sheets) {
    const sx = toX(sheet.x);
    const sy = toY(sheet.y);
    const sw = sheet.w * scale;
    const sh = sheet.h * scale;
    ctx.strokeRect(sx + 0.5, sy + 0.5, sw, sh);
  }

  // Containing bounds — gray dotted corners only
  if (wallDepth > 0) {
    ctx.strokeStyle = "#999";
    ctx.lineWidth = 0.75;
    ctx.setLineDash([1.5, 2.5]);
    ctx.beginPath();
    ctx.moveTo(patternX, oy);
    ctx.lineTo(patternX, patternY);
    ctx.lineTo(ox, patternY);
    ctx.moveTo(ox + outerBoxW, patternY);
    ctx.lineTo(patternRight, patternY);
    ctx.lineTo(patternRight, oy);
    ctx.moveTo(patternRight, oy + outerBoxH);
    ctx.lineTo(patternRight, patternBottom);
    ctx.lineTo(ox + outerBoxW, patternBottom);
    ctx.moveTo(ox, patternBottom);
    ctx.lineTo(patternX, patternBottom);
    ctx.lineTo(patternX, oy + outerBoxH);
    ctx.stroke();
  }

  ctx.strokeStyle = "#111";
  ctx.lineWidth = 0.75;
  ctx.setLineDash([]);

  if (wallDepth > 0) {
    ctx.beginPath();
    ctx.moveTo(ox, patternY);
    ctx.lineTo(ox + outerBoxW, patternY);
    ctx.lineTo(ox + outerBoxW, oy);
    ctx.lineTo(ox + outerBoxW + wallPx, oy);
    ctx.lineTo(ox + outerBoxW + wallPx, oy + outerBoxH);
    ctx.lineTo(ox + outerBoxW, oy + outerBoxH);
    ctx.lineTo(ox + outerBoxW, oy + outerBoxH + wallPx);
    ctx.lineTo(ox, oy + outerBoxH + wallPx);
    ctx.lineTo(ox, oy + outerBoxH);
    ctx.lineTo(patternX, oy + outerBoxH);
    ctx.lineTo(patternX, oy);
    ctx.lineTo(ox, oy);
    ctx.closePath();
    ctx.stroke();

    ctx.setLineDash([5, 4]);
    ctx.strokeRect(ox + 0.5, oy + 0.5, outerBoxW, outerBoxH);
  } else {
    ctx.strokeRect(ox + 0.5, oy + 0.5, outerBoxW, outerBoxH);
  }

  if (edgeIn > 0) {
    ctx.setLineDash([1.5, 2.5]);
    ctx.strokeRect(ax + 0.5, ay + 0.5, artBoxW, artBoxH);
  }

  ctx.setLineDash([]);

  const dimGap = 28;
  const containDimGap = 58;
  const vLabelOff = -16;
  const hLabelOff = 14;

  drawDimensionLine(
    patternX,
    patternBottom + containDimGap,
    patternRight,
    patternBottom + containDimGap,
    `${formatInches(patternW)}`,
    0,
    hLabelOff
  );

  drawDimensionLine(
    patternX - containDimGap,
    patternY,
    patternX - containDimGap,
    patternBottom,
    `${formatInches(patternH)}`,
    vLabelOff,
    0
  );

  drawDimensionLine(
    ox,
    oy + outerBoxH + wallPx + dimGap,
    ox + outerBoxW,
    oy + outerBoxH + wallPx + dimGap,
    `${formatInches(outerW)}`,
    0,
    hLabelOff
  );

  drawDimensionLine(
    patternX - dimGap,
    oy,
    patternX - dimGap,
    oy + outerBoxH,
    `${formatInches(outerH)}`,
    vLabelOff,
    0
  );

  if (wallDepth > 0) {
    drawDimensionLine(
      ox + outerBoxW,
      oy + outerBoxH + wallPx + dimGap,
      ox + outerBoxW + wallPx,
      oy + outerBoxH + wallPx + dimGap,
      `${formatInches(wallDepth)}`,
      0,
      hLabelOff
    );
  }

  if (showSheetDimensions && sheets.length) {
    // Dimension the bottom-right sheet
    const brSheet = sheets.reduce((best, sheet) => {
      const br = sheet.x + sheet.w + sheet.y + sheet.h;
      const bestBr = best.x + best.w + best.y + best.h;
      return br >= bestBr ? sheet : best;
    });

    const sheetDimGap = 28;
    const brX = toX(brSheet.x);
    const brY = toY(brSheet.y);
    const brRight = toX(brSheet.x + brSheet.w);
    const brBottom = toY(brSheet.y + brSheet.h);

    drawDimensionLine(
      brX,
      patternBottom + containDimGap + sheetDimGap,
      brRight,
      patternBottom + containDimGap + sheetDimGap,
      `${formatInches(brSheet.w)}`,
      0,
      hLabelOff,
      "#c00"
    );

    drawDimensionLine(
      patternRight + sheetDimGap,
      brY,
      patternRight + sheetDimGap,
      brBottom,
      `${formatInches(brSheet.h)}`,
      16,
      0,
      "#c00"
    );
  }

  if (sheets.length > 1) {
    const gridLeft = toX(Math.min(...sheets.map((s) => s.x)));
    const gridTop = toY(Math.min(...sheets.map((s) => s.y)));
    ctx.fillStyle = "#c00";
    ctx.font = "11px ui-sans-serif, system-ui, sans-serif";
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.fillText(layoutLabel(layout), gridLeft, gridTop - 16);
  }

  // Artwork size labels — inside the dotted rect, text only (no dimension brackets)
  const artLabelInset = 16;
  drawDimensionLabel(
    ax + artBoxW / 2,
    ay + artBoxH - artLabelInset,
    formatInches(widthIn)
  );
  drawDimensionLabel(
    ax + artLabelInset,
    ay + artBoxH / 2,
    formatInches(heightIn),
    true
  );

  if (edgeIn > 0 && edgePx >= 14) {
    ctx.fillStyle = "#111";
    ctx.font = "11px ui-sans-serif, system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(formatInches(edgeIn), ax + artBoxW / 2, oy + edgePx / 2);
  }
}

sliderNames.forEach((name) => {
  const input = form.elements[name];
  input.addEventListener("input", () => {
    syncSlider(name);
    drawPreview();
  });
  syncSlider(name);
});

form.elements.edgePadding.addEventListener("input", drawPreview);
form.elements.frontPadding.addEventListener("input", drawPreview);
form.elements.backPadding.addEventListener("input", drawPreview);
sheetWidthInput.addEventListener("input", drawPreview);
sheetHeightInput.addEventListener("input", drawPreview);
document.querySelectorAll('input[name="sheetOrientation"]').forEach((input) => {
  input.addEventListener("change", drawPreview);
});

document.querySelectorAll('input[name="inchFormat"]').forEach((input) => {
  input.addEventListener("change", () => {
    sliderNames.forEach(syncSlider);
    drawPreview();
  });
});

document.querySelectorAll(".nudge").forEach((button) => {
  button.addEventListener("click", () => {
    nudgeDimension(button.dataset.dim, Number(button.dataset.dir));
  });
});

const overrideOrientationInput = document.getElementById("overrideOrientation");
const optimizePerpendicularInput = document.getElementById("optimizePerpendicular");
const centerHorizontalInput = document.getElementById("centerHorizontal");
const centerVerticalInput = document.getElementById("centerVertical");
const showSheetDimensionsInput = document.getElementById("showSheetDimensions");

function syncOrientationOverride() {
  const override = overrideOrientationInput.checked;
  document.querySelectorAll('input[name="sheetOrientation"]').forEach((input) => {
    input.disabled = !override;
  });
  drawPreview();
}

overrideOrientationInput.addEventListener("change", syncOrientationOverride);
optimizePerpendicularInput.addEventListener("change", drawPreview);
centerHorizontalInput.addEventListener("change", drawPreview);
centerVerticalInput.addEventListener("change", drawPreview);
showSheetDimensionsInput.addEventListener("change", drawPreview);

lockBtn.addEventListener("click", () => {
  setSheetLocked(!sheetLocked);
});

form.addEventListener("submit", (event) => {
  event.preventDefault();

  const data = new FormData(form);
  const values = {
    artworkWidth: Number(data.get("artworkWidth")),
    artworkHeight: Number(data.get("artworkHeight")),
    artworkDepth: Number(data.get("artworkDepth")),
    edgePadding: Number(data.get("edgePadding")),
    frontPadding: Number(data.get("frontPadding")),
    backPadding: Number(data.get("backPadding")),
    sheetWidth: Number(sheetWidthInput.value),
    sheetHeight: Number(sheetHeightInput.value),
    sheetOrientation: data.get("sheetOrientation") || "horizontal",
    overrideOrientation: Boolean(data.get("overrideOrientation")),
    optimizePerpendicular: Boolean(data.get("optimizePerpendicular")),
    centerHorizontal: Boolean(data.get("centerHorizontal")),
    centerVertical: Boolean(data.get("centerVertical")),
    boxType: data.get("boxType") || "bottom-lid",
  };

  const patternW =
    values.artworkWidth +
    values.edgePadding * 2 +
    (values.artworkDepth + values.frontPadding + values.backPadding) * 2;
  const patternH =
    values.artworkHeight +
    values.edgePadding * 2 +
    (values.artworkDepth + values.frontPadding + values.backPadding) * 2;
  const layout = resolveSheetLayout(
    patternW,
    patternH,
    values.sheetWidth,
    values.sheetHeight,
    values.sheetOrientation,
    values.overrideOrientation,
    values.optimizePerpendicular
  );

  const boxTypeLabel =
    values.boxType === "clamshell" ? "Clamshell" : "Bottom / lid";

  const anchorParts = [];
  if (values.centerHorizontal) anchorParts.push("horizontal center");
  if (values.centerVertical) anchorParts.push("vertical center");
  const anchorLabel = anchorParts.length ? anchorParts.join(" + ") : "bottom-right";

  summary.textContent = [
    `Box type: ${boxTypeLabel}`,
    `Artwork: ${values.artworkWidth} × ${values.artworkHeight} × ${values.artworkDepth} in`,
    `Edge padding: ${values.edgePadding} in`,
    `Front padding: ${values.frontPadding} in`,
    `Back padding: ${values.backPadding} in`,
    `Sheet: ${values.sheetWidth} × ${values.sheetHeight} in`,
    `Orientation: ${values.overrideOrientation ? "manual" : "automatic"} → ${layout.baseOrientation || layout.orientation}`,
    `Sheet anchor: ${anchorLabel}`,
    `Fit: ${layoutLabel(layout)}`,
    "",
    "(Cutting diagrams not yet generated.)",
  ].join("\n");

  output.hidden = false;
});

form.addEventListener("reset", () => {
  requestAnimationFrame(() => {
    sliderNames.forEach(syncSlider);
    sheetWidthInput.value = DEFAULT_SHEET_WIDTH;
    sheetHeightInput.value = DEFAULT_SHEET_HEIGHT;
    setSheetLocked(true);
    form.elements.boxType.value = "bottom-lid";
    form.elements.sheetOrientation.value = "horizontal";
    form.elements.inchFormat.value = "decimal";
    overrideOrientationInput.checked = false;
    optimizePerpendicularInput.checked = true;
    centerHorizontalInput.checked = false;
    centerVerticalInput.checked = false;
    showSheetDimensionsInput.checked = false;
    syncOrientationOverride();
  });
  output.hidden = true;
  summary.textContent = "";
});

window.addEventListener("resize", drawPreview);

setSheetLocked(true);
syncOrientationOverride();
