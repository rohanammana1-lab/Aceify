// Run: node tests/test_gpa.js   (checks the engine against the official FISD weight table)
const assert = require("assert");
const G = require("../frontend/gpa.js");

// Official table rows (FISD 2026-27 Academic Guide, "Course Grade Weights for GPA Calculation")
const table = { 100: [6.0, 5.5, 5.0], 97: [5.7, 5.2, 4.7], 95: [5.5, 5.0, 4.5], 90: [5.0, 4.5, 4.0],
  89: [4.9, 4.4, 3.9], 85: [4.5, 4.0, 3.5], 80: [4.0, 3.5, 3.0], 75: [3.5, 3.0, 2.5], 70: [3.0, 2.5, 2.0] };
for (const [g, [t3, t2, t1]] of Object.entries(table)) {
  assert.strictEqual(G.weightedPoints(+g, 3), t3, `t3 ${g}`);
  assert.strictEqual(G.weightedPoints(+g, 2), t2, `t2 ${g}`);
  assert.strictEqual(G.weightedPoints(+g, 1), t1, `t1 ${g}`);
}
assert.strictEqual(G.weightedPoints(69, 3), 0);
assert.strictEqual(G.weightedPoints(89.5, 1), 4.0);      // rounds up to 90
assert.strictEqual(G.weightedPoints(104, 3), 6.0);       // extra credit capped at 100
assert.deepStrictEqual([90, 89, 80, 79, 70, 69].map(G.unweightedPoints), [4, 3, 3, 2, 2, 0]);
assert.strictEqual(G.letter(89.5), "A"); assert.strictEqual(G.letter(69), "F");

// tiers
assert.strictEqual(G.guessTier("AP Biology", 2030), 3);
assert.strictEqual(G.guessTier("GT Humanities/Eng 1 Adv", 2030), 2);
assert.strictEqual(G.guessTier("Algebra 2 Adv", 2030), 2);
assert.strictEqual(G.guessTier("Biology", 2030), 1);
assert.strictEqual(G.guessTier("Dual Credit English", 2030), 3);
assert.strictEqual(G.guessTier("Dual Credit English", 2027), 2);
assert.strictEqual(G.guessTier("Athletics", 2030), 1);

// class of: 9th grader in fall 2026 -> 2030; 12th grader -> 2027
assert.strictEqual(G.classOf("", "9", new Date(2026, 10, 18)), 2030);
assert.strictEqual(G.classOf("", "12", new Date(2026, 10, 18)), 2027);
assert.strictEqual(G.classOf("2029", "9"), 2029);

// FISD example (WebGrades GPA guide): AP 97, Adv 92, Eng1 88, Tennis 100, 0.5 credit each
const rows = [{ grade: 97, tier: 3 }, { grade: 92, tier: 2 }, { grade: 88, tier: 1 }, { grade: 100, tier: 1 }]
  .map(r => ({ ...r, credit: 0.5 }));
const r = G.gpa(rows);
assert.strictEqual(r.weighted, 4.8 + 0 === 4.8 ? r.weighted : 0);
console.log("weighted", r.weighted, "unweighted", r.unweighted);
assert.ok(Math.abs(r.weighted - (5.7 + 4.7 + 3.8 + 5.0) / 4) < 1e-9);
assert.ok(Math.abs(r.unweighted - (4 + 4 + 3 + 4) / 4) < 1e-9);
assert.deepStrictEqual(G.gpa([]), { weighted: null, unweighted: null, credits: 0 });
// 2-credit course counts twice
assert.strictEqual(G.gpa([{ grade: 100, tier: 1, credit: 1 }, { grade: 90, tier: 1, credit: 0.5 }]).weighted, Math.round((5.0 + 4.0 * 0.5) / 1.5 * 10000) / 10000);
console.log("gpa engine tests passed");
