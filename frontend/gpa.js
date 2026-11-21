/* Frisco ISD GPA engine. Source: FISD 2026-27 High School Academic Guide, "Grade Point Average" and
   "Course Grade Weights for GPA Calculation" (copy in research/). Rules implemented:
   - Grade points come from SEMESTER grades of high-school-credit courses.
   - Weighted ("GPA for Rank"): tier max (I=5.0, II=5.5, III=6.0) minus 0.1 per point below 100; below 70 = 0.
   - Unweighted: 90-100=4.0, 80-89=3.0, 70-79=2.0, 0-69=0.
   - Both are credit-weighted averages shown to 3 decimals; a 2-credit course counts twice.
   - Tier III: AP, IB (+ dual credit MATH 2415 / 2320, CS III Adv, and ALL dual credit for class of 2030+).
     Tier II: Advanced ("Adv") courses, Independent Study & Mentorship, Academic Decathlon, PLTW engineering,
     dual credit for classes before 2030. Tier I: everything else.
   - Excluded: Credit by Exam / Exam for Acceleration, pass/fail, local credit.
   Semester grades round half-up to whole numbers (89.5 -> 90). */
(function (root) {
  const TIER_MAX = { 1: 5.0, 2: 5.5, 3: 6.0 };
  const TIER_NAME = { 1: "Tier I (5.0)", 2: "Tier II (5.5)", 3: "Tier III (6.0)" };

  function guessTier(name, classOf) {
    const n = " " + String(name || "").toLowerCase().replace(/[^a-z0-9/ ]+/g, " ") + " ";
    if (/\b(ap|ib)\b|advanced placement/.test(n)) return 3;
    if (/calculus iii|calc iii|differential equation|multivariable|math 2415|math 2320|computer science iii adv|\bcs iii adv/.test(n)) return 3;
    if (/\b(dual|dc)\b|dual credit/.test(n)) return (classOf && classOf >= 2030) ? 3 : 2;
    if (/\badv\b|\badvanced\b|\bpre ?ap\b|independent study|mentorship|academic decathlon|\bpltw\b|project lead|civil engineering|aerospace engineering|digital electronics|engineering design/.test(n)) return 2;
    return 1;
  }

  const roundGrade = g => Math.floor(Number(g) + 0.5);

  function weightedPoints(grade, tier) {
    if (grade == null || isNaN(grade)) return null;
    const g = Math.min(100, roundGrade(grade));
    if (g < 70) return 0;
    return Math.round((TIER_MAX[tier] - 0.1 * (100 - g)) * 10) / 10;
  }
  function unweightedPoints(grade) {
    if (grade == null || isNaN(grade)) return null;
    const g = roundGrade(grade);
    return g >= 90 ? 4 : g >= 80 ? 3 : g >= 70 ? 2 : 0;
  }

  /* rows: [{grade, tier, credit, exclude?}] -> {weighted, unweighted, credits} (4-decimal) */
  function gpa(rows) {
    let wp = 0, up = 0, cr = 0;
    for (const r of rows) {
      if (r.exclude || r.grade == null || isNaN(r.grade) || !(r.credit > 0)) continue;
      wp += weightedPoints(r.grade, r.tier) * r.credit;
      up += unweightedPoints(r.grade) * r.credit;
      cr += r.credit;
    }
    if (cr === 0) return { weighted: null, unweighted: null, credits: 0 };
    const f = x => Math.round(x / cr * 10000) / 10000;
    return { weighted: f(wp), unweighted: f(up), credits: cr };
  }

  /* Letter per FISD grading system: A 90-100, B 80-89, C 70-79, F below 70 (no D). */
  const letter = p => p == null ? "N" : roundGrade(p) >= 90 ? "A" : roundGrade(p) >= 80 ? "B" : roundGrade(p) >= 70 ? "C" : "F";

  /* Class of (graduation year) from HAC cohort year, else from grade level + school-year start. */
  function classOf(cohort, gradeLevel, today) {
    const c = parseInt(cohort, 10);
    if (c >= 2020 && c <= 2045) return c;
    const g = parseInt(gradeLevel, 10);
    if (g >= 6 && g <= 12) {
      const d = today || new Date();
      const startYear = d.getMonth() >= 6 ? d.getFullYear() : d.getFullYear() - 1; // school year starts ~Aug
      return startYear + (13 - g);
    }
    return null;
  }

  const api = { TIER_MAX, TIER_NAME, guessTier, weightedPoints, unweightedPoints, gpa, letter, classOf, roundGrade };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.FisdGPA = api;
})(typeof window !== "undefined" ? window : globalThis);
