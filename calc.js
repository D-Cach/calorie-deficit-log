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

// Looks up a saved food by name, case- and whitespace-insensitive — the
// "have we already learned this food's nutrition?" check.
function findFood(foods, name) {
  const key = name.trim().toLowerCase();
  return foods.find(function (f) { return f.name.trim().toLowerCase() === key; }) || null;
}

// Consecutive days, counting back from todayStr, that were both logged and at
// or under the calorie target. `totals` is a { 'YYYY-MM-DD': calories } map.
// An empty today doesn't break the streak — it's still in progress, so the
// count starts from yesterday in that case. A while loop (not map/reduce)
// because it has to stop at the first day that ends the streak.
function calculateStreak(totals, dailyTarget, todayStr) {
  const cursor = new Date(todayStr + 'T00:00:00');
  if (!totals[formatDate(cursor)]) {
    cursor.setDate(cursor.getDate() - 1);
  }
  let streak = 0;
  while (true) {
    const total = totals[formatDate(cursor)];
    if (total === undefined || total > dailyTarget) { break; }
    streak += 1;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}

// Aggregates one window of dates: average calories over the days that were
// actually logged (gaps don't count as zero-calorie days), how many days that
// was, the mean of any weigh-ins whose date falls inside the window, and the
// average's distance from the target. `totals` is a { date: calories } map.
function weekStats(dates, totals, weighIns, dailyTarget) {
  const loggedDays = dates.filter(function (d) { return totals[d] > 0; });
  const avgCal = loggedDays.length
    ? Math.round(loggedDays.reduce(function (s, d) { return s + totals[d]; }, 0) / loggedDays.length)
    : null;
  const from = dates[0];
  const to = dates[dates.length - 1];
  const winWeighIns = weighIns.filter(function (w) { return w.date >= from && w.date <= to; });
  const avgWeight = winWeighIns.length
    ? winWeighIns.reduce(function (s, w) { return s + w.weight; }, 0) / winWeighIns.length
    : null;
  return {
    avgCal: avgCal,
    loggedCount: loggedDays.length,
    avgWeight: avgWeight,
    vsTarget: avgCal === null ? null : avgCal - dailyTarget
  };
}

// Brings older saved entries up to the current shape: give every entry an id
// and a date, and 0-fill weight/macros on pre-weight-era entries. Returns a
// NEW array of NEW objects (the input is left untouched) plus a `changed` flag
// so the caller only re-saves when something actually moved.
//
// The `!entry.isMeal` guard is load-bearing: a meal entry legitimately has no
// top-level weight (its components carry their own), so without it every meal
// would look like a pre-weight legacy entry and have its real macros
// overwritten with zeros on every page load.
function migrateEntries(entries, todayStr) {
  let changed = false;
  const migrated = entries.map(function (raw) {
    const entry = Object.assign({}, raw);
    if (!entry.id) { entry.id = crypto.randomUUID(); changed = true; }
    if (!entry.date) { entry.date = todayStr; changed = true; }
    if (!entry.isMeal && entry.weight === undefined) {
      entry.weight = 0;
      entry.unit = 'g';
      entry.protein = 0;
      entry.carbs = 0;
      entry.fat = 0;
      changed = true;
    }
    return entry;
  });
  return { entries: migrated, changed: changed };
}
