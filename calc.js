// calc.js — the app's pure calculation helpers, shared by index.html and the
// test suite (tests.html). Nothing in here touches the DOM or any app state:
// every function's result depends only on its arguments. That's exactly what
// makes them safe to unit-test in isolation, and why they live in their own
// file. Loaded as a plain <script> before the main app script, so these stay
// ordinary globals and every existing call site in index.html is unchanged.

const OZ_TO_G = 28.3495;

// 'YYYY-MM-DD' for a given Date, in local time — the one place this formatting
// happens, reused everywhere a date needs to become a string key.
function formatDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return year + '-' + month + '-' + day;
}

function round1(value) {
  return Math.round(value * 10) / 10;
}

function round2(value) {
  return Math.round(value * 100) / 100;
}

// Whole days from date string a to date string b (both 'YYYY-MM-DD'). Rounds,
// so a daylight-saving hour shift inside the span can't push it off by a day.
function daysBetweenDates(a, b) {
  const ms = new Date(b + 'T00:00:00').getTime() - new Date(a + 'T00:00:00').getTime();
  return Math.round(ms / 86400000);
}

// Scales a food's saved nutrition (per whatever amount it was recorded
// against — the label's serving size, not always 100) to whatever weight was
// actually logged. This is what makes the math automatic for any weight, not
// just one fixed amount. Foods saved before per-amount was editable default to
// 100 via the fallback. mL is treated 1:1 with grams (only 'oz' converts).
function calcNutrition(food, weight, unit) {
  const grams = unit === 'oz' ? weight * OZ_TO_G : weight;
  const ratio = grams / (food.perGrams || 100);
  return {
    calories: Math.round(food.caloriesPer100g * ratio),
    protein: round1(food.proteinPer100g * ratio),
    carbs: round1(food.carbsPer100g * ratio),
    fat: round1(food.fatPer100g * ratio)
  };
}

// Least-squares straight-line fit through {x, y} points. Returns the slope
// (y units per x unit), the intercept, and R² (0–1, how much of the spread in
// y the line actually explains — a low value means the points are mostly noise
// around the line, so the slope shouldn't be trusted). Returns null when
// there's nothing to fit: fewer than 2 points, or every point on the same x.
function linearFit(points) {
  const n = points.length;
  if (n < 2) { return null; }
  let sx = 0, sy = 0, sxx = 0, sxy = 0;
  points.forEach(function (p) {
    sx += p.x; sy += p.y; sxx += p.x * p.x; sxy += p.x * p.y;
  });
  const denom = n * sxx - sx * sx;
  if (denom === 0) { return null; } // every point on the same day
  const slope = (n * sxy - sx * sy) / denom;
  const intercept = (sy - slope * sx) / n;
  const meanY = sy / n;
  let ssTot = 0, ssRes = 0;
  points.forEach(function (p) {
    const pred = slope * p.x + intercept;
    ssTot += (p.y - meanY) * (p.y - meanY);
    ssRes += (p.y - pred) * (p.y - pred);
  });
  const r2 = ssTot === 0 ? 0 : 1 - ssRes / ssTot;
  return { slope: slope, intercept: intercept, r2: r2 };
}

// For each weigh-in, averages every weigh-in within the trailing 7 days up to
// and including that date — a real rolling average, not just one number for
// "the last 7 days." Smooths day-to-day water/sodium noise without discarding
// the raw points. Expects the input already sorted oldest-first.
function calculateRollingWeightAverage(sortedOldestFirst) {
  return sortedOldestFirst.map(function (weighIn) {
    const cutoff = new Date(weighIn.date + 'T00:00:00');
    cutoff.setDate(cutoff.getDate() - 6);
    const cutoffStr = formatDate(cutoff);

    const windowEntries = sortedOldestFirst.filter(function (w) {
      return w.date >= cutoffStr && w.date <= weighIn.date;
    });
    const sum = windowEntries.reduce(function (total, w) { return total + w.weight; }, 0);
    return sum / windowEntries.length;
  });
}
