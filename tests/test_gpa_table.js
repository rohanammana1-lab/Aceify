// Cross-checks the GPA engine against the OFFICIAL FISD table (parsed from research/fisd_gpa_policy_26-27_academic_guide.txt)
// for every grade 70-100 and every tier, plus rounding/unweighted/edge cases. Run: node tests/test_gpa_table.js
const fs = require("fs"), assert = require("assert"), path = require("path");
const G = require("../frontend/gpa.js");
const txt = fs.readFileSync(path.join(__dirname, "../research/fisd_gpa_policy_26-27_academic_guide.txt"), "utf8");
const rows = [...txt.matchAll(/^\s*(\d{2,3})\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*$/gm)].map(m => [+m[1], +m[2], +m[3], +m[4]]);
assert.strictEqual(rows.length, 31, "expected 31 table rows (100..70), got " + rows.length);
let n = 0;
for (const [g, t3, t2, t1] of rows) {
  for (const [tier, want] of [[3, t3], [2, t2], [1, t1]]) { assert.strictEqual(G.weightedPoints(g, tier), want, `grade ${g} tier ${tier}`); n++; }
}
for (let g = 0; g < 70; g++) for (const t of [1, 2, 3]) assert.strictEqual(G.weightedPoints(g, t), 0, `below 70: ${g}`);
const uw = g => (g >= 90 ? 4 : g >= 80 ? 3 : g >= 70 ? 2 : 0);
for (let g = 0; g <= 100; g++) assert.strictEqual(G.unweightedPoints(g), uw(g), "unweighted " + g);
// rounding: .5 rounds up, .49 rounds down
assert.strictEqual(G.weightedPoints(89.5, 1), 4.0); assert.strictEqual(G.weightedPoints(89.49, 1), 3.9);
assert.strictEqual(G.unweightedPoints(89.5), 4); assert.strictEqual(G.unweightedPoints(89.49), 3);
assert.strictEqual(G.unweightedPoints(69.5), 2);
// credit weighting (hand-computed): AP 95 (5.5) x1.0 + Reg 82 (3.2) x0.5 -> (5.5 + 1.6)/1.5 = 4.7333
assert.strictEqual(G.gpa([{ grade: 95, tier: 3, credit: 1 }, { grade: 82, tier: 1, credit: 0.5 }]).weighted, 4.7333);
console.log(`GPA table check passed: ${n} official table cells + ${3 * 70} below-70 cases + 101 unweighted cases`);
