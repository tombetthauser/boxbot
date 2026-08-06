const form = document.getElementById("box-form");
const output = document.getElementById("output");
const cutPlanViewer = document.getElementById("cut-plan-viewer");
const cutPlanStage = document.getElementById("cut-plan-stage");
const cutPlanIndexLabel = document.getElementById("cut-plan-index-label");
const cutPlanPrevBtn = document.getElementById("cut-plan-prev");
const cutPlanNextBtn = document.getElementById("cut-plan-next");
const cutPlansNote = document.getElementById("cut-plans-note");
const downloadCutPlansBtn = document.getElementById("download-cut-plans");
const cutPlanModal = document.getElementById("cut-plan-modal");
const cutPlanModalStage = document.getElementById("cut-plan-modal-stage");
const cutPlanModalClose = document.getElementById("cut-plan-modal-close");
const cutPlanModalPrev = document.getElementById("cut-plan-modal-prev");
const cutPlanModalNext = document.getElementById("cut-plan-modal-next");
const lockBtn = document.getElementById("sheet-lock");
const lidLayoutLockBtn = document.getElementById("lid-layout-lock");
const lidLayoutSection = document.getElementById("lid-layout-section");
const lidLayoutPart = document.getElementById("lid-layout-part");
const lidLockedNote = document.getElementById("lid-locked-note");
const sheetWidthInput = document.getElementById("sheetWidth");
const sheetHeightInput = document.getElementById("sheetHeight");
const menuToggle = document.getElementById("menu-toggle");
const formBackdrop = document.getElementById("form-backdrop");
const infoModal = document.getElementById("info-modal");
const infoModalTitle = document.getElementById("info-modal-title");
const infoModalBody = document.getElementById("info-modal-body");
const infoModalClose = document.getElementById("info-modal-close");
const infoTooltip = document.getElementById("info-tooltip");
const baseCanvas = document.getElementById("base-canvas");
const lidCanvas = document.getElementById("lid-canvas");
const baseCtx = baseCanvas.getContext("2d");
const lidCtx = lidCanvas.getContext("2d");
let activeCtx = baseCtx;
/** @type {Array<object>} */
let latestCutPlans = [];
let cutPlanIndex = 0;

const DEFAULT_SHEET_WIDTH = 48;
const DEFAULT_SHEET_HEIGHT = 96;
const DEFAULT_THICKNESS = 0.125;
const SHEET_GAP_PX = 1;
const FIT_EPS = 1e-6;

/**
 * When true, leftover bands in a split (e.g. top-left above a vertical strip)
 * prefer the default/base sheet orientation when either orientation would work.
 * Set to false to restore uniform strip packing (easy undo).
 */
const PREFER_DEFAULT_ORIENTATION_IN_REMNANTS = true;

const sliderNames = ["artworkWidth", "artworkHeight", "artworkDepth", "cardboardThickness"];

let sheetLocked = true;
let lidLayoutLocked = true;

function syncSlider(name) {
  const input = form.elements[name];
  const label = document.getElementById(`${name}-val`);
  if (input && label) {
    const denom = name === "cardboardThickness" ? 64 : 32;
    const formatted = formatDimValue(Number(input.value), denom);
    if (label.tagName === "INPUT") {
      if (document.activeElement !== label) label.value = formatted;
    } else {
      label.textContent = formatted;
    }
  }
}

