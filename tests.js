// tests.js — assertions for the pure functions in calc.js.
//
// Run by opening tests.html (which loads calc.js, then this, then renders
// window.__testResults as pass/fail rows). No build step, no Node — the
// browser is the test runner.
//
// A test is just: arrange some inputs, call the function, assert on what comes
// back. When a real bug turns up in one of these functions, add a case here
// that would have caught it, so it can't quietly come back later.

(function () {
  const results = [];
  window.__testResults = results;

  function record(name, ok, detail) {
    results.push({ name: ok ? name : name + '  — ' + detail, ok: ok });
  }
  function eq(name, actual, expected) {
    record(name, actual === expected, 'got ' + JSON.stringify(actual) + ', want ' + JSON.stringify(expected));
  }
  // Numbers computed by floating-point math can't be compared with === (e.g.
  // 0.1 + 0.2 !== 0.3), so assert they're within a small tolerance instead.
  function close(name, actual, expected, tol) {
    const t = tol == null ? 1e-9 : tol;
    record(name, typeof actual === 'number' && Math.abs(actual - expected) <= t,
      'got ' + actual + ', want ' + expected + ' ±' + t);
  }
  function isNull(name, v) {
    record(name, v === null, 'got ' + JSON.stringify(v));
  }
  function ok(name, cond, detail) {
    record(name, !!cond, detail || 'expected truthy');
  }

  // ---------- formatDate ----------
  eq('formatDate zero-pads month and day', formatDate(new Date(2026, 0, 5)), '2026-01-05');
  eq('formatDate end of year', formatDate(new Date(2026, 11, 31)), '2026-12-31');

  // ---------- round1 / round2 ----------
  eq('round1 drops to one decimal', round1(1.049), 1);
  eq('round1 rounds half up', round1(2.25), 2.3);
  eq('round1 handles negatives', round1(-0.449), -0.4);
  eq('round2 tames a float artifact', round2(0.1 + 0.2), 0.3);
  eq('round2 leaves a clean value alone', round2(93.5), 93.5);

  // ---------- daysBetweenDates ----------
  eq('daysBetweenDates same day is 0', daysBetweenDates('2026-08-28', '2026-08-28'), 0);
  eq('daysBetweenDates one week', daysBetweenDates('2026-08-01', '2026-08-08'), 7);
  eq('daysBetweenDates across a month boundary', daysBetweenDates('2026-01-30', '2026-02-02'), 3);
  eq('daysBetweenDates across a DST change stays whole', daysBetweenDates('2026-03-01', '2026-03-31'), 30);
  eq('daysBetweenDates goes negative when b precedes a', daysBetweenDates('2026-08-10', '2026-08-03'), -7);

  // ---------- calcNutrition ----------
  const chicken = { caloriesPer100g: 165, proteinPer100g: 31, carbsPer100g: 0, fatPer100g: 3.6, perGrams: 100 };
  const g150 = calcNutrition(chicken, 150, 'g');
  eq('calcNutrition scales calories by weight', g150.calories, 248);        // round(165 * 1.5)
  close('calcNutrition scales protein by weight', g150.protein, 46.5, 1e-9);
  eq('calcNutrition converts oz to grams', calcNutrition(chicken, 4, 'oz').calories, 187); // round(165 * 4*28.3495/100)
  eq('calcNutrition treats mL the same as g',
    calcNutrition(chicken, 200, 'mL').calories, calcNutrition(chicken, 200, 'g').calories);

  const snack = { caloriesPer100g: 500, proteinPer100g: 8, carbsPer100g: 60, fatPer100g: 25, perGrams: 30 };
  eq('calcNutrition honours a non-100 basis (full serving)', calcNutrition(snack, 30, 'g').calories, 500);
  eq('calcNutrition honours a non-100 basis (half serving)', calcNutrition(snack, 15, 'g').calories, 250);

  const legacyFood = { caloriesPer100g: 100, proteinPer100g: 0, carbsPer100g: 0, fatPer100g: 0 }; // no perGrams
  eq('calcNutrition defaults a missing basis to 100', calcNutrition(legacyFood, 250, 'g').calories, 250);

  // ---------- linearFit ----------
  isNull('linearFit needs at least 2 points', linearFit([{ x: 0, y: 5 }]));
  isNull('linearFit returns null when every x is equal',
    linearFit([{ x: 3, y: 1 }, { x: 3, y: 2 }, { x: 3, y: 9 }]));

  const cleanLine = linearFit([{ x: 0, y: 10 }, { x: 1, y: 8 }, { x: 2, y: 6 }, { x: 3, y: 4 }]); // y = 10 - 2x
  close('linearFit recovers the slope of a clean line', cleanLine.slope, -2, 1e-9);
  close('linearFit recovers the intercept of a clean line', cleanLine.intercept, 10, 1e-9);
  close('linearFit R² is 1 for a perfect line', cleanLine.r2, 1, 1e-9);

  const noisyLine = linearFit([{ x: 0, y: 10 }, { x: 1, y: 9 }, { x: 2, y: 11 }, { x: 3, y: 8 }]);
  ok('linearFit R² is between 0 and 1 for noisy data', noisyLine.r2 >= 0 && noisyLine.r2 < 1,
    'got ' + noisyLine.r2);

  // ---------- calculateRollingWeightAverage ----------
  // Points more than a week apart never share a 7-day window, so each one's
  // rolling average is just its own value.
  const spreadOut = calculateRollingWeightAverage([
    { date: '2026-08-01', weight: 95 },
    { date: '2026-08-10', weight: 94 },
    { date: '2026-08-20', weight: 93 }
  ]);
  close('rolling avg of an isolated first point is its raw value', spreadOut[0], 95, 1e-9);
  close('rolling avg of an isolated last point is its raw value', spreadOut[2], 93, 1e-9);

  // Two points one day apart: the later one averages both; the earlier one is
  // still isolated (the very first point is 7 days before it).
  const withACluster = calculateRollingWeightAverage([
    { date: '2026-08-01', weight: 96 },
    { date: '2026-08-08', weight: 94 },
    { date: '2026-08-09', weight: 92 }
  ]);
  close('rolling avg: Aug 1 has nothing else in its window', withACluster[0], 96, 1e-9);
  close('rolling avg: Aug 8 window excludes Aug 1 (7 days back)', withACluster[1], 94, 1e-9);
  close('rolling avg: Aug 9 window includes Aug 8 and Aug 9', withACluster[2], 93, 1e-9);
})();
