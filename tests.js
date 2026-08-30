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

  // ---------- findFood ----------
  const library = [
    { name: 'Chicken breast', caloriesPer100g: 165 },
    { name: 'White rice', caloriesPer100g: 130 }
  ];
  ok('findFood matches ignoring case and surrounding space',
    findFood(library, '  chicken BREAST ') === library[0], 'did not match');
  eq('findFood returns null when nothing matches', findFood(library, 'tofu'), null);
  eq('findFood on an empty library is null', findFood([], 'anything'), null);

  // ---------- calculateStreak ----------
  const t = {
    '2026-08-28': 1700, // today, under target
    '2026-08-27': 1800,
    '2026-08-26': 1750,
    '2026-08-25': 2200, // over target — ends the streak here
    '2026-08-24': 1600
  };
  eq('calculateStreak counts consecutive under-target days', calculateStreak(t, 2000, '2026-08-28', []), 3);
  eq('calculateStreak stops at an over-target day',
    calculateStreak({ '2026-08-28': 2500, '2026-08-27': 1500 }, 2000, '2026-08-28', []), 0);
  eq('calculateStreak: an empty today does not break the run — count from yesterday',
    calculateStreak({ '2026-08-27': 1500, '2026-08-26': 1500 }, 2000, '2026-08-28', []), 2);
  eq('calculateStreak stops at the first unlogged gap',
    calculateStreak({ '2026-08-28': 1500, '2026-08-26': 1500 }, 2000, '2026-08-28', []), 1);
  eq('calculateStreak: a day exactly on target still counts',
    calculateStreak({ '2026-08-28': 2000, '2026-08-27': 2000 }, 2000, '2026-08-28', []), 2);
  // cheat days: always count as a day in the streak, never break it
  eq('calculateStreak: a cheat day mid-run keeps it ticking and counts (+1)',
    calculateStreak({ '2026-08-28': 1500, '2026-08-27': 3500, '2026-08-26': 1500 }, 2000, '2026-08-28', ['2026-08-27']), 3);
  eq('calculateStreak: an over-target cheat day does not break the run',
    calculateStreak({ '2026-08-28': 3000, '2026-08-27': 1500 }, 2000, '2026-08-28', ['2026-08-28']), 2);
  eq('calculateStreak: a cheat day with nothing logged still counts',
    calculateStreak({ '2026-08-28': 1500, '2026-08-26': 1500 }, 2000, '2026-08-28', ['2026-08-27']), 3);
  eq('calculateStreak: an empty non-cheat today still does not break it (with cheat days present)',
    calculateStreak({ '2026-08-27': 1500, '2026-08-26': 1500 }, 2000, '2026-08-28', ['2026-08-20']), 2);
  eq('calculateStreak: an empty cheat-day today counts as day 1',
    calculateStreak({ '2026-08-27': 1500 }, 2000, '2026-08-28', ['2026-08-28']), 2);

  // ---------- weekStats ----------
  const week = ['2026-08-01', '2026-08-02', '2026-08-03', '2026-08-04', '2026-08-05', '2026-08-06', '2026-08-07'];
  const wsTotals = { '2026-08-01': 1800, '2026-08-03': 2000, '2026-08-05': 2200 }; // 3 of 7 logged
  const wsWeighIns = [
    { date: '2026-08-02', weight: 90 },
    { date: '2026-08-06', weight: 89 },
    { date: '2026-07-31', weight: 99 } // outside the window — must be ignored
  ];
  const ws = weekStats(week, wsTotals, wsWeighIns, 2000);
  eq('weekStats averages only the logged days', ws.avgCal, 2000);        // (1800+2000+2200)/3
  eq('weekStats counts the logged days', ws.loggedCount, 3);
  close('weekStats averages only in-window weigh-ins', ws.avgWeight, 89.5, 1e-9);
  eq('weekStats vsTarget is avg minus target', ws.vsTarget, 0);
  const wsEmpty = weekStats(week, {}, [], 2000);
  eq('weekStats avgCal is null with nothing logged', wsEmpty.avgCal, null);
  eq('weekStats avgWeight is null with no weigh-ins', wsEmpty.avgWeight, null);
  eq('weekStats vsTarget is null when avgCal is null', wsEmpty.vsTarget, null);

  // ---------- migrateEntries ----------
  // Regression for the v1.20 bug: a meal has no top-level weight, so without
  // the isMeal guard migration would zero out its real macros on every load.
  const meal = { id: 'm1', date: '2026-08-10', isMeal: true, calories: 600, protein: 40, carbs: 50, fat: 20,
    components: [{ name: 'Rice', weight: 200 }] };
  const legacy = { calories: 250 }; // pre-weight era: no id, no date, no weight
  const out = migrateEntries([meal, legacy], '2026-08-28');
  ok('migrateEntries leaves a complete meal entry untouched',
    out.entries[0].weight === undefined && out.entries[0].protein === 40 && out.entries[0].carbs === 50,
    JSON.stringify(out.entries[0]));
  eq('migrateEntries 0-fills a genuine legacy entry (weight)', out.entries[1].weight, 0);
  eq('migrateEntries 0-fills a genuine legacy entry (protein)', out.entries[1].protein, 0);
  eq('migrateEntries fills a missing date with today', out.entries[1].date, '2026-08-28');
  ok('migrateEntries gives a missing id a string', typeof out.entries[1].id === 'string' && out.entries[1].id.length > 0,
    'id was ' + JSON.stringify(out.entries[1].id));
  eq('migrateEntries reports it changed something', out.changed, true);
  ok('migrateEntries does not mutate its input',
    meal.date === '2026-08-10' && legacy.weight === undefined && legacy.id === undefined,
    'input was mutated');
  const clean = [{ id: 'a', date: '2026-08-01', weight: 100, unit: 'g', calories: 100, protein: 1, carbs: 1, fat: 1 }];
  eq('migrateEntries reports no change when nothing needs migrating',
    migrateEntries(clean, '2026-08-28').changed, false);

  // ---------- totalsByDate ----------
  const tbdEntries = [
    { date: '2026-08-01', calories: 500 },
    { date: '2026-08-01', calories: 300 },        // same day — should add
    { date: '2026-08-02', calories: 700 },
    { date: '2026-08-03', isMeal: true, calories: 850 } // a meal counts too
  ];
  const tbd = totalsByDate(tbdEntries);
  eq('totalsByDate sums entries on the same date', tbd['2026-08-01'], 800);
  eq('totalsByDate keeps separate dates separate', tbd['2026-08-02'], 700);
  eq('totalsByDate counts a meal by its own calories', tbd['2026-08-03'], 850);
  eq('totalsByDate of nothing is an empty object', Object.keys(totalsByDate([])).length, 0);

  // ---------- groupAverages ----------
  const gaTotals = {
    '2026-07-15': 1800, '2026-07-20': 2000,  // July: 2 logged days
    '2026-08-01': 1600                        // August: 1 logged day
  };
  const byMonth = groupAverages(gaTotals, monthKey);
  eq('groupAverages sums a month bucket', byMonth['2026-07'].total, 3800);
  eq('groupAverages counts days logged, not calendar days', byMonth['2026-07'].days, 2);
  eq('groupAverages buckets a second month separately', byMonth['2026-08'].days, 1);
  const byYear = groupAverages(gaTotals, yearKey);
  eq('groupAverages can bucket by year', byYear['2026'].total, 5400);
  eq('groupAverages by year counts every logged day', byYear['2026'].days, 3);

  // ---------- groupWeightAverages ----------
  const gwa = groupWeightAverages([
    { date: '2026-07-10', weight: 94 },
    { date: '2026-07-25', weight: 93 },
    { date: '2026-08-05', weight: 92 }
  ], monthKey);
  close('groupWeightAverages sums a month', gwa['2026-07'].total, 187, 1e-9);
  eq('groupWeightAverages counts weigh-ins in a month', gwa['2026-07'].count, 2);
  eq('groupWeightAverages buckets the next month apart', gwa['2026-08'].count, 1);

  // ---------- monthKey / yearKey ----------
  eq('monthKey takes YYYY-MM', monthKey('2026-08-28'), '2026-08');
  eq('yearKey takes YYYY', yearKey('2026-08-28'), '2026');

  // ---------- lastNDates ----------
  const l7 = lastNDates(7, '2026-08-28');
  eq('lastNDates returns exactly n dates', l7.length, 7);
  eq('lastNDates ends on todayStr', l7[6], '2026-08-28');
  eq('lastNDates is oldest-first', l7[0], '2026-08-22');
  eq('lastNDates second-to-last is the day before today', l7[5], '2026-08-27');
  const lMonth = lastNDates(5, '2026-03-02');
  eq('lastNDates crosses a month boundary correctly', lMonth[0], '2026-02-26');
  eq('lastNDates(1) is just today', lastNDates(1, '2026-08-28')[0], '2026-08-28');

  // ---------- getRecentFoods ----------
  const feed = [
    { name: 'Eggs', weight: 100, isMeal: false },
    { name: 'Coffee', weight: 250 },
    { name: 'Rice bowl', isMeal: true },       // meal — skipped
    { name: 'eggs', weight: 120 },             // newer 'Eggs', case-insensitive dupe
    { name: 'Toast', weight: 60 }
  ];
  const rf = getRecentFoods(feed, 5);
  eq('getRecentFoods walks newest-first', rf[0].name, 'Toast');
  eq('getRecentFoods de-dupes by name ignoring case (keeps the newest)', rf[1].name, 'eggs');
  ok('getRecentFoods skips meals', rf.every(function (e) { return !e.isMeal; }), 'a meal slipped through');
  eq('getRecentFoods returns 3 distinct non-meal foods here', rf.length, 3);
  eq('getRecentFoods respects the limit', getRecentFoods(feed, 1).length, 1);
  eq('getRecentFoods of nothing is empty', getRecentFoods([], 5).length, 0);
})();