/** Parse typed inch strings: 24, 24.5, 24", 1/8, 24 1/2, 24-1/2 */
function parseInchesInput(raw) {
  let s = String(raw ?? "")
    .trim()
    .replace(/["″']/g, "")
    .replace(/,/g, "")
    .replace(/−/g, "-");
  if (!s) return NaN;

  const mixed = s.match(/^(-?\d+(?:\.\d+)?)\s+(\d+)\s*\/\s*(\d+)$/);
  if (mixed) {
    const whole = Number(mixed[1]);
    const frac = Number(mixed[2]) / Number(mixed[3]);
    if (!Number.isFinite(whole) || !Number.isFinite(frac)) return NaN;
    return whole + Math.sign(whole || 1) * Math.abs(frac);
  }

  const dashed = s.match(/^(-?\d+(?:\.\d+)?)-(\d+)\s*\/\s*(\d+)$/);
  if (dashed) {
    const whole = Number(dashed[1]);
    const frac = Number(dashed[2]) / Number(dashed[3]);
    if (!Number.isFinite(whole) || !Number.isFinite(frac)) return NaN;
    return whole + Math.sign(whole || 1) * Math.abs(frac);
  }

  const frac = s.match(/^(-?\d+)\s*\/\s*(\d+)$/);
  if (frac) {
    const n = Number(frac[1]) / Number(frac[2]);
    return Number.isFinite(n) ? n : NaN;
  }

  const n = Number(s);
  return Number.isFinite(n) ? n : NaN;
}

function ensureSliderCanReach(input, value) {
  if (!input || input.type !== "range") return;
  const n = Number(value);
  if (!Number.isFinite(n)) return;
  const curMax = Number(input.max);
  if (Number.isFinite(curMax) && n > curMax) {
    input.max = String(n);
  }
}

/**
 * Set a dimension from slider, nudge, or typed override.
 * Artwork sizes have no upper cap when typed; thickness stays within min/max.
 */
function setDimensionValue(name, value) {
  const input = form.elements[name];
  if (!input) return false;

  let n = Number(value);
  if (!Number.isFinite(n)) return false;

  const minRaw = Number(input.min);
  const min = Number.isFinite(minRaw) ? minRaw : 0;

  if (name === "cardboardThickness") {
    const maxRaw = Number(input.max);
    const max = Number.isFinite(maxRaw) ? maxRaw : 1;
    n = Math.min(max, Math.max(min, n));
  } else {
    if (n < min) n = min;
    ensureSliderCanReach(input, n);
  }

  input.value = String(n);
  syncSlider(name);
  drawPreview();
  return true;
}

function commitValueEdit(name) {
  const edit = document.getElementById(`${name}-val`);
  if (!edit || edit.tagName !== "INPUT") return;
  const parsed = parseInchesInput(edit.value);
  if (!Number.isFinite(parsed)) {
    syncSlider(name);
    return;
  }
  setDimensionValue(name, parsed);
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

function getRadioValue(name) {
  const checked = form.querySelector(`input[name="${name}"]:checked`);
  return checked?.value || "horizontal";
}

function setRadioValue(name, value) {
  const input = form.querySelector(`input[name="${name}"][value="${value}"]`);
  if (input) input.checked = true;
}

function copyBaseLayoutToLid() {
  form.elements.lidOptimizePerpendicular.checked =
    form.elements.baseOptimizePerpendicular.checked;
  form.elements.lidOverrideOrientation.checked =
    form.elements.baseOverrideOrientation.checked;
  setRadioValue("lidSheetOrientation", getRadioValue("baseSheetOrientation"));
  form.elements.lidCenterHorizontal.checked =
    form.elements.baseCenterHorizontal.checked;
  form.elements.lidCenterVertical.checked =
    form.elements.baseCenterVertical.checked;
  form.elements.lidShowSheetDimensions.checked =
    form.elements.baseShowSheetDimensions.checked;

  const override = form.elements.lidOverrideOrientation.checked;
  document.querySelectorAll('input[name="lidSheetOrientation"]').forEach((input) => {
    input.disabled = !override;
  });
}

function setLidLayoutLocked(locked) {
  lidLayoutLocked = locked;
  lidLayoutLockBtn.setAttribute("aria-pressed", String(locked));
  lidLayoutLockBtn.title = locked
    ? "Unlock to customize lid layout"
    : "Lock lid layout to match Box Base";
  lidLayoutLockBtn.querySelector(".lock-icon").textContent = locked ? "🔒" : "🔓";
  lidLayoutLockBtn.querySelector(".lock-label").textContent = locked
    ? "Locked"
    : "Unlocked";
  if (lidLayoutSection) lidLayoutSection.hidden = locked;
  if (lidLayoutPart) {
    lidLayoutPart.classList.toggle("is-locked", locked);
    lidLayoutPart.classList.toggle("is-unlocked", !locked);
  }
  if (lidLockedNote) lidLockedNote.hidden = !locked;

  if (locked) {
    copyBaseLayoutToLid();
  }
  drawPreview();
}

function assignSheetLetters(sheets, startIndex = 0) {
  const start = Number(startIndex) || 0;
  const letterAt =
    window.CutPlans && typeof window.CutPlans.letterForIndex === "function"
      ? window.CutPlans.letterForIndex
      : (i) => String.fromCharCode(65 + (i % 26));
  const ranked = sheets
    .map((sheet, index) => ({ sheet, index }))
    .sort((a, b) => {
      if (Math.abs(a.sheet.y - b.sheet.y) > FIT_EPS) return a.sheet.y - b.sheet.y;
      if (Math.abs(a.sheet.x - b.sheet.x) > FIT_EPS) return a.sheet.x - b.sheet.x;
      return a.index - b.index;
    });
  ranked.forEach((item, rank) => {
    item.sheet.letter = letterAt(start + rank);
  });
  return start + sheets.length;
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

/** Snap inches to nearest 1/denom using integer fraction units. */
function toFractionUnits(value, denom) {
  return Math.round(Number(value) * denom);
}

function fromFractionUnits(units, denom) {
  return units / denom;
}

/** Snap inches to nearest 1/32 using integer thirty-seconds (exact for dyadic values). */
function toThirtySeconds(value) {
  return toFractionUnits(value, 32);
}

function fromThirtySeconds(units) {
  return fromFractionUnits(units, 32);
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
 * Round to nearest 1/denom" and format as a reduced imperial fraction.
 * Conversion is integer-based so every k/denom" round-trips exactly.
 */
function formatInchesFraction(value, denom = 32) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '0"';

  const sign = n < 0 ? "-" : "";
  const units = toFractionUnits(Math.abs(n), denom);
  const whole = Math.floor(units / denom);
  let numerator = units % denom;

  if (numerator === 0) {
    return `${sign}${whole}"`;
  }

  const g = gcdInt(numerator, denom);
  numerator /= g;
  const denominator = denom / g;

  if (whole === 0) {
    return `${sign}${numerator}/${denominator}"`;
  }
  return `${sign}${whole} ${numerator}/${denominator}"`;
}

function formatDimValue(value, denom = 32) {
  return inchFormatMode() === "fraction"
    ? formatInchesFraction(value, denom)
    : formatInchesDecimal(value);
}

/** Canvas labels always use 1/32" precision in fraction mode. */
function formatInches(value) {
  return formatDimValue(value, 32);
}

/**
 * Nudge a dimension slider by 1/denom" (fraction mode) or 0.1" (decimal mode).
 */
function nudgeDimension(name, direction, fractionDenom = 32) {
  const input = form.elements[name];
  if (!input) return;

  const minRaw = Number(input.min);
  const min = Number.isFinite(minRaw) ? minRaw : name === "cardboardThickness" ? 0.0625 : 0;
  const dir = direction < 0 ? -1 : 1;
  let next;

  if (inchFormatMode() === "fraction") {
    next = fromFractionUnits(toFractionUnits(input.value, fractionDenom) + dir, fractionDenom);
  } else {
    next = fromTenths(toTenths(input.value) + dir);
  }

  if (next < min) next = min;

  if (name === "cardboardThickness") {
    const maxRaw = Number(input.max);
    const max = Number.isFinite(maxRaw) ? maxRaw : 1;
    next = Math.min(max, next);
  } else {
    ensureSliderCanReach(input, next);
  }

  setDimensionValue(name, next);
}

/** Fixed slot so long fraction labels do not shift surrounding preview geometry. */
const DIM_LABEL_SLOT_W = 72;
const DIM_LABEL_SLOT_H = 14;

function drawDimensionLabel(x, y, label, vertical = false, color = "#111") {
  activeCtx.font = "12px ui-sans-serif, system-ui, sans-serif";
  activeCtx.textAlign = "center";
  activeCtx.textBaseline = "middle";
  activeCtx.save();
  activeCtx.translate(x, y);
  if (vertical) activeCtx.rotate(-Math.PI / 2);
  activeCtx.fillStyle = "#fff";
  activeCtx.fillRect(-DIM_LABEL_SLOT_W / 2, -DIM_LABEL_SLOT_H / 2, DIM_LABEL_SLOT_W, DIM_LABEL_SLOT_H);
  activeCtx.fillStyle = color;
  activeCtx.fillText(label, 0, 0);
  activeCtx.restore();
}

function drawDimensionLine(x1, y1, x2, y2, label, offsetX, offsetY, color = "#111") {
  const tick = 5;
  activeCtx.strokeStyle = color;
  activeCtx.fillStyle = color;
  activeCtx.lineWidth = 0.75;
  activeCtx.beginPath();
  activeCtx.moveTo(x1, y1);
  activeCtx.lineTo(x2, y2);
  activeCtx.stroke();

  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.hypot(dx, dy) || 1;
  const nx = (-dy / len) * tick;
  const ny = (dx / len) * tick;

  activeCtx.beginPath();
  activeCtx.moveTo(x1 - nx / 2, y1 - ny / 2);
  activeCtx.lineTo(x1 + nx / 2, y1 + ny / 2);
  activeCtx.moveTo(x2 - nx / 2, y2 - ny / 2);
  activeCtx.lineTo(x2 + nx / 2, y2 + ny / 2);
  activeCtx.stroke();

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

function readSharedDims() {
  const widthIn = Number(form.elements.artworkWidth.value);
  const heightIn = Number(form.elements.artworkHeight.value);
  const depthIn = Number(form.elements.artworkDepth.value);
  const edgeIn = Math.max(0, Number(form.elements.edgePadding.value) || 0);
  const frontIn = Math.max(0, Number(form.elements.frontPadding.value) || 0);
  const backIn = Math.max(0, Number(form.elements.backPadding.value) || 0);
  // Thickness is applied to the lid pattern when "Expand lid for cardboard thickness" is on.
  const thicknessIn = Math.max(
    0,
    Number(form.elements.cardboardThickness?.value) || DEFAULT_THICKNESS
  );
  const sheetW = Math.max(0.01, Number(sheetWidthInput.value) || DEFAULT_SHEET_WIDTH);
  const sheetH = Math.max(0.01, Number(sheetHeightInput.value) || DEFAULT_SHEET_HEIGHT);

  const outerW = widthIn + edgeIn * 2;
  const outerH = heightIn + edgeIn * 2;
  const wallDepth = depthIn + frontIn + backIn;
  const patternW = outerW + wallDepth * 2;
  const patternH = outerH + wallDepth * 2;

  return {
    widthIn,
    heightIn,
    depthIn,
    edgeIn,
    frontIn,
    backIn,
    thicknessIn,
    sheetW,
    sheetH,
    outerW,
    outerH,
    wallDepth,
    patternW,
    patternH,
  };
}

/**
 * Lid fits over the base: expand the center panel by 2× thickness and each
 * side flap by 1× thickness when enabled.
 */
function lidGeometryFromShared(shared, expandForThickness) {
  if (!expandForThickness || shared.thicknessIn <= FIT_EPS) {
    return {
      outerW: shared.outerW,
      outerH: shared.outerH,
      wallDepth: shared.wallDepth,
      patternW: shared.patternW,
      patternH: shared.patternH,
    };
  }

  const t = shared.thicknessIn;
  const outerW = shared.outerW + 2 * t;
  const outerH = shared.outerH + 2 * t;
  const wallDepth = shared.wallDepth + t;
  return {
    outerW,
    outerH,
    wallDepth,
    patternW: outerW + wallDepth * 2,
    patternH: outerH + wallDepth * 2,
  };
}

function lidExpandForThicknessEnabled() {
  // Always expand the lid for cardboard thickness (UI toggle removed for now).
  return true;
}

function readSheetLayoutControls(prefix) {
  const preferred =
    getRadioValue(`${prefix}SheetOrientation`) === "vertical"
      ? "vertical"
      : "horizontal";
  return {
    preferred,
    override: Boolean(form.elements[`${prefix}OverrideOrientation`]?.checked),
    optimize: Boolean(form.elements[`${prefix}OptimizePerpendicular`]?.checked),
    centerHorizontal: Boolean(form.elements[`${prefix}CenterHorizontal`]?.checked),
    centerVertical: Boolean(form.elements[`${prefix}CenterVertical`]?.checked),
    showSheetDimensions: Boolean(form.elements[`${prefix}ShowSheetDimensions`]?.checked),
  };
}

function drawPartPreview(canvas, partCtx, opts) {
  const {
    widthIn,
    heightIn,
    edgeIn,
    sheetW,
    sheetH,
    outerW,
    outerH,
    wallDepth,
    patternW,
    patternH,
    preferred,
    override,
    optimize,
    centerHorizontal,
    centerVertical,
    showSheetDimensions,
    showArtworkInterior,
    showSheetLetters,
    letterOffset = 0,
  } = opts;

  activeCtx = partCtx;

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
  assignSheetLetters(sheets, letterOffset);

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
  partCtx.setTransform(dpr, 0, 0, dpr, 0, 0);

  partCtx.clearRect(0, 0, cssWidth, cssHeight);
  partCtx.fillStyle = "#fff";
  partCtx.fillRect(0, 0, cssWidth, cssHeight);

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
  partCtx.strokeStyle = "#c00";
  partCtx.lineWidth = 0.75;
  partCtx.setLineDash([]);
  for (const sheet of sheets) {
    const sx = toX(sheet.x);
    const sy = toY(sheet.y);
    const sw = sheet.w * scale;
    const sh = sheet.h * scale;
    partCtx.strokeRect(sx + 0.5, sy + 0.5, sw, sh);
  }

  if (showSheetLetters) {
    partCtx.fillStyle = "#c00";
    partCtx.font = "300 13px Georgia, 'Times New Roman', serif";
    partCtx.textAlign = "left";
    partCtx.textBaseline = "top";
    for (const sheet of sheets) {
      if (!sheet.letter) continue;
      partCtx.fillText(
        String(sheet.letter).toLowerCase(),
        toX(sheet.x) + 6,
        toY(sheet.y) + 5
      );
    }
  }

  // Containing bounds — gray dotted corners only
  if (wallDepth > 0) {
    partCtx.strokeStyle = "#999";
    partCtx.lineWidth = 0.75;
    partCtx.setLineDash([1.5, 2.5]);
    partCtx.beginPath();
    partCtx.moveTo(patternX, oy);
    partCtx.lineTo(patternX, patternY);
    partCtx.lineTo(ox, patternY);
    partCtx.moveTo(ox + outerBoxW, patternY);
    partCtx.lineTo(patternRight, patternY);
    partCtx.lineTo(patternRight, oy);
    partCtx.moveTo(patternRight, oy + outerBoxH);
    partCtx.lineTo(patternRight, patternBottom);
    partCtx.lineTo(ox + outerBoxW, patternBottom);
    partCtx.moveTo(ox, patternBottom);
    partCtx.lineTo(patternX, patternBottom);
    partCtx.lineTo(patternX, oy + outerBoxH);
    partCtx.stroke();
  }

  partCtx.strokeStyle = "#111";
  partCtx.lineWidth = 0.75;
  partCtx.setLineDash([]);

  if (wallDepth > 0) {
    partCtx.beginPath();
    partCtx.moveTo(ox, patternY);
    partCtx.lineTo(ox + outerBoxW, patternY);
    partCtx.lineTo(ox + outerBoxW, oy);
    partCtx.lineTo(ox + outerBoxW + wallPx, oy);
    partCtx.lineTo(ox + outerBoxW + wallPx, oy + outerBoxH);
    partCtx.lineTo(ox + outerBoxW, oy + outerBoxH);
    partCtx.lineTo(ox + outerBoxW, oy + outerBoxH + wallPx);
    partCtx.lineTo(ox, oy + outerBoxH + wallPx);
    partCtx.lineTo(ox, oy + outerBoxH);
    partCtx.lineTo(patternX, oy + outerBoxH);
    partCtx.lineTo(patternX, oy);
    partCtx.lineTo(ox, oy);
    partCtx.closePath();
    partCtx.stroke();

    partCtx.setLineDash([5, 4]);
    partCtx.strokeRect(ox + 0.5, oy + 0.5, outerBoxW, outerBoxH);
  } else {
    partCtx.strokeRect(ox + 0.5, oy + 0.5, outerBoxW, outerBoxH);
  }

  if (showArtworkInterior && edgeIn > 0) {
    partCtx.setLineDash([1.5, 2.5]);
    partCtx.strokeRect(ax + 0.5, ay + 0.5, artBoxW, artBoxH);
  }

  partCtx.setLineDash([]);

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
    partCtx.fillStyle = "#c00";
    partCtx.font = "11px ui-sans-serif, system-ui, sans-serif";
    partCtx.textAlign = "left";
    partCtx.textBaseline = "top";
    partCtx.fillText(layoutLabel(layout), gridLeft, gridTop - 16);
  }

  if (showArtworkInterior) {
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
      partCtx.fillStyle = "#111";
      partCtx.font = "11px ui-sans-serif, system-ui, sans-serif";
      partCtx.textAlign = "center";
      partCtx.textBaseline = "middle";
      partCtx.fillText(formatInches(edgeIn), ax + artBoxW / 2, oy + edgePx / 2);
    }
  }

  return { layout, sheets };
}

function drawPreview() {
  if (lidLayoutLocked) {
    copyBaseLayoutToLid();
  }

  const shared = readSharedDims();
  const baseControls = readSheetLayoutControls("base");
  const lidControls = lidLayoutLocked
    ? baseControls
    : readSheetLayoutControls("lid");
  const lidGeom = lidGeometryFromShared(shared, lidExpandForThicknessEnabled());
  const showSheetLetters = Boolean(form.elements.showSheetLetters?.checked);

  const basePreview = drawPartPreview(baseCanvas, baseCtx, {
    ...shared,
    ...baseControls,
    showArtworkInterior: true,
    showSheetLetters,
    letterOffset: 0,
  });
  drawPartPreview(lidCanvas, lidCtx, {
    ...shared,
    ...lidControls,
    ...lidGeom,
    showArtworkInterior: false,
    showSheetLetters,
    letterOffset: basePreview.sheets.length,
  });
}

function syncOrientationOverride(prefix) {
  const override = Boolean(form.elements[`${prefix}OverrideOrientation`]?.checked);
  document.querySelectorAll(`input[name="${prefix}SheetOrientation"]`).forEach((input) => {
    input.disabled = !override;
  });
  if (prefix === "base" && lidLayoutLocked) {
    copyBaseLayoutToLid();
  }
  drawPreview();
}

function afterBaseLayoutChange() {
  if (lidLayoutLocked) copyBaseLayoutToLid();
  drawPreview();
}

function resetPartLayoutControls(prefix) {
  setRadioValue(`${prefix}SheetOrientation`, "horizontal");
  form.elements[`${prefix}OverrideOrientation`].checked = false;
  form.elements[`${prefix}OptimizePerpendicular`].checked = true;
  form.elements[`${prefix}CenterHorizontal`].checked = false;
  form.elements[`${prefix}CenterVertical`].checked = false;
  form.elements[`${prefix}ShowSheetDimensions`].checked = false;
}

function wirePartLayoutControls(prefix, onChange = drawPreview) {
  document.querySelectorAll(`input[name="${prefix}SheetOrientation"]`).forEach((input) => {
    input.addEventListener("change", onChange);
  });

  form.elements[`${prefix}OverrideOrientation`].addEventListener("change", () => {
    syncOrientationOverride(prefix);
  });
  form.elements[`${prefix}OptimizePerpendicular`].addEventListener("change", onChange);
  form.elements[`${prefix}CenterHorizontal`].addEventListener("change", onChange);
  form.elements[`${prefix}CenterVertical`].addEventListener("change", onChange);
  form.elements[`${prefix}ShowSheetDimensions`].addEventListener("change", onChange);
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

document.querySelectorAll('input[name="inchFormat"]').forEach((input) => {
  input.addEventListener("change", () => {
    sliderNames.forEach(syncSlider);
    drawPreview();
  });
});

document.querySelectorAll(".nudge").forEach((button) => {
  button.addEventListener("click", () => {
    nudgeDimension(
      button.dataset.dim,
      Number(button.dataset.dir),
      Number(button.dataset.step) || 32
    );
  });
});

sliderNames.forEach((name) => {
  const edit = document.getElementById(`${name}-val`);
  if (!edit || edit.tagName !== "INPUT") return;
  edit.addEventListener("focus", () => {
    edit.select();
  });
  edit.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      commitValueEdit(name);
      edit.blur();
    } else if (event.key === "Escape") {
      event.preventDefault();
      syncSlider(name);
      edit.blur();
    }
  });
  edit.addEventListener("blur", () => commitValueEdit(name));
});

wirePartLayoutControls("base", afterBaseLayoutChange);
wirePartLayoutControls("lid");

lockBtn.addEventListener("click", () => {
  setSheetLocked(!sheetLocked);
});

lidLayoutLockBtn.addEventListener("click", () => {
  setLidLayoutLocked(!lidLayoutLocked);
});

form.elements.showSheetLetters?.addEventListener("change", drawPreview);

function showCutPlanAt(index) {
  if (!latestCutPlans.length) return;
  cutPlanIndex = (index + latestCutPlans.length) % latestCutPlans.length;
  const plan = latestCutPlans[cutPlanIndex];
  const indexLabel = `${cutPlanIndex + 1} / ${latestCutPlans.length}`;

  if (cutPlanIndexLabel) cutPlanIndexLabel.textContent = indexLabel;
  if (cutPlanStage) cutPlanStage.innerHTML = plan.svg;

  if (cutPlanModalStage && cutPlanModal && !cutPlanModal.hidden) {
    cutPlanModalStage.innerHTML = plan.svg;
  }

  const atStart = latestCutPlans.length <= 1;
  if (cutPlanPrevBtn) cutPlanPrevBtn.disabled = atStart;
  if (cutPlanNextBtn) cutPlanNextBtn.disabled = atStart;
  if (cutPlanModalPrev) cutPlanModalPrev.disabled = atStart;
  if (cutPlanModalNext) cutPlanModalNext.disabled = atStart;
}

function openCutPlanModal() {
  if (!latestCutPlans.length || !cutPlanModal) return;
  cutPlanModal.hidden = false;
  document.body.style.overflow = "hidden";
  showCutPlanAt(cutPlanIndex);
}

function closeCutPlanModal() {
  if (!cutPlanModal) return;
  cutPlanModal.hidden = true;
  document.body.style.overflow = "";
}

function renderCutPlans(plans) {
  latestCutPlans = plans;
  cutPlanIndex = 0;

  if (!plans.length) {
    if (cutPlanViewer) cutPlanViewer.hidden = true;
    if (downloadCutPlansBtn) downloadCutPlansBtn.hidden = true;
    closeCutPlanModal();
    if (cutPlansNote) {
      cutPlansNote.hidden = false;
      cutPlansNote.textContent = "No sheets to diagram.";
    }
    return;
  }

  if (cutPlanViewer) cutPlanViewer.hidden = false;
  if (downloadCutPlansBtn) downloadCutPlansBtn.hidden = false;
  if (cutPlansNote) cutPlansNote.hidden = true;
  showCutPlanAt(0);
}

form.addEventListener("submit", (event) => {
  event.preventDefault();

  if (lidLayoutLocked) copyBaseLayoutToLid();

  const shared = readSharedDims();
  const baseControls = readSheetLayoutControls("base");
  const lidControls = lidLayoutLocked
    ? baseControls
    : readSheetLayoutControls("lid");
  const expandLid = lidExpandForThicknessEnabled();
  const lidGeom = lidGeometryFromShared(shared, expandLid);

  const baseLayout = resolveSheetLayout(
    shared.patternW,
    shared.patternH,
    shared.sheetW,
    shared.sheetH,
    baseControls.preferred,
    baseControls.override,
    baseControls.optimize
  );
  const lidLayout = resolveSheetLayout(
    lidGeom.patternW,
    lidGeom.patternH,
    shared.sheetW,
    shared.sheetH,
    lidControls.preferred,
    lidControls.override,
    lidControls.optimize
  );

  const baseSheets = anchorSheetsToPattern(
    baseLayout.sheets,
    shared.patternW,
    shared.patternH,
    baseControls.centerHorizontal,
    baseControls.centerVertical
  );
  const lidLetterOffset = assignSheetLetters(baseSheets, 0);
  const lidSheets = anchorSheetsToPattern(
    lidLayout.sheets,
    lidGeom.patternW,
    lidGeom.patternH,
    lidControls.centerHorizontal,
    lidControls.centerVertical
  );
  assignSheetLetters(lidSheets, lidLetterOffset);

  const CutPlans = window.CutPlans;
  const basePlans = CutPlans
    ? CutPlans.buildCutPlansForPart({
        part: "Base",
        sheets: baseSheets,
        outerW: shared.outerW,
        outerH: shared.outerH,
        wallDepth: shared.wallDepth,
        patternW: shared.patternW,
        patternH: shared.patternH,
        artworkW: shared.widthIn,
        artworkH: shared.heightIn,
        edgeIn: shared.edgeIn,
        showArtwork: true,
        formatInches,
        letterOffset: 0,
      })
    : [];
  const lidPlans = CutPlans
    ? CutPlans.buildCutPlansForPart({
        part: "Lid",
        sheets: lidSheets,
        outerW: lidGeom.outerW,
        outerH: lidGeom.outerH,
        wallDepth: lidGeom.wallDepth,
        patternW: lidGeom.patternW,
        patternH: lidGeom.patternH,
        artworkW: shared.widthIn,
        artworkH: shared.heightIn,
        edgeIn: shared.edgeIn,
        showArtwork: false,
        formatInches,
        letterOffset: lidLetterOffset,
      })
    : [];

  function anchorLabel(controls) {
    const parts = [];
    if (controls.centerHorizontal) parts.push("horizontal center");
    if (controls.centerVertical) parts.push("vertical center");
    return parts.length ? parts.join(" + ") : "bottom-right";
  }

  const overviewPlans = [];
  if (CutPlans && typeof CutPlans.buildPatternOverviewSvg === "function") {
    overviewPlans.push({
      letter: "base-overview",
      part: "Base",
      role: "Full box base layout — same cardboard sheets and net as the Box Base canvas preview.",
      isOverview: true,
      svg: CutPlans.buildPatternOverviewSvg({
        part: "Base",
        sheets: baseSheets,
        outerW: shared.outerW,
        outerH: shared.outerH,
        wallDepth: shared.wallDepth,
        patternW: shared.patternW,
        patternH: shared.patternH,
        artworkW: shared.widthIn,
        artworkH: shared.heightIn,
        edgeIn: shared.edgeIn,
        showArtwork: true,
        showSheetLetters: true,
        formatInches,
        explanation:
          "This overview matches the Box Base canvas: every cardboard sheet in red, " +
          "with the cutting net on top. Solid lines are cuts; dashed lines are folds. " +
          "Gray dotted artwork marks where the piece sits inside the floor panel.",
      }),
    });
    overviewPlans.push({
      letter: "lid-overview",
      part: "Lid",
      role: "Full box lid layout — same cardboard sheets and net as the Box Lid canvas preview.",
      isOverview: true,
      svg: CutPlans.buildPatternOverviewSvg({
        part: "Lid",
        sheets: lidSheets,
        outerW: lidGeom.outerW,
        outerH: lidGeom.outerH,
        wallDepth: lidGeom.wallDepth,
        patternW: lidGeom.patternW,
        patternH: lidGeom.patternH,
        artworkW: shared.widthIn,
        artworkH: shared.heightIn,
        edgeIn: shared.edgeIn,
        showArtwork: false,
        showSheetLetters: true,
        formatInches,
        explanation:
          "This overview matches the Box Lid canvas: every cardboard sheet in red, " +
          "with the lid cutting net on top. Lid panels are expanded for cardboard thickness so the lid fits over the base walls.",
      }),
    });
  }

  const infoLines = [
    "Box & artwork information",
    "",
    "Box type: Lid & Base",
    `Artwork: ${formatInches(shared.widthIn)} × ${formatInches(shared.heightIn)} × ${formatInches(shared.depthIn)}`,
    `Edge padding: ${formatInches(shared.edgeIn)}`,
    `Front padding: ${formatInches(shared.frontIn)}`,
    `Back padding: ${formatInches(shared.backIn)}`,
    `Cardboard thickness: ${formatDimValue(shared.thicknessIn, 64)}`,
    `Sheet size: ${formatInches(shared.sheetW)} × ${formatInches(shared.sheetH)}`,
    "",
    `Base orientation: ${baseControls.override ? "manual" : "automatic"} → ${baseLayout.baseOrientation || baseLayout.orientation}`,
    `Base sheet anchor: ${anchorLabel(baseControls)}`,
    `Base fit: ${layoutLabel(baseLayout)}`,
    `Base cut sheets: ${basePlans.map((p) => p.letter).join(", ") || "—"}`,
    "",
    `Lid orientation: ${lidLayoutLocked ? "locked to base" : lidControls.override ? "manual" : "automatic"} → ${lidLayout.baseOrientation || lidLayout.orientation}`,
    `Lid sheet anchor: ${anchorLabel(lidControls)}`,
    `Lid fit: ${layoutLabel(lidLayout)}`,
    `Lid cut sheets: ${lidPlans.map((p) => p.letter).join(", ") || "—"}`,
    "",
    `Sheet cut guides: ${basePlans.length + lidPlans.length} page${basePlans.length + lidPlans.length === 1 ? "" : "s"}`,
    "Overview pages show the full base and lid patterns from the canvas previews.",
    "Cut on solid lines. Crease on dashed fold lines. Red/black double border is the cardboard sheet edge.",
  ];

  const infoPlan =
    CutPlans && typeof CutPlans.buildInfoSheetSvg === "function"
      ? {
          letter: "info",
          part: "Info",
          role: "Box and artwork information for this cutting plan.",
          isInfo: true,
          isCover: true,
          svg: CutPlans.buildInfoSheetSvg(infoLines),
        }
      : null;

  // Sheet guides first, then full-pattern overviews, info sheet last.
  const allPlans = [...basePlans, ...lidPlans, ...overviewPlans];
  if (infoPlan) allPlans.push(infoPlan);
  renderCutPlans(allPlans);

  output.hidden = false;
});


const INFO_COPY = {
  artworkWidth: "Width of the artwork face, left to right, before edge padding is added.",
  artworkHeight: "Height of the artwork face, top to bottom, before edge padding is added.",
  artworkDepth: "How deep the artwork sits front-to-back. This sets the side-wall flap depth together with front and back padding.",
  inchFormat: "Choose decimal inches or imperial fractions for on-screen labels. Fraction mode rounds artwork sizes to the nearest 1/32 inch and thickness to 1/64 inch.",
  edgePadding: "Extra cardboard around the artwork on all four sides of the floor (or lid top) panel.",
  frontPadding: "Padding added in front of the artwork. It increases the wall flap depth with artwork depth and back padding.",
  backPadding: "Padding added behind the artwork. It increases the wall flap depth with artwork depth and front padding.",
  cardboardThickness: "Thickness of the cardboard stock. Used when expanding the lid so it fits cleanly over the base.",
  sheetSize: "Size of each cardboard sheet you will cut from. Lock keeps the common 48 by 96 inch stock.",
  baseLayout: "Controls how sheets are arranged under the box base cutting pattern.",
  lidLayout: "Controls how sheets are arranged under the box lid. When locked, the lid mirrors the base layout.",
  optimizePerp: "Allows leftover bands to use sheets turned the other way when that packs the pattern more efficiently.",
  overrideOrient: "Force every sheet into horizontal or vertical orientation instead of letting BoxBot choose.",
  centerH: "Shift the sheet grid so leftover cardboard is balanced left and right instead of stacked to one side.",
  centerV: "Shift the sheet grid so leftover cardboard is balanced top and bottom instead of stacked to one side.",
  showSheetDims: "Draw red dimension labels for one cardboard sheet on the preview.",
  showLetters: "Label each cardboard sheet with a letter that matches the cut-guide pages.",
  sheetLock: "Lock keeps the cardboard sheet size fixed at the common stock size. Unlock only when you need to cut from a different sheet size.",
  lidLock: "When locked, the lid uses the same sheet layout settings as the box base. Unlock to arrange lid sheets independently.",
};

function infoTitleForKey(key) {
  const map = {
    artworkWidth: "Artwork width",
    artworkHeight: "Artwork height",
    artworkDepth: "Artwork depth",
    inchFormat: "Inch display",
    edgePadding: "Edge padding",
    frontPadding: "Front padding",
    backPadding: "Back padding",
    cardboardThickness: "Cardboard thickness",
    sheetSize: "Cardboard sheet",
    baseLayout: "Box Base layout",
    lidLayout: "Box Lid layout",
    optimizePerp: "Perpendicular sheets",
    overrideOrient: "Orientation override",
    centerH: "Center horizontally",
    centerV: "Center vertically",
    showSheetDims: "Sheet dimensions",
    showLetters: "Sheet letters",
    sheetLock: "Sheet size lock",
    lidLock: "Lid layout lock",
  };
  return map[key] || "Info";
}

function openInfoModal(key) {
  if (!infoModal) return;
  const body = INFO_COPY[key];
  if (!body) return;
  if (infoModalTitle) infoModalTitle.textContent = infoTitleForKey(key);
  if (infoModalBody) infoModalBody.textContent = body;
  infoModal.hidden = false;
}

function closeInfoModal() {
  if (infoModal) infoModal.hidden = true;
}

function setFormOpen(open) {
  document.body.classList.toggle("form-open", open);
  if (menuToggle) menuToggle.setAttribute("aria-expanded", String(open));
  if (formBackdrop) formBackdrop.hidden = !open;
}

function closeFormDrawer() {
  setFormOpen(false);
}

if (menuToggle) {
  menuToggle.addEventListener("click", () => {
    setFormOpen(!document.body.classList.contains("form-open"));
  });
}
if (formBackdrop) {
  formBackdrop.addEventListener("click", closeFormDrawer);
}
form?.addEventListener("submit", () => closeFormDrawer());

document.querySelectorAll(".info-btn").forEach((btn) => {
  const key = btn.dataset.info;
  btn.addEventListener("mouseenter", () => {
    if (!infoTooltip || !INFO_COPY[key]) return;
    infoTooltip.hidden = false;
    infoTooltip.textContent = INFO_COPY[key];
    const rect = btn.getBoundingClientRect();
    const tipW = infoTooltip.offsetWidth || 200;
    const left = Math.min(window.innerWidth - tipW - 8, Math.max(8, rect.left));
    const top = Math.min(window.innerHeight - 8, rect.bottom + 8);
    infoTooltip.style.left = `${left}px`;
    infoTooltip.style.top = `${top}px`;
  });
  btn.addEventListener("mouseleave", () => {
    if (infoTooltip) infoTooltip.hidden = true;
  });
  btn.addEventListener("focus", () => {
    if (!infoTooltip || !INFO_COPY[key]) return;
    infoTooltip.hidden = false;
    infoTooltip.textContent = INFO_COPY[key];
  });
  btn.addEventListener("blur", () => {
    if (infoTooltip) infoTooltip.hidden = true;
  });
  btn.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (infoTooltip) infoTooltip.hidden = true;
    openInfoModal(key);
  });
});

if (infoModalClose) infoModalClose.addEventListener("click", closeInfoModal);
if (infoModal) {
  infoModal.addEventListener("click", (event) => {
    if (event.target === infoModal) closeInfoModal();
  });
}

if (downloadCutPlansBtn) {
  downloadCutPlansBtn.addEventListener("click", async () => {
    if (!window.CutPlans || !latestCutPlans.length) return;
    downloadCutPlansBtn.disabled = true;
    try {
      await window.CutPlans.downloadCutPlansPdf(latestCutPlans);
    } catch (err) {
      console.error(err);
      alert(err.message || "Could not export cut plans.");
    } finally {
      downloadCutPlansBtn.disabled = false;
    }
  });
}

if (cutPlanPrevBtn) {
  cutPlanPrevBtn.addEventListener("click", () => showCutPlanAt(cutPlanIndex - 1));
}
if (cutPlanNextBtn) {
  cutPlanNextBtn.addEventListener("click", () => showCutPlanAt(cutPlanIndex + 1));
}
if (cutPlanStage) {
  cutPlanStage.addEventListener("click", openCutPlanModal);
}
if (cutPlanModalClose) {
  cutPlanModalClose.addEventListener("click", closeCutPlanModal);
}
if (cutPlanModalPrev) {
  cutPlanModalPrev.addEventListener("click", () => showCutPlanAt(cutPlanIndex - 1));
}
if (cutPlanModalNext) {
  cutPlanModalNext.addEventListener("click", () => showCutPlanAt(cutPlanIndex + 1));
}

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    if (infoModal && !infoModal.hidden) {
      closeInfoModal();
      return;
    }
    if (document.body.classList.contains("form-open")) {
      closeFormDrawer();
      return;
    }
    if (cutPlanModal && !cutPlanModal.hidden) closeCutPlanModal();
    return;
  }
  if (!cutPlanModal || cutPlanModal.hidden) return;
  if (event.key === "ArrowLeft") showCutPlanAt(cutPlanIndex - 1);
  if (event.key === "ArrowRight") showCutPlanAt(cutPlanIndex + 1);
});

form.addEventListener("reset", () => {
  requestAnimationFrame(() => {
    form.elements.cardboardThickness.value = DEFAULT_THICKNESS;
    ["artworkWidth", "artworkHeight", "artworkDepth"].forEach((name) => {
      const input = form.elements[name];
      if (input?.dataset?.defaultMax) input.max = input.dataset.defaultMax;
    });
    sliderNames.forEach(syncSlider);
    sheetWidthInput.value = DEFAULT_SHEET_WIDTH;
    sheetHeightInput.value = DEFAULT_SHEET_HEIGHT;
    setSheetLocked(true);
    form.elements.boxType.value = "bottom-lid";
    form.elements.inchFormat.value = "decimal";
    resetPartLayoutControls("base");
    resetPartLayoutControls("lid");
    if (form.elements.showSheetLetters) {
      form.elements.showSheetLetters.checked = true;
    }
    setLidLayoutLocked(true);
    syncOrientationOverride("base");
    syncOrientationOverride("lid");
  });
  output.hidden = true;
  latestCutPlans = [];
  cutPlanIndex = 0;
  closeCutPlanModal();
  if (cutPlanViewer) cutPlanViewer.hidden = true;
  if (cutPlanStage) cutPlanStage.innerHTML = "";
  if (downloadCutPlansBtn) downloadCutPlansBtn.hidden = true;
  if (cutPlansNote) {
    cutPlansNote.hidden = false;
    cutPlansNote.textContent = "Printable diagrams will appear here.";
  }
});

window.addEventListener("resize", drawPreview);

setSheetLocked(true);
setLidLayoutLocked(true);
syncOrientationOverride("base");
syncOrientationOverride("lid");
