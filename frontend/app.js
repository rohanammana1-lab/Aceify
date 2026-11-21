/* Aceify — grades, GPA and agenda for Frisco ISD (Home Access Center). Vanilla JS, no build step. */
(function () {
  "use strict";
  const G = window.FisdGPA;
  const $ = s => document.querySelector(s);
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  /* ================= storage (this device only) ================= */
  const lsGet = (k, d) => { try { const v = localStorage.getItem("aceify_" + k); return v ? JSON.parse(v) : d; } catch { return d; } };
  const lsSet = (k, v) => { try { localStorage.setItem("aceify_" + k, JSON.stringify(v)); } catch { /* blocked */ } };
  const acctKey = () => { const a = S.me && S.me.accounts.find(x => x.id === S.me.active); return a ? (a.district + ":" + a.name).replace(/\W+/g, "_") : "none"; };
  const A = (k, d) => lsGet(acctKey() + "_" + k, d);
  const ASet = (k, v) => lsSet(acctKey() + "_" + k, v);
  const DEFAULTS = { theme: "light", accent: "", showGpa: false, showRecent: true, showMissing: true, notify: false, offline: false, autoRefresh: true, nomotion: false, lowblur: false, remember: true, sideCollapsed: false };
  const settings = () => Object.assign({}, DEFAULTS, lsGet("settings", {}));
  const setSetting = (k, v) => { const s = settings(); s[k] = v; lsSet("settings", s); applyLook(); };

  const S = { me: null, all: null, classes: [], transcript: null, registration: null, reportcard: null, ipr: null,
    view: "dashboard", q: null, open: new Set(), whatif: {}, hyp: {}, zeroMissing: false, updated: null, loading: false,
    pop: null, search: "", sort: "name", wk: 0, agendaMode: "week", day: null, agendaFilter: null, dashGrid: false, loginMsg: "", animate: false };

  /* ================= api ================= */
  async function api(path, opts) {
    const o = Object.assign({ credentials: "same-origin" }, opts || {});
    if (o.body) { o.method = "POST"; o.headers = { "Content-Type": "application/json", "X-Aceify": "1" }; }
    else if (o.method === "POST") o.headers = { "X-Aceify": "1" };
    const r = await fetch("/api/" + path, o);
    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
      if (r.status === 401 && path !== "login" && path !== "me") { S.loginMsg = j.detail || "Please sign in again."; S.me = null; S.all = null; boot.shell = false; render(); }
      throw new Error(j.detail || "Request failed");
    }
    return j;
  }
  function toast(t) { const d = document.createElement("div"); d.className = "toast"; d.textContent = t; document.body.appendChild(d); setTimeout(() => d.remove(), 2800); }

  /* ================= formatting ================= */
  const letter = p => G.letter(p);
  const num = p => p == null ? "—" : String(Math.round(p * 100) / 100);
  const pill = p => `<span class="pill ${letter(p)}">${p == null ? "N/A" : num(p) + "%"}${p == null ? "" : `<small>${letter(p)}</small>`}</span>`;
  const f3 = x => x == null ? "—" : x.toFixed(4);
  const ba = (before, after) => (before != null && after != null && f3(before) !== f3(after)) ? `<span class="mut" style="font-size:22px;font-weight:600">${f3(before)} →</span> ${f3(after)}` : f3(after);
  const titleCase = s => String(s || "").toLowerCase().replace(/(^|[\s,'-])([a-z])/g, (m, a, b) => a + b.toUpperCase());
  const abbr = c => { const w = String(c || "").split(/\s+/).filter(Boolean); return !w.length ? "" : (w.length <= 3 ? w.map(x => x[0]).join("") : w.slice(0, 2).map(x => x[0]).join("")).toUpperCase(); };
  const ago = ts => { const m = Math.round((Date.now() - ts) / 60000); return m < 1 ? "just now" : m < 60 ? m + "m ago" : m < 1440 ? Math.round(m / 60) + "h ago" : Math.round(m / 1440) + "d ago"; };
  const ckey = n => String(n || "").replace(/\bS[12]\b/g, "").replace(/\s+/g, " ").trim().toLowerCase();
  const isoDay = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

  /* ================= derived data ================= */
  const mps = () => (S.all && S.all.mps) || [];
  const qNum = (m, i) => { const n = parseInt(((m.label || "").match(/\d+/) || [])[0], 10); return n >= 1 && n <= 4 ? n : i + 1; };
  const mpOfQ = n => { const i = mps().findIndex((m, j) => qNum(m, j) === n); return i < 0 ? null : mps()[i].value; };
  const curMp = () => S.all && S.all.current;
  const curQ = () => { const i = mps().findIndex(m => m.value === curMp()); return i < 0 ? 1 : qNum(mps()[i], i); };
  const curSem = () => Math.ceil(curQ() / 2);
  const coursesOf = mp => (S.all && S.all.data[mp] && S.all.data[mp].courses) || [];
  const findCourse = (mp, key) => coursesOf(mp).find(c => ckey(c.name) === key);
  const classOf = () => G.classOf(S.registration && S.registration.cohort, S.registration && S.registration.grade);

  function courseList() {           // unique courses across the year, current quarter order first
    const seen = new Map();
    [curMp(), ...mps().map(m => m.value)].forEach(mp => coursesOf(mp).forEach(c => { const k = ckey(c.name); if (!seen.has(k)) seen.set(k, { key: k, name: c.name }); }));
    return [...seen.values()];
  }
  function reportGrade(key, q) {
    const rc = S.reportcard; if (!rc || !rc.rows) return null;
    const row = rc.rows.find(r => ckey(r.description || r.course) === key);
    return row ? parseFloat(row["q" + q]) || null : null;
  }
  const hacQ = (key, q) => {                    // HAC's own quarter grade for a course
    const mp = mpOfQ(q); const c = mp && findCourse(mp, key);
    return c && c.average != null ? c.average : reportGrade(key, q);
  };

  /* ---- what-if on assignments ---- */
  const wkey = (key, mp) => key + "|" + mp;
  function calcAvg(course, list) {
    const g = list.filter(a => a.score != null && a.max > 0 && !a.exempt);
    if (!g.length) return null;
    const w = {}; (course.categories || []).forEach(c => { if (c.weight != null) w[c.name.toLowerCase()] = c.weight; });
    if (Object.keys(w).length) {
      const by = {};
      g.forEach(a => { const k = (a.category || "").toLowerCase(); (by[k] ||= { p: 0, m: 0 }); by[k].p += a.score; by[k].m += a.max; });
      let n = 0, d = 0;
      for (const [k, v] of Object.entries(by)) { const wt = w[k]; if (wt == null || v.m <= 0) continue; n += wt * (v.p / v.m); d += wt; }
      if (d > 0) return n / d * 100;
    }
    const p = g.reduce((s, a) => s + a.score, 0), m = g.reduce((s, a) => s + a.max, 0);
    return m > 0 ? p / m * 100 : null;
  }
  function effList(course, mp) {
    const k = wkey(ckey(course.name), mp), ed = S.whatif[k] || {};
    const list = course.assignments.map((a, i) => i in ed ? Object.assign({}, a, { score: ed[i], missing: false, exempt: false })
      : (S.zeroMissing && a.missing) ? Object.assign({}, a, { score: 0, missing: false }) : a);
    return list.concat((S.hyp[k] || []).map(h => ({ score: h.score, max: h.max, category: h.category, exempt: false })));
  }
  const edited = (course, mp) => { const k = wkey(ckey(course.name), mp); return !!(Object.keys(S.whatif[k] || {}).length || (S.hyp[k] || []).length || S.zeroMissing); };
  function whatIfAvg(course, mp) {
    const base = course.average ?? calcAvg(course, course.assignments);
    if (!edited(course, mp)) return base;
    const o = calcAvg(course, course.assignments), n = calcAvg(course, effList(course, mp));
    if (n == null) return base;
    return base == null || o == null ? n : Math.max(0, base + (n - o));
  }
  const anyEdits = () => S.zeroMissing || Object.values(S.whatif).some(o => Object.keys(o).length) || Object.values(S.hyp).some(a => a.length);

  /* ================= GPA model ================= */
  const tierOv = () => A("tier", {}), credOv = () => A("credit", {}), exclOv = () => A("excl", {}), qEdits = () => A("qedit", {});
  function curRows() {              // current-year courses -> one row per semester that has a grade
    const rows = [], ed = qEdits(), cl = classOf();
    courseList().forEach(c => {
      const tier = tierOv()[c.key] || G.guessTier(c.name, cl), tierAuto = !tierOv()[c.key];
      const qs = [1, 2, 3, 4].map(n => { const e = ed[c.key] && ed[c.key][n]; const v = e != null && e !== "" ? Number(e) : hacQ(c.key, n); return v == null ? null : G.roundGrade(v); });   // quarter grades post as whole numbers (89.5 -> 90), so round BEFORE averaging
      for (const sem of [1, 2]) {
        const v = [qs[sem * 2 - 2], qs[sem * 2 - 1]].filter(x => x != null);
        if (!v.length) continue;
        rows.push({ key: c.key, name: c.name, sem, grade: v.reduce((a, b) => a + b, 0) / v.length, tier, tierAuto, credit: credOv()[c.key] ?? 0.5, incl: !exclOv()[c.key], qs, gl: parseInt((S.registration && S.registration.grade) || "", 10) || 0 });
      }
    });
    return rows;
  }
  function trRows() {
    const out = [], cl = classOf();
    ((S.transcript && S.transcript.semesters) || []).forEach(s => (s.courses || []).forEach(c => {
      if (c.grade == null) return;
      const nm = c.description || c.course, k = "tr:" + s.year + ":" + nm;
      if (/\b(cbe|ea)\b/i.test(nm)) return;
      out.push({ key: k, name: nm, grade: c.grade, tier: tierOv()[k] || G.guessTier(nm, cl), tierAuto: !tierOv()[k], credit: credOv()[k] ?? (c.credit || 1), incl: !exclOv()[k], gl: parseInt(s.grade_level, 10) || 0, sem: s.year + " · Grade " + s.grade_level, school: s.school, s1: c.sem1, s2: c.sem2 });
    }));
    return out;
  }
  const calc = rows => G.gpa(rows.filter(r => r.incl));
  function quarterGpa(mp, withEdits = true) {
    const idx = mps().findIndex(m => m.value === mp), q = qNum(mps()[idx], idx), rows = [];
    courseList().forEach(c => {
      const co = findCourse(mp, c.key); let g = co ? co.average : reportGrade(c.key, q);
      if (withEdits && co && edited(co, mp)) g = whatIfAvg(co, mp);
      if (g == null) return;
      rows.push({ grade: g, tier: tierOv()[c.key] || G.guessTier(c.name, classOf()), credit: 0.5, incl: !exclOv()[c.key] });
    });
    return calc(rows);
  }
  function officialGpa() {
    const g = (S.transcript && S.transcript.gpa) || {}; let w = null, u = null;
    for (const [k, v] of Object.entries(g)) { const kk = k.toLowerCase(); if (kk.includes("unweight")) u = v; else if (kk.includes("weight")) w = v; }
    return { w, u };
  }

  /* ================= assignments / missing / new ================= */
  function allAssignments() {
    const out = [];
    mps().forEach((m, i) => coursesOf(m.value).forEach(c => c.assignments.forEach(a => {
      const d = a.due ? new Date(a.due) : null;
      out.push(Object.assign({ course: c.name, ckey: ckey(c.name), mp: m.value, q: qNum(m, i), date: d && !isNaN(d) ? d : null, catw: ((c.categories || []).find(x => x.name === a.category) || {}).weight }, a));
    })));
    return out;
  }
  const isMissingish = a => a.missing || a.code === "ABS" || a.code === "L" || (a.zero && a.graded && a.catw !== 0);   // zeros in 0%-weight categories don't affect the grade
  function missingWork() {
    const dis = new Set(A("dismissed", []));
    return allAssignments().filter(a => a.mp === curMp() && isMissingish(a) && !dis.has(a.course + "|" + a.name)).sort((x, y) => (y.date || 0) - (x.date || 0));
  }
  function upcoming() {
    const t = new Date(); t.setHours(0, 0, 0, 0);
    return allAssignments().filter(a => a.mp === curMp() && a.date && a.date >= t && !a.graded && !a.exempt).sort((x, y) => x.date - y.date);
  }
  const dayLabel = d => { const t = new Date(); t.setHours(0, 0, 0, 0); const df = Math.round((d - t) / 864e5); return df === 0 ? "Today" : df === 1 ? "Tomorrow" : d.toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" }); };
  const dayShort = d => { const l = dayLabel(d); return l === "Today" ? "TODAY" : l === "Tomorrow" ? "TMRW" : d.toLocaleDateString(undefined, { weekday: "short" }).toUpperCase(); };

  function detectNew() {
    const now = [];
    mps().forEach(m => coursesOf(m.value).forEach(c => c.assignments.forEach(a => {
      if (a.score != null) now.push({ course: c.name, ckey: ckey(c.name), name: a.name, score: a.score, max: a.max, category: a.category, key: [c.name, m.value, a.name, a.score].join("|") });
    })));
    const prev = A("snap", null);
    if (prev) {
      const seen = new Set(prev), fresh = now.filter(n => !seen.has(n.key)).map(n => Object.assign({ ts: Date.now() }, n));
      if (fresh.length) {
        ASet("recent", fresh.concat(A("recent", [])).slice(0, 25));
        if (settings().notify && "Notification" in window && Notification.permission === "granted")
          new Notification("New grade posted", { body: fresh.slice(0, 3).map(f => `${f.course}: ${f.name} (${f.score}/${f.max})`).join("\n") });
      }
    }
    ASet("snap", now.map(n => n.key));
  }

  /* ================= loading ================= */
  async function loadAll(force) {
    S.loading = true; render();
    try {
      if (force) await api("refresh", { method: "POST" });
      const [all, classes, tr, reg, rc] = await Promise.all([api("all"), api("classes").catch(() => []), api("transcript").catch(() => null), api("registration").catch(() => null), api("reportcard").catch(() => null)]);
      Object.assign(S, { all, classes, transcript: tr, registration: reg, reportcard: rc, updated: new Date() });
      if (!S.q || (!mps().some(m => m.value === S.q) && S.q !== "ALL")) S.q = all.current;
      detectNew();
      if (settings().offline) lsSet("offline_last", { all, classes, tr, reg, rc, at: Date.now() });
    } catch (e) { if (S.me) toast(e.message); }
    S.loading = false; render();
  }
  async function lazy(name, key) {
    if (S[key]) return;
    try { S[key] = await api(name); } catch (e) { S[key] = { rows: [], dates: [], headers: [] }; toast(e.message); }
    render();
  }

  /* ================= small view helpers ================= */
  function firstName() {
    const n = (S.registration && S.registration.name) || (S.me.accounts.find(x => x.id === S.me.active) || {}).name || "";
    const f = n.includes(",") ? n.split(",")[1].trim().split(" ")[0] : n.split(" ")[0];
    return f ? titleCase(f) : "there";
  }
  const weightLabel = t => ({ 1: "Reg · weight 5", 2: "Adv · weight 5.5", 3: "AP · weight 6" }[t]);
  const courseTier = (key, name) => tierOv()[key] || G.guessTier(name, classOf());
  const refreshBtn = () => `<button class="btn sm" data-act="refresh">${S.loading ? '<span class="spin"></span> Loading' : "⟳ Refresh"}</button>`;
  const updatedTxt = () => S.updated ? "Updated " + (Date.now() - S.updated < 60000 ? "just now" : S.updated.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })) : "";
  const changedBanner = () => { const r = A("recent", []); const n = new Set(r.map(x => x.ckey)).size; return n ? `<div class="banner"><span>${n} class${n > 1 ? "es" : ""} changed since your last visit.</span><button class="btn sm" data-act="markSeen">Mark seen</button></div>` : ""; };
  const skeleton = () => `<h1>Loading…</h1><p class="sub"><span class="spin"></span> Fetching your grades from HAC — this takes a few seconds.</p>${'<div class="skel"></div>'.repeat(5)}`;

  /* ================= views ================= */
  function loginView() {
    const off = settings().offline && lsGet("offline_last", null), rem = lsGet("remembered", "");
    return `<div class="lg"><div class="lg-art"><div class="brand"><i>A</i>Aceify</div></div><div class="lg-form"><div>
    <h1>Sign in</h1>
    <label class="l">District</label><select id="dist"><option value="frisco">Frisco ISD</option></select>
    <label class="l">HAC username</label><input id="u" autocomplete="username" inputmode="numeric" value="${esc(rem)}">
    <label class="l">HAC password</label><input id="p" type="password" autocomplete="current-password">
    <label class="row" style="margin:14px 0 0;font-weight:600;font-size:13.5px"><input type="checkbox" id="rem" ${rem || DEFAULTS.remember ? "checked" : ""}> Remember my student ID</label>
    <div class="err" id="err">${esc(S.loginMsg)}</div>
    <button class="btn pri" style="width:100%;padding:13px;font-size:15px" data-act="login" id="go">Sign in</button>
    ${off ? `<button class="btn" style="width:100%;margin-top:10px" data-act="offline">View last saved grades (offline)</button>` : ""}
    ${S._addFrom ? `<button class="btn" style="width:100%;margin-top:10px" data-act="cancelAdd">Cancel</button>` : ""}
    </div></div></div>`;
  }

  const ICONS = {
    grid: '<rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/>',
    book: '<path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/>',
    award: '<circle cx="12" cy="8" r="7"/><polyline points="8.2 13.9 7 23 12 20 17 23 15.8 13.9"/>',
    cal: '<rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>',
    clock: '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',
    trend: '<polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/>',
    file: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/>',
    clip: '<path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><rect x="8" y="2" width="8" height="4" rx="1"/>',
    flag: '<path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" y1="22" x2="4" y2="15"/>',
    users: '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.9"/><path d="M16 3.1a4 4 0 0 1 0 7.8"/>',
    user: '<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
    sliders: '<line x1="4" y1="21" x2="4" y2="14"/><line x1="4" y1="10" x2="4" y2="3"/><line x1="12" y1="21" x2="12" y2="12"/><line x1="12" y1="8" x2="12" y2="3"/><line x1="20" y1="21" x2="20" y2="16"/><line x1="20" y1="12" x2="20" y2="3"/><line x1="1" y1="14" x2="7" y2="14"/><line x1="9" y1="8" x2="15" y2="8"/><line x1="17" y1="16" x2="23" y2="16"/>',
    help: '<circle cx="12" cy="12" r="10"/><path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/>',
    alert: '<path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>',
    map: '<polygon points="1 6 1 22 8 18 16 22 23 18 23 2 16 6 8 2 1 6"/><line x1="8" y1="2" x2="8" y2="18"/><line x1="16" y1="6" x2="16" y2="22"/>',
    chev: '<polyline points="15 18 9 12 15 6"/>',
    menu: '<line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/>',
    spark: '<path d="M12 3l1.9 5.6L19.5 10l-5.6 1.9L12 17.5l-1.9-5.6L4.5 10l5.6-1.4z"/>',
  };
  const ic = n => `<svg class="i" viewBox="0 0 24 24">${ICONS[n] || ""}</svg>`;
  const greet = () => { const h = new Date().getHours(); return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening"; };
  function ring(p, size) {
    const r = 26, c = 2 * Math.PI * r, pct = p == null ? 0 : Math.max(0, Math.min(100, p));
    return `<div class="ring ${letter(p)}" style="width:${size || 62}px;height:${size || 62}px"><svg viewBox="0 0 62 62" width="${size || 62}" height="${size || 62}"><circle class="bg" cx="31" cy="31" r="${r}"/><circle class="fg" cx="31" cy="31" r="${r}" stroke-dasharray="${c.toFixed(1)}" stroke-dashoffset="${(c * (1 - pct / 100)).toFixed(1)}"/></svg><b>${p == null ? "—" : Math.round(p)}</b></div>`;
  }
  const kpi = (icon, val, label, go, cls) => `<div class="kpi" ${go ? `data-act="nav" data-arg="${go}"` : 'style="cursor:default"'}><span class="ico ${cls || ""}">${ic(icon)}</span><span><b>${val}</b><small>${label}</small></span></div>`;

  function dashboard() {
    const st = settings(), up = upcoming(), miss = missingWork(), recent = A("recent", []), cur = curMp();
    const rows = courseList().map(c => ({ c, co: findCourse(cur, c.key) })).filter(x => x.co);
    const avgs = rows.map(x => whatIfAvg(x.co, cur)).filter(v => v != null), mean = avgs.length ? avgs.reduce((a, b) => a + b, 0) / avgs.length : null;
    const t0 = new Date(); t0.setHours(0, 0, 0, 0); const wkEnd = new Date(t0); wkEnd.setDate(t0.getDate() + 7);
    const dueWeek = up.filter(a => a.date < wkEnd).length, recentKeys = new Set(recent.map(r => r.ckey));
    const cum = calc(trRows().concat(curRows()));
    const kpis = (st.showGpa ? kpi("award", f3(cum.weighted), "Weighted GPA", "gpa") + kpi("award", f3(cum.unweighted), "Unweighted GPA", "gpa") : kpi("book", mean == null ? "—" : num(mean) + "%", "Average · Q" + curQ(), "grades"))
      + kpi("cal", dueWeek, "Due this week", "agenda") + kpi("alert", miss.length, "Missing work", null, miss.length ? "warn" : "") + kpi("spark", recentKeys.size, "Updated classes", null, recentKeys.size ? "new" : "");
    const ccards = rows.map(({ c, co }) => {
      const avg = whatIfAvg(co, cur), m = co.assignments.filter(a => a.missing || a.code === "ABS" || a.code === "L").length;
      return `<div class="ccard g${letter(avg)}" data-act="openClass" data-arg="${esc(c.key)}"><div class="row sp" style="align-items:flex-start;gap:10px"><div class="nm">${esc(co.name)}</div>${ring(avg, 56)}</div>
        <div class="foot"><span>${co.assignments.length} assignment${co.assignments.length === 1 ? "" : "s"}</span><span>${m ? `<span class="tag" style="margin:0">${m} missing</span>` : ""}${recentKeys.has(c.key) ? '<span class="tag info">NEW</span>' : ""}</span></div></div>`;
    }).join("");
    const upCard = `<div class="card"><div class="row sp"><h2>Coming up</h2><button class="btn sm" data-act="nav" data-arg="agenda">Agenda ›</button></div><div style="margin-top:6px">${up.slice(0, 5).map(a => `<div class="li"><div style="min-width:0"><b>${esc(a.name.length > 34 ? a.name.slice(0, 33) + "…" : a.name)}</b><div class="small mut">${esc(a.course)}</div></div><span class="tag info" style="margin:0">${esc(dayShort(a.date))}</span></div>`).join("") || '<p class="mut small" style="margin:10px 0 0">Nothing due soon.</p>'}</div></div>`;
    const missCard = st.showMissing ? `<div class="card"><div class="row sp"><h2>Missing work ${miss.length ? `<span class="tag">${miss.length}</span>` : ""}</h2>${miss.length ? `<button class="btn sm" data-act="dismissAll">Dismiss all</button>` : ""}</div><div style="margin-top:6px">
      ${miss.map(a => `<div class="li"><div style="min-width:0"><span class="dot"></span><b>${esc(a.name)}</b><div class="small mut" style="margin-left:18px">${esc(a.course)} ${a.category ? `<span class="cat" title="${esc(a.category)}">${esc(abbr(a.category))}</span>` : ""}${a.due ? " · due " + esc(a.due.replace(/\/20(\d\d)$/, "")) : ""}</div></div>
       <div class="row" style="gap:6px"><span class="tag" style="margin:0">${a.late || a.code === "L" ? "Late" : a.missing ? esc(a.code || "Missing") : a.code === "ABS" ? "ABS" : "Zero"}</span><button class="btn sm" data-act="dismiss" data-arg="${esc(a.course + "|" + a.name)}" title="Dismiss">✕</button></div></div>`).join("") || '<p class="mut small" style="margin:10px 0 0">Nothing missing. 🎉</p>'}</div></div>` : "";
    const recentCard = st.showRecent ? `<div class="card"><div class="row sp"><h2>Recently posted</h2>${recent.length ? `<button class="btn sm" data-act="markSeen">Mark seen</button>` : ""}</div><div style="margin-top:6px">
      ${recent.slice(0, 5).map(r => `<div class="li"><div style="min-width:0"><span class="dot g"></span><b>${esc(r.name)}</b><div class="small mut" style="margin-left:18px">${esc(r.course)} ${r.category ? `<span class="cat" title="${esc(r.category)}">${esc(abbr(r.category))}</span>` : ""} · ${ago(r.ts)}</div></div>${pill(r.max ? r.score / r.max * 100 : null)}</div>`).join("") || '<p class="mut small" style="margin:10px 0 0">You are all caught up.</p>'}</div></div>` : "";
    return `<div class="head"><div><div class="eyebrow">${new Date().toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}</div><h1>${greet()}, ${esc(firstName())}</h1></div>
      <div class="row"><span class="small mut">Q${curQ()} · ${updatedTxt().toLowerCase()}</span>${refreshBtn()}</div></div>
    <div class="kpis">${kpis}</div>${changedBanner()}
    <div class="split"><div><div class="row sp" style="margin-bottom:12px"><h2>Your classes</h2><button class="btn sm" data-act="nav" data-arg="grades">All grades ›</button></div><div class="ccards">${ccards}</div></div>
    <div class="side-col">${upCard}${missCard}${recentCard}</div></div>`;
  }

  /* ---------- grades ---------- */
  function gradesView() {
    const q = S.q || curMp(), all = q === "ALL";
    const keys = courseList().filter(c => !S.search || c.name.toLowerCase().includes(S.search.toLowerCase()));
    const gv = c => { const co = findCourse(q, c.key); return co ? whatIfAvg(co, q) : null; };
    if (S.sort === "high") keys.sort((a, b) => (gv(b) ?? -1) - (gv(a) ?? -1)); else if (S.sort === "low") keys.sort((a, b) => (gv(a) ?? 999) - (gv(b) ?? 999));
    else keys.sort((a, b) => a.name.localeCompare(b.name));
    const gp = all ? null : quarterGpa(q), gp0 = all ? null : quarterGpa(q, false), label = (mps().find(m => m.value === q) || {}).label || "";
    return `<div class="row sp wrap"><div><h1>Grades</h1><p class="sub">Browse each quarter and edit any assignment — every GPA updates live.</p></div><div class="row" style="padding-top:20px"><span class="small mut">${updatedTxt()}</span>${refreshBtn()}</div></div>
    ${changedBanner()}${anyEdits() ? `<div class="banner warn"><span>What-if mode — edits stay on this device and are never sent to HAC.</span><button class="btn sm" data-act="resetAll">Reset all</button></div>` : ""}
    <div class="row sp wrap" style="margin-bottom:14px;gap:10px"><div class="qtabs">${mps().map(m => `<button data-act="quarter" data-arg="${esc(m.value)}" class="${q === m.value ? "on" : ""}">${esc(m.label)}</button>`).join("")}<button data-act="quarter" data-arg="ALL" class="${all ? "on" : ""}">All quarters</button></div>
      <div class="row"><input id="search" class="auto" style="width:190px" placeholder="Search classes…" value="${esc(S.search)}"><select id="sort" class="auto"><option value="name" ${S.sort === "name" ? "selected" : ""}>Sort: Name</option><option value="high" ${S.sort === "high" ? "selected" : ""}>Sort: Grade ↓</option><option value="low" ${S.sort === "low" ? "selected" : ""}>Sort: Grade ↑</option></select></div></div>
    ${all ? "" : `<div class="card" style="padding:16px 22px"><div class="row sp"><h3 style="margin:0">GPA impact</h3><button class="btn sm" data-act="nav" data-arg="gpa">Full GPA &amp; cumulative ›</button></div>
      <div class="grid g2" style="margin:12px 0 0"><div><small class="mut">${esc(label)} · weighted · non-cumulative</small><div class="stat" style="font-size:34px">${ba(gp0.weighted, gp.weighted)}</div></div><div><small class="mut">${esc(label)} · 4.0 · non-cumulative</small><div class="stat" style="font-size:34px">${ba(gp0.unweighted, gp.unweighted)}</div></div></div></div>`}
    ${all ? allQuarters(keys) : keys.map(c => classCard(c, q)).join("") || `<p class="mut">No classes match.</p>`}`;
  }
  function allQuarters(keys) {
    return `<div class="card"><table><thead><tr><th>Class</th>${[1, 2, 3, 4].map(n => `<th class="r">Q${n}</th>`).join("")}<th class="r">S1</th><th class="r">S2</th></tr></thead><tbody>
    ${keys.map(c => { const qs = [1, 2, 3, 4].map(n => hacQ(c.key, n)); const sm = s => { const v = [qs[s * 2 - 2], qs[s * 2 - 1]].filter(x => x != null).map(G.roundGrade); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };
      return `<tr class="click" data-act="openClass" data-arg="${esc(c.key)}"><td><b>${esc(c.name)}</b></td>${qs.map(v => `<td class="r">${v == null ? '<span class="mut">—</span>' : esc(num(v))}</td>`).join("")}<td class="r">${sm(1) == null ? "—" : G.roundGrade(sm(1))}</td><td class="r">${sm(2) == null ? "—" : G.roundGrade(sm(2))}</td></tr>`; }).join("")}</tbody></table>
    <p class="small mut" style="margin:10px 0 0">S1 / S2 = average of the two quarters (an estimate of the semester grade).</p></div>`;
  }
  function classCard(c, q) {
    const co = findCourse(q, c.key), open = S.open.has(c.key), tier = courseTier(c.key, c.name);
    const idx = mps().findIndex(m => m.value === q);
    const avg = co ? whatIfAvg(co, q) : hacQ(c.key, qNum(mps()[idx], idx));
    const recentKeys = new Set(A("recent", []).map(r => r.ckey));
    return `<div class="cls g${letter(avg)} ${open ? "open" : ""}" data-card="${esc(c.key)}"><div class="cls-h" data-act="toggle" data-arg="${esc(c.key)}"><div><div class="nm">${esc(co ? co.name : c.name)}${recentKeys.has(c.key) ? '<span class="tag info">NEW</span>' : ""}</div>
      <div class="meta"><b>${weightLabel(tier)}</b> · ${co ? co.assignments.length : 0} assignments${co && co.updated ? " · updated " + esc(co.updated) : ""}</div></div>
      <div class="row">${co && edited(co, q) ? `<span class="pill N" style="opacity:.85">${num(co.average ?? calcAvg(co, co.assignments))}%</span><span class="mut">→</span>` : ""}${pill(avg)}<span class="chev">›</span></div></div>
      <div class="acc"><div>${co ? classBody(co, q) : `<div class="acc-in"><p class="mut" style="margin:14px 0 0">Nothing posted for this quarter yet.</p></div>`}</div></div></div>`;
  }
  const CODE_HELP = "Codes: ABS &amp; L count as zero · M &amp; ILAB are flagged missing · T, X, CNS don't count toward the average.";
  const defaultCat = co => {
    const cats = (co.categories || []).filter(c => c.weight != null).sort((x, y) => y.weight - x.weight);
    return cats.length ? cats[0].name : ((co.assignments.find(x => x.category) || {}).category || "");
  };
  function classBody(co, q) {
    const k = wkey(ckey(co.name), q), ed = S.whatif[k] || {}, hyp = S.hyp[k] || [];
    const cats = [...new Set([...(co.categories || []).map(x => x.name), ...co.assignments.map(a => a.category).filter(Boolean)])];
    const orig = co.average ?? calcAvg(co, co.assignments), now = whatIfAvg(co, q), isEd = edited(co, q);
    return `<div class="acc-in">
      ${isEd ? `<div class="row sp" style="margin:12px 0 0"><span class="small mut">What-if &nbsp; <b style="color:var(--ink)">${pill(orig)}</b> &nbsp;→&nbsp; <b>${pill(now)}</b></span><button class="btn sm" data-act="resetWi" data-arg="${esc(k)}">Reset</button></div>` : ""}
      <table style="margin-top:6px"><thead><tr><th>Assignment</th><th class="hm">Category</th><th class="r">Score</th><th class="r">Out of</th><th class="r">%</th></tr></thead><tbody>
      ${co.assignments.map((a, i) => { const was = a.score, sc = i in ed ? ed[i] : a.score, pct = sc != null && a.max ? sc / a.max * 100 : null, pct0 = was != null && a.max ? was / a.max * 100 : null, changed = i in ed && ed[i] !== was;
        return `<tr><td>${esc(a.name)}${a.missing ? `<span class="tag">${esc(a.code === "ILAB" ? "ILAB" : "Missing")}</span>` : ""}${a.code === "ABS" ? '<span class="tag">ABS</span>' : ""}${a.late && a.code !== "L" ? '<span class="tag warn">Late</span>' : ""}${a.code === "L" ? '<span class="tag warn">L</span>' : ""}${a.exempt ? `<span class="tag mut">${esc(a.code || "Exempt")}</span>` : ""}<div class="small mut">${esc(a.due)}</div></td>
        <td class="hm">${a.category ? `<span class="cat" title="${esc(a.category)}">${esc(abbr(a.category))}</span>` : ""}</td>
        <td class="r"><input class="scoreinp ${changed ? "ed" : ""}" data-chg="wi" data-arg="${esc(k)}|${i}" value="${sc ?? ""}" placeholder="—" inputmode="decimal">${changed ? `<div class="small mut" style="margin-top:3px">was ${was ?? "—"}</div>` : ""}</td><td class="r mut">${a.max ?? ""}</td>
        <td class="r">${changed ? `${pct0 == null ? '<span class="mut">—</span>' : pill(pct0)}<span class="mut"> → </span>${pct == null ? '<span class="mut">—</span>' : pill(pct)}` : (pct == null ? '<span class="mut">—</span>' : pill(pct))}</td></tr>`; }).join("")}
      ${hyp.map((h, i) => `<tr style="background:var(--surf2)"><td><b>Added assignment</b><div class="small mut">not in HAC</div></td><td class="hm"><select class="auto" style="padding:5px 8px;font-size:12.5px" data-chg="hcat" data-arg="${esc(k)}#${i}">${(cats.length ? cats : [h.category]).map(x => `<option ${x === h.category ? "selected" : ""}>${esc(x)}</option>`).join("")}</select></td>
        <td class="r"><input class="scoreinp" data-chg="hscore" data-arg="${esc(k)}#${i}" value="${h.score}" inputmode="decimal"></td><td class="r"><input class="scoreinp" style="width:62px" data-chg="hmax" data-arg="${esc(k)}#${i}" value="${h.max}" inputmode="decimal"></td><td class="r">${pill(h.max ? h.score / h.max * 100 : null)} <button class="btn sm" data-act="rmhyp" data-arg="${esc(k)}#${i}" title="Remove">×</button></td></tr>`).join("")}</tbody></table>
      <div class="row wrap" style="margin-top:16px;gap:14px"><button class="btn sm" data-act="addhyp" data-arg="${esc(k)}">＋ Add assignment</button>
        <label class="row small" style="gap:8px;font-weight:600"><span class="sw"><input type="checkbox" data-chg="zeroMissing" ${S.zeroMissing ? "checked" : ""}><i></i></span>Count missing as 0</label></div>
      <p class="small mut" style="margin:12px 0 0">${CODE_HELP}</p></div>`;
  }

  /* ---------- GPA ---------- */
  const tierSel = (key, tier, auto) => `<select class="auto" data-chg="tier" data-arg="${esc(key)}">${[1, 2, 3].map(t => `<option value="${t}" ${tier === t ? "selected" : ""}>${[0, "5 · Reg", "5.5 · Adv", "6 · AP"][t]}${tier === t && auto ? " ·auto" : ""}</option>`).join("")}</select>`;
  function gpaView() {
    const cl = classOf(), cur = curRows(), tr = trRows(), off = officialGpa();
    const sem = calc(cur.filter(r => r.sem === curSem())), cum = calc(tr.concat(cur));
    return `<h1>GPA</h1><p class="sub">Cumulative · edit any quarter to predict</p>
    <div class="grid g2"><div class="tile"><small>Cumulative GPA (weighted)</small><div class="stat">${f3(cum.weighted)}</div><small>${cum.credits ? cum.credits + " credits counted" : "no grades yet"} · official ${off.w != null ? f3(off.w) : "—"}</small></div>
      <div class="tile"><small>4.0 cumulative (unweighted)</small><div class="stat">${f3(cum.unweighted)}</div><small>official ${off.u != null ? f3(off.u) : "—"}</small></div></div>
    <div class="grid g2"><div class="tile" style="min-height:96px"><small>This semester · weighted</small><div class="stat" style="font-size:30px">${f3(sem.weighted)}</div></div><div class="tile" style="min-height:96px"><small>This semester · 4.0</small><div class="stat" style="font-size:30px">${f3(sem.unweighted)}</div></div></div>
    <p class="small mut" style="margin:-4px 0 14px">🎓 ${cl ? "Class of " + cl + (cl >= 2030 ? " · dual credit counts 6.0" : " · dual credit counts 5.5") : "Class year unknown"} · class rank: ${S.transcript && S.transcript.rank ? esc(S.transcript.rank) : "not posted (top 10% only)"}</p>
    <div class="card"><div class="row sp wrap"><h2>Courses that count</h2><div class="row wrap" style="gap:8px"><button class="btn sm" data-act="selAll">Select all graded</button><button class="btn sm" data-act="selNone">Clear</button><button class="btn sm" data-act="resetQ" title="Puts every weight, credit, checkbox and predicted grade back to the default">Reset to defaults</button>${refreshBtn()}</div></div>
    <p class="small mut" style="margin:8px 0 0">Current year · Grade ${esc((S.registration && S.registration.grade) || "")} · live grades. A semester grade is the average of its two quarters; type in a quarter to predict.</p>
    ${courseList().map(c => gpaCourse(c, cur.filter(r => r.key === c.key))).join("")}
    ${tr.length ? `<h3 style="margin:22px 0 4px">Transcript</h3><p class="small mut" style="margin:0 0 4px">Courses already on your transcript. The transcript abbreviates names, so double-check the weight of each one.</p>${tr.map(r => `<div class="row sp wrap" style="padding:12px 0;border-top:1px solid var(--line)"><label class="row" style="gap:12px"><input type="checkbox" data-chg="incl" data-arg="${esc(r.key)}" ${r.incl ? "checked" : ""}><span><b>${esc(r.name)}</b><div class="small mut">${esc(r.sem)} · S1 / S2 ${r.s1 ?? "—"} / ${r.s2 ?? "—"}</div></span></label>
      <div class="row">${tierSel(r.key, r.tier, r.tierAuto)}<span class="small mut">Cr</span><input class="n" style="width:62px" data-chg="credit" data-arg="${esc(r.key)}" value="${r.credit}" inputmode="decimal">${pill(r.grade)}</div></div>`).join("")}` : ""}</div>
    <div class="card"><h2 style="margin-bottom:8px">How Frisco ISD calculates it</h2><ul class="small" style="line-height:1.75;margin:0;padding-left:18px">
     <li><b>Weighted (GPA for rank):</b> tier maximum − 0.1 per point below 100. Tier I 5.0 · Tier II 5.5 · Tier III 6.0. Below 70 earns 0 — a 90 is worth 4.0 / 4.5 / 5.0.</li>
     <li><b>Unweighted:</b> 90–100 = 4.0 · 80–89 = 3.0 · 70–79 = 2.0 · below 70 = 0.</li>
     <li>Tier III: AP, IB${cl && cl >= 2030 ? ", and dual credit (class of 2030+)" : ""}. Tier II: courses marked Adv, Independent Study &amp; Mentorship, Academic Decathlon, PLTW engineering${cl && cl >= 2030 ? "" : ", dual credit (before class of 2030)"}. Tier I: everything else.</li>
     <li>Both GPAs average <i>semester</i> grades weighted by credit, shown to four decimals (FISD reports three). Credit-by-exam and pass/fail courses don't count.</li>
     <li>Source: FISD 2026-27 High School Academic Guide. Your transcript is the official record; this page is an estimate.</li></ul></div>`;
  }
  function gpaCourse(c, rows) {
    if (!rows.length) return "";
    const r0 = rows[0], ed = qEdits()[c.key] || {}, semG = rows.find(r => r.sem === curSem()) || rows[0];
    return `<div style="padding:14px 0;border-top:1px solid var(--line)"><div class="row sp wrap"><label class="row" style="gap:12px"><input type="checkbox" data-chg="incl" data-arg="${esc(c.key)}" ${r0.incl ? "checked" : ""}><b>${esc(c.name)}</b></label>
      <div class="row">${tierSel(c.key, r0.tier, r0.tierAuto)}${pill(G.roundGrade(semG.grade))}</div></div>
      <div class="row" style="margin-top:10px;gap:10px;padding-left:30px">${[1, 2, 3, 4].map(n => `<div style="flex:1;min-width:0"><div class="small mut" style="text-align:center;margin-bottom:3px">Q${n}</div><input class="${ed[n] != null && ed[n] !== "" ? "scoreinp ed" : ""}" style="text-align:center;width:100%" data-chg="qedit" data-arg="${esc(c.key)}|${n}" value="${ed[n] ?? ""}" placeholder="${(() => { const v = hacQ(c.key, n); return v == null ? "—" : Math.round(v); })()}" inputmode="decimal"></div>`).join("")}
      <div style="width:76px"><div class="small mut" style="text-align:center;margin-bottom:3px">Cr / sem</div><input style="text-align:center" data-chg="credit" data-arg="${esc(c.key)}" value="${r0.credit}" inputmode="decimal"></div></div></div>`;
  }

  /* ---------- course plan ---------- */
  const curGradeNum = () => parseInt((S.registration && S.registration.grade) || "", 10) || null;
  const planCur = () => ((S.plan && S.plan.grades) || []).findIndex(x => parseInt(x.grade, 10) === curGradeNum());
  const tierFor = name => tierOv()[ckey(name)] || G.guessTier(name, classOf());
  const TNAME = ["", "Reg", "Adv", "AP"];
  const tierTag = name => `<button class="ttag t${tierFor(name)}" data-act="cycleTier" data-arg="${esc(ckey(name))}" title="Tap to try Reg / Adv / AP">${TNAME[tierFor(name)]}</button>`;
  function mergeCourses(list) {
    const m = new Map();
    list.forEach(c => { const k = c.name; if (!m.has(k)) m.set(k, { name: c.name, credit: 0, complete: true, virtual: c.virtual, exam: c.exam });
      const o = m.get(k); o.credit += c.credit; o.complete = o.complete && c.complete; });
    return [...m.values()];
  }
  const planX = () => A("planX", 95), planTarget = () => A("planTarget", 5.5);
  const drafts = () => A("plandraft", []);
  function planOutlook() {
    const P = S.plan, gr = P.grades, ci = planCur(), X = planX(), cg = curGradeNum() || 9;
    const base = trRows().map(r => ({ grade: r.grade, tier: r.tier, credit: r.credit, incl: r.incl, gl: r.gl }))
      .concat(curRows().map(r => ({ grade: r.grade, tier: r.tier, credit: r.credit, incl: r.incl, gl: cg })));
    const have = new Set(curRows().map(r => r.key + "|" + r.sem)), fut = [];
    courseList().forEach(c => [1, 2].forEach(sem => { if (!have.has(c.key + "|" + sem)) fut.push({ tier: tierFor(c.name), credit: credOv()[c.key] ?? 0.5, incl: !exclOv()[c.key], gl: cg }); }));   // unfinished semesters of this year
    P.subjects.forEach(sub => Object.entries(sub.courses).forEach(([gi, list]) => { gi = +gi; if (gi <= ci) return;
      mergeCourses(list).forEach(c => { if (!c.exam) fut.push({ tier: tierFor(c.name), credit: c.credit, incl: true, gl: parseInt(gr[gi].grade, 10) }); }); }));
    drafts().forEach(d => { if (d.gi >= ci && !d.exam) fut.push({ tier: tierFor(d.name), credit: d.credit, incl: true, gl: parseInt(gr[d.gi].grade, 10) }); });
    const rowsAt = x => base.concat(fut.map(f => Object.assign({}, f, { grade: x })));
    const at = (x, g) => G.gpa(rowsAt(x).filter(r => r.incl && r.gl <= g));
    const levels = []; for (let g = cg; g <= 12; g++) levels.push({ g, r: at(X, g) });
    return { X, levels, final: at(X, 12), now: calc(trRows().concat(curRows())), at, count: fut.length };
  }
  function neededAverage(O, target) {
    if (O.at(100, 12).weighted < target) return { none: true, best: O.at(100, 12).weighted };
    if (O.at(70, 12).weighted >= target) return { any: true };
    let lo = 70, hi = 100; for (let i = 0; i < 40; i++) { const mid = (lo + hi) / 2; (O.at(mid, 12).weighted >= target) ? hi = mid : lo = mid; }
    return { x: hi };
  }
  function planView() {
    if (!S.plan) { lazy("careerplan", "plan"); return `<h1>Course plan</h1><p class="sub"><span class="spin"></span> Loading your plan from HAC…</p>${'<div class="skel"></div>'.repeat(3)}`; }
    const P = S.plan;
    if (!P.subjects || !P.subjects.length) return `<h1>Course plan</h1><div class="card"><p class="mut">HAC didn't return a course plan for this account.</p></div>`;
    if (!S.requests) lazy("requests", "requests");
    const ci = planCur(), td = (P.totals && P.totals.todate) || [], est = (P.totals && P.totals.estimated) || [];
    const earned = td.slice(2).reduce((a, b) => a + (b || 0), 0), needed = td[0], inprog = ci >= 0 ? (est[ci] || 0) : 0;
    const reqs = (S.requests && S.requests.requests) || [], reqCr = reqs.reduce((a, r) => a + r.credits, 0);
    const ap = reqs.filter(r => tierFor(r.name) === 3).length, adv = reqs.filter(r => tierFor(r.name) === 2).length;
    const O = planOutlook(), hasDraft = drafts().length || Object.keys(tierOv()).length;
    const kp = (ico, val, label) => `<div class="kpi" style="cursor:default"><span class="ico">${ic(ico)}</span><span><b>${val}</b><small>${label}</small></span></div>`;
    const tab = S.planTab || "grid";
    return `<div class="head"><div><div class="eyebrow">${esc(P.plan || "Graduation plan")}</div><h1>Course plan</h1></div><div class="row">${hasDraft ? `<button class="btn sm" data-act="resetPlan" title="Removes drafts and puts every weight tag back to its default">Reset changes</button>` : ""}${refreshBtn()}</div></div>
    <div class="kpis">${kp("award", num(earned) + " <small style='font-size:13px;color:var(--mut)'>/ " + num(needed) + "</small>", "Credits earned") + kp("book", num(inprog), "In progress this year") + kp("cal", reqs.length ? num(reqCr) : "—", "Requested next year") + kp("trend", reqs.length ? `${ap} AP · ${adv} Adv` : "—", "Rigor next year") + kp("spark", f3(O.final.weighted), "Projected weighted GPA at graduation")}</div>
    <div class="qtabs" style="margin-bottom:16px"><button data-act="ptab" data-arg="grid" class="${tab === "grid" ? "on" : ""}">4-year plan</button><button data-act="ptab" data-arg="requests" class="${tab === "requests" ? "on" : ""}">Next year's requests</button><button data-act="ptab" data-arg="outlook" class="${tab === "outlook" ? "on" : ""}">GPA outlook</button></div>
    ${tab === "grid" ? planGrid(P, ci) : tab === "requests" ? planRequests() : planOutlookView(O)}`;
  }
  function planGrid(P, ci) {
    const gr = P.grades, dr = drafts();
    const chip = (c, gi) => { const st = c.complete ? "earned" : (gi === ci ? "progress" : "planned");
      return `<div class="pchip ${st}"><div class="pn">${esc(c.name)}</div><div class="pm">${num(c.credit)} cr ${c.exam ? '<span class="tag mut" style="margin:0">Credit by exam</span>' : tierTag(c.name)}${c.virtual ? ' <span class="tag mut" style="margin:0">Virtual</span>' : ""}</div></div>`; };
    const dchip = d => `<div class="pchip draft"><div class="pn">${esc(d.name)}</div><div class="pm">${num(d.credit)} cr ${tierTag(d.name)} <button class="btn sm" style="padding:1px 8px" data-act="rmDraft" data-arg="${d.id}" title="Remove">×</button></div></div>`;
    const rows = P.subjects.map(sub => {
      const merged = {}; Object.entries(sub.courses).forEach(([gi, l]) => merged[gi] = mergeCourses(l));
      const own = Object.values(merged).flat().reduce((a, c) => a + c.credit, 0) + dr.filter(d => d.subject === sub.name).reduce((a, d) => a + d.credit, 0);
      const ok = own >= (sub.needed || 0) - 1e-9;
      return `<tr><td class="sn"><b>${esc(sub.name)}</b><div class="small ${ok ? "okc" : "lowc"}">${num(own)} / ${num(sub.needed)}${own > (sub.est || 0) + 1e-9 ? "" : ""}</div></td>${gr.map((g, gi) => `<td class="${gi === ci ? "cur" : ""}">${(merged[gi] || []).map(c => chip(c, gi)).join("")}${dr.filter(d => d.subject === sub.name && d.gi === gi).map(dchip).join("")}</td>`).join("")}</tr>`; }).join("");
    const subOpts = P.subjects.map(s => `<option>${esc(s.name)}</option>`).join(""), gOpts = gr.map((g, gi) => gi >= Math.max(ci, 0) ? `<option value="${gi}">Grade ${+g.grade} · ${esc(g.year)}</option>` : "").join("");
    return `<div class="card" style="padding:14px;overflow:auto"><table class="pgrid"><thead><tr><th>Subject area</th>${gr.map((g, gi) => `<th class="${gi === ci ? "cur" : ""}">Grade ${+g.grade}<small>${esc(g.year)}</small></th>`).join("")}</tr></thead><tbody>${rows}</tbody></table>
      <div class="row wrap small mut" style="margin-top:12px;gap:16px"><span><i class="lgd earned"></i>Earned</span><span><i class="lgd progress"></i>In progress</span><span><i class="lgd planned"></i>Planned / requested</span><span><i class="lgd draft"></i>Your draft</span><span>Tap a Reg / Adv / AP tag to see how the weight changes your GPA outlook.</span></div></div>
    <div class="card"><h3>Try a different plan</h3><div class="row wrap"><select id="dSub" class="auto">${subOpts}</select><select id="dGrade" class="auto">${gOpts}</select><input id="dName" style="flex:1;min-width:190px" placeholder="Course name, e.g. AP Statistics"><input id="dCr" class="n" value="1" inputmode="decimal" title="Credits"><button class="btn pri" data-act="addDraft">Add to my plan</button></div>
      <p class="small mut" style="margin:10px 0 0">Drafts stay on this device and are never sent to HAC. Credits per subject and the GPA outlook update as you add them.</p></div>`;
  }
  function planRequests() {
    if (!S.requests) return `<p class="mut"><span class="spin"></span> Loading…</p>`;
    const R = S.requests, bySub = {};
    R.requests.forEach(r => (bySub[r.subject] ||= []).push(r));
    return `<div class="card"><div class="row sp wrap"><h2>${esc(R.year)} · ${esc(R.building)}</h2><span class="small mut">${num(R.requests.reduce((a, r) => a + r.credits, 0))} credits requested</span></div>
      ${Object.entries(bySub).map(([sub, l]) => `<div class="li"><b style="min-width:160px">${esc(sub)}</b><div class="row wrap" style="gap:8px;justify-content:flex-end">${l.map(r => `<span class="pchip planned" style="margin:0"><span class="pn" style="display:inline">${esc(r.name)}</span> <span class="pm" style="display:inline">${num(r.credits)} cr ${tierTag(r.name)}</span></span>`).join("")}</div></div>`).join("") || '<p class="mut">No requests entered yet.</p>'}</div>
    <div class="card"><h2 style="margin-bottom:8px">Graduation requirements</h2><table><thead><tr><th>Subject</th><th class="r">Required</th><th class="r">Completed</th><th class="r">Scheduled</th><th class="r">Planned</th><th style="width:30%"></th></tr></thead><tbody>
      ${R.subjects.map(x => { const got = (x.completed || 0) + (x.scheduled || 0) + (x.planned || 0), pct = x.required ? Math.min(100, got / x.required * 100) : 100;
        return `<tr><td>${esc(x.name)}</td><td class="r">${num(x.required)}</td><td class="r">${num(x.completed)}</td><td class="r">${num(x.scheduled)}</td><td class="r">${num(x.planned)}</td><td><div class="bar"><div style="width:${pct}%;${got + 1e-9 < x.required ? "background:var(--C)" : ""}"></div></div></td></tr>`; }).join("")}</tbody></table></div>`;
  }
  function planOutlookView(O) {
    const t = planTarget(), nd = neededAverage(O, t);
    const msg = nd.none ? `Even a 100 in every future class wouldn't reach ${t.toFixed(2)} (best possible: <b>${f3(nd.best)}</b>).` : nd.any ? `You'd reach ${t.toFixed(2)} with any passing grades from here.` : `To finish with a <b>${t.toFixed(2)}</b> weighted GPA you need to average about <b>${nd.x.toFixed(1)}</b> in your remaining classes.`;
    return `<div class="card"><h2>Where this plan takes your GPA</h2><p class="small mut" style="margin:6px 0 14px">Every remaining class is assumed to finish at the grade below, using the weight tags (Reg / Adv / AP) on the plan.</p>
      <div class="row wrap" style="gap:12px"><label class="small" style="font-weight:700">I'll average <input class="n" data-chg="planX" value="${O.X}" inputmode="decimal"> in future classes</label><label class="small" style="font-weight:700">My goal is <input class="n" data-chg="planTarget" value="${t}" inputmode="decimal"> weighted</label></div>
      <div class="banner" style="margin:16px 0 0"><span>${msg}</span></div></div>
    <div class="card"><table><thead><tr><th>After</th><th class="r">Weighted GPA</th><th class="r">Unweighted GPA</th><th class="r">Credits counted</th></tr></thead><tbody>
      <tr><td><b>Now</b> <span class="small mut">(est.)</span></td><td class="r">${f3(O.now.weighted)}</td><td class="r">${f3(O.now.unweighted)}</td><td class="r mut">${num(O.now.credits)}</td></tr>
      ${O.levels.map(l => `<tr><td>Grade ${l.g}</td><td class="r"><b>${f3(l.r.weighted)}</b></td><td class="r">${f3(l.r.unweighted)}</td><td class="r mut">${num(l.r.credits)}</td></tr>`).join("")}</tbody></table>
      <p class="small mut" style="margin:10px 0 0">An estimate, not an official calculation. Class rank only counts the semesters on your transcript; your transcript is the official record.</p></div>`;
  }

  /* ---------- agenda ---------- */
  function weekRange(off) {
    const t = new Date(); t.setHours(0, 0, 0, 0);
    const mon = new Date(t); mon.setDate(t.getDate() - ((t.getDay() + 6) % 7) + off * 7);
    return { mon, days: [0, 1, 2, 3, 4].map(i => { const d = new Date(mon); d.setDate(mon.getDate() + i); return d; }), sun: new Date(mon.getTime() + 6 * 864e5) };
  }
  function agendaItems(date) {
    const key = isoDay(date), f = S.agendaFilter;
    const hac = allAssignments().filter(a => a.mp === curMp() && a.date && isoDay(a.date) === key && (!f || (f !== "general" && a.ckey === f)));
    const tk = A("tasks", []).map((t, i) => Object.assign({ i }, t)).filter(t => t.date === key && (!f || (f === "general" ? !t.cls : t.cls === f)));
    return { hac, tk };
  }
  function agendaView() {
    const wk = weekRange(S.wk), t0 = new Date(); t0.setHours(0, 0, 0, 0);
    const day = S.day || t0, items = S.agendaMode === "day" ? [day] : wk.days;
    const left = wk.days.reduce((n, d) => { const x = agendaItems(d); return n + x.hac.filter(a => !a.graded && !a.exempt).length + x.tk.filter(t => !t.done).length; }, 0);
    const clsOpts = `<option value="">General</option>${courseList().map(c => `<option value="${esc(c.key)}">${esc(c.name)}</option>`).join("")}`;
    const range = `${wk.mon.toLocaleDateString(undefined, { month: "short", day: "numeric" })} – ${wk.sun.toLocaleDateString(undefined, { month: "short", day: "numeric" })}`;
    return `<h1>Agenda</h1><p class="sub">Your planner — due dates from HAC plus your own homework and tasks.</p>
    <div class="row sp wrap" style="margin-bottom:14px"><div class="qtabs"><button data-act="amode" data-arg="week" class="${S.agendaMode === "week" ? "on" : ""}">Week</button><button data-act="amode" data-arg="day" class="${S.agendaMode === "day" ? "on" : ""}">Day</button></div>
      <div class="row"><button class="btn sm" data-act="wk" data-arg="-1">‹</button><b>${S.agendaMode === "day" ? day.toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" }) : range}</b><button class="btn sm" data-act="wk" data-arg="1">›</button><button class="btn sm" data-act="wk" data-arg="0">Today</button></div><span class="small mut">${left} left this week</span></div>
    <div class="chips" style="margin-bottom:14px"><button data-act="afilter" data-arg="" class="${!S.agendaFilter ? "on" : ""}">All</button><button data-act="afilter" data-arg="general" class="${S.agendaFilter === "general" ? "on" : ""}">General</button>${courseList().map(c => `<button data-act="afilter" data-arg="${esc(c.key)}" class="${S.agendaFilter === c.key ? "on" : ""}">${esc(c.name.length > 22 ? c.name.slice(0, 21) + "…" : c.name)}</button>`).join("")}</div>
    <div class="card"><h3>Add homework / task</h3><div class="row wrap"><input id="tTxt" style="flex:1;min-width:190px" placeholder="e.g. Finish Unit 4 research"><select id="tCls" class="auto">${clsOpts}</select><input id="tDate" type="date" class="auto" value="${isoDay(S.agendaMode === "day" ? day : (t0 >= wk.mon && t0 <= wk.sun ? t0 : wk.mon))}"><button class="btn pri" data-act="taskAdd">Add</button></div></div>
    <div class="${S.agendaMode === "day" ? "" : "week"}">${items.map(d => { const x = agendaItems(d), isT = d.getTime() === t0.getTime();
      return `<div class="${S.agendaMode === "day" ? "card" : ""}"><h4 class="${isT ? "today" : ""}">${d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })}${isT ? " · today" : ""}</h4>
      ${x.hac.map(a => `<div class="it">${esc(a.name.length > 38 ? a.name.slice(0, 37) + "…" : a.name)}<div class="small mut">${esc(a.course.slice(0, 26))} ${a.category ? `<span class="cat">${esc(abbr(a.category))}</span>` : ""} ${a.graded ? pill(a.max ? a.score / a.max * 100 : null) : (a.date < t0 ? '<span class="tag warn">not graded</span>' : '<span class="tag ok">due</span>')}</div></div>`).join("")}
      ${x.tk.map(t => `<div class="it row sp"><label class="row" style="gap:8px"><input type="checkbox" data-chg="tdone" data-arg="${t.i}" ${t.done ? "checked" : ""}><span style="${t.done ? "text-decoration:line-through;opacity:.55" : ""}">${esc(t.text)}${t.cls ? `<div class="small mut">${esc((courseList().find(c => c.key === t.cls) || {}).name || "")}</div>` : ""}</span></label><button class="btn sm" data-act="taskDel" data-arg="${t.i}">×</button></div>`).join("")}
      ${!x.hac.length && !x.tk.length ? '<div class="small mut">Nothing</div>' : ""}</div>`; }).join("")}</div>`;
  }

  /* ---------- schedule ---------- */
  function scheduleView() {
    const q = curQ(), rows = (S.classes || []).filter(c => !c.mps || c.mps.includes("Q" + q));
    const day = d => rows.filter(c => (c.days || "").toUpperCase().includes(d)).sort((a, b) => (parseInt(a.period) || 99) - (parseInt(b.period) || 99));
    const block = (d, list) => `<div class="card"><div class="row sp"><h2>${d} Day</h2><span class="small mut">${list.length} periods</span></div>${list.map(c => `<div class="row" style="padding:13px 0;border-top:1px solid var(--line);gap:16px"><div style="width:34px;font-size:22px;font-weight:800;color:var(--brand);text-align:center">${/^\d+$/.test(c.period) ? esc(c.period) : '<span style="font-size:12px">ADV</span>'}</div><div style="flex:1"><b>${esc(c.description)}</b><div class="small mut">${esc(c.course)} · Room ${esc(c.room || "N/A")} · ${esc(titleCase(c.teacher))}</div></div>${c.mps ? `<span class="tag mut">${esc(c.mps)}</span>` : ""}</div>`).join("") || '<p class="mut">No classes found.</p>'}</div>`;
    return `<h1>Schedule</h1><p class="sub">Your A-day and B-day classes, in order.</p>${block("A", day("A"))}${block("B", day("B"))}`;
  }

  /* ---------- more pages ---------- */
  const NOTE_LOAD = `<p class="mut"><span class="spin"></span> Loading…</p>`;
  function tableCard(t) {
    if (!t || !t.rows || !t.rows.length) return `<div class="card"><p class="mut">Nothing to show yet.</p></div>`;
    const heads = Object.keys(t.rows[0]).filter(h => !["att.credit", "ern.credit"].includes(h));
    const cell = (h, v) => /^\d{2,3}(\.\d+)?$/.test(v) && /^(q\d|sem|exam|fin|s\d|ipr)/.test(h) ? pill(Number(v)) : esc(v);
    return `<div class="card" style="overflow:auto"><table><thead><tr>${heads.map(h => `<th>${esc(h.replace(/^./, c => c.toUpperCase()))}</th>`).join("")}</tr></thead><tbody>${t.rows.map(r => `<tr>${heads.map(h => `<td>${cell(h, r[h])}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
  }
  function iprView() {
    if (!S.ipr) { lazy("ipr", "ipr"); return NOTE_LOAD; }
    const d = S.ipr; if (!d.rows || !d.rows.length) return `<div class="card"><p class="mut">No progress reports yet.</p></div>`;
    return `<div class="card" style="overflow:auto"><table><thead><tr><th>Class</th>${d.dates.map(x => `<th class="r">${esc(x)}</th>`).join("")}</tr></thead><tbody>${d.rows.map(r => { let prev = null;
      return `<tr><td><b>${esc(r.description)}</b><div class="small mut">${esc(titleCase(r.teacher))}</div></td>${d.dates.map(x => { const v = r.grades[x], n = v !== "" && v != null ? Number(v) : null; let h = n == null ? '<span class="mut">—</span>' : pill(n); if (n != null && prev != null && n < prev) h += ` <span class="tag">▼ ${num(prev - n)}</span>`; if (n != null) prev = n; return `<td class="r">${h}</td>`; }).join("")}</tr>`; }).join("")}</tbody></table></div>`;
  }
  const PALETTE = ["#0f766e", "#e4572e", "#2563eb", "#a855f7", "#d97706", "#16a34a", "#db2777", "#0891b2"];
  function trendsView() {
    const list = courseList(), W = 760, H = 300, pl = 42, pr = 16, pt = 16, pb = 30;
    const series = list.map((c, i) => ({ name: c.name, color: PALETTE[i % PALETTE.length], pts: [1, 2, 3, 4].map(n => hacQ(c.key, n)) })).filter(s => s.pts.some(v => v != null));
    const all = series.flatMap(s => s.pts).filter(v => v != null), lo = Math.floor(Math.min(90, ...(all.length ? all : [90])) / 5) * 5 - 5, hi = 100;
    const x = n => pl + (n - 1) * (W - pl - pr) / 3, y = v => pt + (hi - v) / (hi - lo) * (H - pt - pb);
    const grid = []; for (let v = lo; v <= hi; v += 5) grid.push(`<line class="gl" x1="${pl}" x2="${W - pr}" y1="${y(v)}" y2="${y(v)}"/><text x="${pl - 8}" y="${y(v) + 4}" text-anchor="end">${v}</text>`);
    return `<h1>Trends</h1><p class="sub">How each class has moved quarter to quarter.</p><div class="card"><svg class="chart" viewBox="0 0 ${W} ${H}" width="100%">${grid.join("")}${[1, 2, 3, 4].map(n => `<text x="${x(n)}" y="${H - 8}" text-anchor="middle">Q${n}</text>`).join("")}
    ${series.map(s => { const pts = s.pts.map((v, i) => v == null ? null : [x(i + 1), y(v)]).filter(Boolean); return `<polyline fill="none" stroke="${s.color}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" points="${pts.map(p => p.join(",")).join(" ")}"/>${pts.map(p => `<circle cx="${p[0]}" cy="${p[1]}" r="4" fill="${s.color}"/>`).join("")}`; }).join("")}</svg>
    <div class="chips" style="margin-top:8px">${series.map(s => { const v = s.pts.filter(z => z != null); const d = v.length > 1 ? v[v.length - 1] - v[v.length - 2] : null; return `<span class="row" style="gap:6px;font-weight:700;font-size:13px"><i style="width:11px;height:11px;border-radius:50%;background:${s.color};display:inline-block"></i>${esc(s.name)} <span class="mut">${num(v[v.length - 1])}${d != null ? (d >= 0 ? ` ▲${num(d)}` : ` ▼${num(-d)}`) : ""}</span></span>`; }).join("")}</div></div>`;
  }
  function transcriptView() {
    const t = S.transcript; if (!t) return `<div class="card"><p class="mut">Transcript unavailable.</p></div>`;
    return `${Object.keys(t.gpa || {}).length ? `<div class="card"><h2>Cumulative GPA</h2><dl class="kv" style="margin-top:8px">${Object.entries(t.gpa).map(([a, b]) => `<dt>${esc(a)}</dt><dd>${b ?? "—"}</dd>`).join("")}</dl></div>` : ""}
    ${(t.semesters || []).map(s => `<div class="card"><div class="row sp wrap"><h3 style="margin:0">${esc(s.year)} · Grade ${esc(s.grade_level)}</h3><span class="small mut">${esc(s.school)}${s.credits != null ? " · " + s.credits + " credits" : ""}</span></div>
      <table style="margin-top:6px"><thead><tr><th>Course</th><th class="r">SEM1</th><th class="r">SEM2</th><th class="r">Final</th><th class="r">Credit</th></tr></thead><tbody>${s.courses.map(c => `<tr><td>${esc(c.description || c.course)}<div class="small mut">${esc(c.course)}</div></td><td class="r">${c.sem1 != null ? pill(c.sem1) : "—"}</td><td class="r">${c.sem2 != null ? pill(c.sem2) : "—"}</td><td class="r">${c.fin != null ? pill(c.fin) : "—"}</td><td class="r mut">${c.credit ?? ""}</td></tr>`).join("")}</tbody></table></div>`).join("") || '<div class="card"><p class="mut">No completed semesters yet.</p></div>'}`;
  }
  function teachersView() {
    const m = new Map();
    (S.classes || []).filter(c => !c.mps || c.mps.includes("Q" + curQ())).forEach(c => { if (!c.teacher) return; const l = m.get(c.teacher) || []; l.push(c); m.set(c.teacher, l); });
    return `<div class="card">${m.size ? [...m].map(([t, l]) => `<div style="padding:13px 0;border-bottom:1px solid var(--line)"><b>${esc(titleCase(t))}</b><div class="small mut">${l.map(c => `${esc(c.description)} (P${esc(c.period)} · ${esc(c.days)} day · Room ${esc(c.room || "N/A")})`).join("<br>")}</div></div>`).join("") : '<p class="mut">No teacher info found.</p>'}</div>`;
  }
  function profileView() {
    const r = S.registration || {};
    return `<div class="card"><dl class="kv">${[["Name", r.name], ["Student ID", r.student_id], ["Grade", r.grade], ["Class of", classOf()], ["School", r.school], ["Counselor", titleCase(r.counselor)], ["Homeroom", r.homeroom], ["Homeroom teacher", r.homeroom_teacher], ["House / team", r.house]].map(([a, b]) => `<dt>${a}</dt><dd>${esc(b || "—")}</dd>`).join("")}</dl></div>`;
  }
  const SW = (id, label, desc, on) => `<div class="set"><div><b>${label}</b><p>${desc}</p></div><label class="sw"><input type="checkbox" data-chg="set_${id}" ${on ? "checked" : ""}><i></i></label></div>`;
  function settingsView() {
    const st = settings(), perm = "Notification" in window ? Notification.permission : "unsupported";
    const themes = [["light", "Light", "#e6f2ec", "#13221c"], ["dark", "Dark", "#0b1210", "#34d399"], ["galaxy", "Galaxy", "#241548", "#a78bfa"], ["ember", "Ember", "#fbeee3", "#d9480f"], ["tide", "Tide", "#e3f1fb", "#0369a1"]];
    const accents = ["", "#0f766e", "#2563eb", "#7c3aed", "#db2777", "#e4572e", "#d97706", "#16a34a"];
    return `<div class="card"><h3>Appearance</h3><div class="theme">${themes.map(([k, l, bg, fg]) => `<button data-act="theme" data-arg="${k}" class="${st.theme === k ? "on" : ""}" style="background:${bg};color:${fg}">${l}</button>`).join("")}</div>
      <h3 style="margin-top:20px">Accent color</h3><div class="swatches">${accents.map(a => `<button data-act="accent" data-arg="${a}" class="${st.accent === a ? "on" : ""}" style="background:${a || "conic-gradient(#0f766e,#2563eb,#7c3aed,#db2777,#e4572e,#d97706,#0f766e)"}" title="${a || "Theme default"}"></button>`).join("")}</div></div>
    <div class="card"><h3>Dashboard</h3>${SW("showGpa", "Show GPA on dashboard", "Off by default for privacy — your GPA stays hidden until you turn this on, so opening Aceify in front of others reveals nothing.", st.showGpa)}${SW("showRecent", "Recently posted grades", "A feed of grades that changed since your last visit.", st.showRecent)}${SW("showMissing", "Missing work", "Assignments HAC marks missing, late or zero this quarter.", st.showMissing)}</div>
    <div class="card"><h3>Performance</h3>${SW("lowblur", "Reduce blur", "Lighter glass effects — smoother on Chromebooks and older devices.", st.lowblur)}${SW("nomotion", "Reduce motion", "Turn off animations.", st.nomotion)}</div>
    <div class="card"><h3>Alerts &amp; data</h3>${SW("notify", "Grade notifications", `Notify when a new grade posts. Works while Aceify is open in a tab (permission: ${perm}). Background alerts with the app closed would require storing your HAC password on a server, which Aceify never does.`, st.notify)}${SW("autoRefresh", "Auto-refresh", "Re-check HAC every 10 minutes while Aceify is open.", st.autoRefresh)}${SW("offline", "Offline copy", "Keep your last-loaded grades on this device so you can view them without signing in. Leave off on shared computers.", st.offline)}</div>
    <div class="card"><h3>Install</h3><p class="small mut" style="margin:0;line-height:1.6">iPhone: Safari → Share → Add to Home Screen · Android: Chrome ⋮ → Install app · Chromebook / Windows / Mac: Chrome's install icon in the address bar.</p></div>
    <div class="card"><div class="row sp wrap"><div><h3 style="margin:0">Session</h3><p class="small mut" style="margin:4px 0 0">Signed in as ${esc((S.me.accounts.find(x => x.id === S.me.active) || {}).name || "")}. Your password is never saved.</p></div><div class="row"><button class="btn sm" data-act="wipe">Erase local data</button><button class="btn sm pri" data-act="logout">Sign out</button></div></div></div>`;
  }
  const INFO = {
    faq: ["FAQ", `<div class="card"><h3>What is Aceify?</h3><p class="small" style="line-height:1.65">A cleaner view of Home Access Center: every class average, recently posted grades, missing work, a Frisco ISD GPA calculator, agenda, schedule, transcript and progress reports.</p><h3>Is it safe?</h3><p class="small" style="line-height:1.65">Aceify sends your HAC username and password to HAC once to sign in. The password is never stored or logged — when your session ends (30 minutes idle) you sign in again. Grades are kept in server memory only while you're signed in. Aceify only reads HAC; it never changes anything.</p><h3>Is it official?</h3><p class="small" style="line-height:1.65">No. It's an independent student project, not affiliated with Frisco ISD or Skyward. The district doesn't support third-party grade apps, so using one is your family's decision. Your transcript is the official record for GPA and rank.</p><h3>Why do I have to sign in each time?</h3><p class="small" style="line-height:1.65">Because Aceify refuses to keep your password. You can have it remember your student ID so only the password is left to type.</p></div>`],
    gpaguide: ["GPA Guide", `<div class="card"><h3>Weighted GPA (for rank)</h3><p class="small" style="line-height:1.65">Points = tier maximum − 0.1 for every point below 100. Below 70 earns 0.</p><table><thead><tr><th>Semester grade</th><th class="r">Tier III (6.0)</th><th class="r">Tier II (5.5)</th><th class="r">Tier I (5.0)</th></tr></thead><tbody>${[100, 95, 90, 85, 80, 75, 70].map(g => `<tr><td>${g}</td>${[3, 2, 1].map(t => `<td class="r">${G.weightedPoints(g, t).toFixed(1)}</td>`).join("")}</tr>`).join("")}<tr><td>Below 70</td><td class="r">0</td><td class="r">0</td><td class="r">0</td></tr></tbody></table><h3 style="margin-top:18px">Unweighted GPA</h3><p class="small">90–100 = 4.0 · 80–89 = 3.0 · 70–79 = 2.0 · below 70 = 0</p><h3>Which tier?</h3><p class="small" style="line-height:1.65"><b>Tier III:</b> AP, IB, dual credit (class of 2030+). <b>Tier II:</b> "Adv" courses, Independent Study &amp; Mentorship, Academic Decathlon, PLTW engineering, dual credit (before 2030). <b>Tier I:</b> everything else.</p><p class="small mut" style="line-height:1.65">Source: Frisco ISD 2026-27 High School Academic Guide. A 2-credit course counts twice; credit-by-exam and pass/fail courses don't count. Valedictorian/salutatorian use five decimals.</p></div>`],
    hacguide: ["HAC Guide", `<div class="card"><h3>Score codes</h3><table><tbody>${[["ABS", "Absent — counts as zero"], ["L", "Late — counts as zero"], ["M", "Missing — flagged, not averaged until scored"], ["ILAB", "Incomplete lab — flagged missing"], ["T", "Not counted"], ["X", "Excused — not counted"], ["CNS", "Not counted"]].map(([a, b]) => `<tr><td><span class="tag" style="margin:0">${a}</span></td><td class="small">${b}</td></tr>`).join("")}</tbody></table><h3 style="margin-top:18px">Category weights</h3><p class="small" style="line-height:1.65">Many Frisco ISD classes weight only some categories (for example Assessment of Learning = 100%, Progress Checks = 0%). Aceify uses the same category math HAC does, so what-if numbers match.</p></div>`],
  };
  const MORE_TITLES = { teachers: "Teachers", ipr: "Interim Progress", transcript: "Transcript", reportcard: "Report Card", profile: "Profile", settings: "Settings" };
  function subPage(v) {
    if (INFO[v]) return `<h1>${INFO[v][0]}</h1><p class="sub"></p>${INFO[v][1]}`;
    if (v === "trends") return trendsView();
    let body;
    if (v === "ipr") body = iprView();
    else if (v === "reportcard") { if (!S.reportcard) { lazy("reportcard", "reportcard"); body = NOTE_LOAD; } else body = tableCard(S.reportcard); }
    else if (v === "transcript") body = transcriptView();
    else if (v === "teachers") body = teachersView();
    else if (v === "profile") body = profileView();
    else body = settingsView();
    return `<h1>${MORE_TITLES[v] || "Settings"}</h1><p class="sub">${v === "ipr" ? "Mid-quarter progress reports. A ▼ flags a class that dropped since the previous report." : ""}</p>${body}`;
  }

  /* ================= shell, nav, render ================= */
  const boot = { shell: false };
  const NAVG = [["OVERVIEW", [["dashboard", "Dashboard", "grid"], ["grades", "Grades", "book"], ["gpa", "GPA", "award"]]], ["PLANNER", [["agenda", "Agenda", "cal"], ["schedule", "Schedule", "clock"], ["plan", "Course plan", "map"]]],
    ["RECORDS", [["trends", "Trends", "trend"], ["transcript", "Transcript", "file"], ["reportcard", "Report card", "clip"], ["ipr", "Progress reports", "flag"], ["teachers", "Teachers", "users"]]],
    ["HELP", [["faq", "FAQ", "help"], ["gpaguide", "GPA guide", "help"], ["hacguide", "HAC guide", "help"]]], ["ACCOUNT", [["settings", "Settings", "sliders"], ["profile", "Profile", "user"]]]];
  function buildShell() {
    $("#app").innerHTML = `<div class="shell"><aside class="side"><div class="brandrow"><div class="brand" data-act="nav" data-arg="dashboard"><i>A</i>Aceify</div><button class="sbtoggle" data-act="sidebar" title="Hide sidebar ( [ )">${ic("chev")}</button></div>
      ${NAVG.map(([g, items]) => `<h6>${g}</h6>${items.map(([k, l, i]) => `<button class="nv" data-act="nav" data-arg="${k}" data-nav="${k}">${ic(i)}<span>${l}</span></button>`).join("")}`).join("")}
      <div class="sidefoot"><div class="pop" id="pop-acct"></div><button class="me" data-act="pop" data-arg="acct"><span class="av" id="avatar"></span><span><b id="meName"></b><small>Frisco ISD</small></span></button></div></aside>
      <div class="content"><button class="sbopen" data-act="sidebar" title="Show sidebar ( [ )">${ic("menu")}</button><main id="main"></main></div></div>`;
    boot.shell = true;
  }
  function syncShell() {
    const sh = document.querySelector(".shell"); if (sh) sh.classList.toggle("col", !!settings().sideCollapsed);
    document.querySelectorAll(".nv").forEach(b => b.classList.toggle("on", b.dataset.nav === S.view));
    const a = S.me.accounts.find(x => x.id === S.me.active) || {};
    const ini = (a.name || "A").replace(/[^A-Za-z ,]/g, "").split(/[ ,]+/).filter(Boolean).slice(0, 2).map(x => x[0]).join("").toUpperCase() || "A";
    $("#avatar").textContent = ini; $("#meName").textContent = titleCase(a.name || "");
    $("#pop-acct").innerHTML = `<h6>ACCOUNTS</h6>${S.me.accounts.map(x => `<button data-act="switch" data-arg="${esc(x.id)}"><span>${x.id === S.me.active ? "✓ " : ""}${esc(titleCase(x.name))}</span>${S.me.accounts.length > 1 ? `<span class="tag mut" data-act="remove" data-arg="${esc(x.id)}">remove</span>` : ""}</button>`).join("")}<button data-act="addacct">＋ Add account</button><button data-act="logout">Sign out</button>`;
    document.querySelectorAll(".pop").forEach(p => p.classList.toggle("open", p.id === "pop-" + S.pop));
  }
  function applyLook() {
    const st = settings(), r = document.documentElement;
    r.setAttribute("data-theme", st.theme);
    if (st.accent) {
      const h = st.accent.replace("#", ""), lum = (parseInt(h.slice(0, 2), 16) * .299 + parseInt(h.slice(2, 4), 16) * .587 + parseInt(h.slice(4, 6), 16) * .114) / 255;
      r.style.setProperty("--brand", st.accent); r.style.setProperty("--brand-ink", lum > .62 ? "#10201a" : "#fff");
    } else { r.style.removeProperty("--brand"); r.style.removeProperty("--brand-ink"); }
    document.body.classList.toggle("nomotion", !!st.nomotion); document.body.classList.toggle("lowblur", !!st.lowblur);
  }
  function render() {
    applyLook();
    if (!S.me) { boot.shell = false; $("#app").innerHTML = loginView(); return; }
    if (!boot.shell || !$("#main")) buildShell();
    const m = $("#main"), y = window.scrollY, focus = document.activeElement && document.activeElement.id;
    let body;
    if (!S.all) body = skeleton();
    else if (S.view === "dashboard") body = dashboard();
    else if (S.view === "grades") body = gradesView();
    else if (S.view === "gpa") body = gpaView();
    else if (S.view === "agenda") body = agendaView();
    else if (S.view === "schedule") body = scheduleView();
    else if (S.view === "plan") body = planView();
    else body = subPage(S.view);
    m.className = S.animate ? "enter" : "";
    m.innerHTML = body;
    const animated = S.animate; S.animate = false;
    syncShell();
    if (!animated) window.scrollTo(0, y);
    if (focus) { const el = document.getElementById(focus); if (el) { el.focus(); if (el.setSelectionRange && el.type === "text") { const n = el.value.length; el.setSelectionRange(n, n); } } }
  }
  function go(v) { S.view = v; S.pop = null; S.animate = true; window.scrollTo(0, 0); }

  /* ================= events ================= */
  const acts = {
    nav: a => { go(a === "agendaWeek" ? "agenda" : a); if (a === "agendaWeek") { S.agendaMode = "week"; S.wk = 0; } },
    pop: a => { S.pop = S.pop === a ? null : a; },
    openClass: a => { go("grades"); S.open.add(a); S.q = curMp(); S.search = ""; setTimeout(() => { const e = document.querySelector(`[data-card="${CSS.escape(a)}"]`); e && e.scrollIntoView({ behavior: "smooth", block: "center" }); }, 80); },
    toggle: a => { const el = document.querySelector(`[data-card="${CSS.escape(a)}"]`); if (S.open.has(a)) S.open.delete(a); else S.open.add(a); if (el) { el.classList.toggle("open", S.open.has(a)); return "skip"; } },
    quarter: a => { S.q = a; },
    refresh: () => { loadAll(true); return "skip"; },
    markSeen: () => ASet("recent", []),
    dashView: a => { S.dashGrid = a === "grid"; },
    dismiss: a => { const d = A("dismissed", []); d.push(a); ASet("dismissed", d); },
    dismissAll: () => ASet("dismissed", allAssignments().filter(a => a.mp === curMp() && isMissingish(a)).map(a => a.course + "|" + a.name)),
    resetWi: a => { delete S.whatif[a]; delete S.hyp[a]; S.zeroMissing = false; },
    resetAll: () => { S.whatif = {}; S.hyp = {}; S.zeroMissing = false; },
    addhyp: a => { const i = a.lastIndexOf("|"), key = a.slice(0, i), mp = a.slice(i + 1), co = findCourse(mp, key); (S.hyp[a] ||= []).push({ score: 100, max: 100, category: co ? defaultCat(co) : "" }); },
    rmhyp: a => { const i = a.lastIndexOf("#"); S.hyp[a.slice(0, i)].splice(+a.slice(i + 1), 1); },
    selAll: () => ASet("excl", {}), selNone: () => { const e = {}; courseList().forEach(c => e[c.key] = true); trRows().forEach(r => e[r.key] = true); ASet("excl", e); },
    resetQ: () => { ASet("qedit", {}); ASet("tier", {}); ASet("credit", {}); ASet("excl", {}); toast("Everything is back to its default"); },
    sidebar: () => { setSetting("sideCollapsed", !settings().sideCollapsed); syncShell(); return "skip"; },
    ptab: a => { S.planTab = a; if (a === "requests" && !S.requests) lazy("requests", "requests"); },
    cycleTier: a => { const t = tierOv(), cur = t[a] || tierFor(a), nx = cur % 3 + 1; t[a] = nx; ASet("tier", t); },
    resetPlan: () => { ASet("plandraft", []); ASet("tier", {}); toast("Plan changes cleared"); },
    addDraft: () => { const name = $("#dName").value.trim(), cr = parseFloat($("#dCr").value); if (!name || !(cr > 0)) { toast("Add a course name and credits"); return "skip"; }
      const l = drafts(); l.push({ id: Date.now(), subject: $("#dSub").value, gi: +$("#dGrade").value, name, credit: cr }); ASet("plandraft", l); },
    rmDraft: a => ASet("plandraft", drafts().filter(d => String(d.id) !== a)),
    taskAdd: () => { const t = $("#tTxt").value.trim(); if (!t) return "skip"; const l = A("tasks", []); l.push({ text: t, date: $("#tDate").value, cls: $("#tCls").value, done: false }); ASet("tasks", l); },
    taskDel: a => { const l = A("tasks", []); l.splice(+a, 1); ASet("tasks", l); },
    amode: a => { S.agendaMode = a; if (a === "day") S.day = S.day || new Date(new Date().setHours(0, 0, 0, 0)); },
    wk: a => { a = +a; if (S.agendaMode === "day") { const d = new Date(S.day || new Date()); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() + a); S.day = a === 0 ? new Date(new Date().setHours(0, 0, 0, 0)) : d; } else S.wk = a === 0 ? 0 : S.wk + a; },
    afilter: a => { S.agendaFilter = a || null; },
    theme: a => setSetting("theme", a), accent: a => setSetting("accent", a),
    wipe: () => { if (!confirm("Erase tasks, GPA choices and saved data from this device?")) return "skip"; Object.keys(localStorage).filter(k => k.startsWith("aceify_")).forEach(k => localStorage.removeItem(k)); toast("Erased"); },
    login: async () => {
      $("#err").textContent = ""; $("#go").innerHTML = '<span class="spin"></span> Signing in…';
      try {
        const u = $("#u").value.trim();
        S.me = await api("login", { body: JSON.stringify({ district: $("#dist").value, username: u, password: $("#p").value }) });
        lsSet("remembered", $("#rem").checked ? u : ""); S.loginMsg = ""; S._addFrom = null; resetData(); S.animate = true; await loadAll();
      } catch (e) { S.loginMsg = e.message; render(); }
      return "skip";
    },
    offline: () => { const o = lsGet("offline_last", null); if (!o) return "skip"; S.me = { active: "off", accounts: [{ id: "off", name: "Offline copy", district: "frisco" }] }; Object.assign(S, { all: o.all, classes: o.classes, transcript: o.tr, registration: o.reg, reportcard: o.rc, updated: new Date(o.at), q: o.all.current }); },
    cancelAdd: () => { S.me = S._addFrom; S._addFrom = null; },
    addacct: () => { S._addFrom = S.me; S.me = null; S.loginMsg = ""; S.pop = null; },
    switch: async a => { S.me = await api("switch", { body: JSON.stringify({ id: a }) }); S.pop = null; resetData(); await loadAll(); return "skip"; },
    remove: async a => { try { S.me = await api("remove", { body: JSON.stringify({ id: a }) }); } catch { return; } S.pop = null; resetData(); if (!S.me.accounts.length) S.me = null; else await loadAll(); },
    logout: async () => { await api("logout", { method: "POST" }).catch(() => { }); try { localStorage.removeItem("aceify_offline_last"); } catch { } S.me = null; S.pop = null; resetData(); },
  };
  function resetData() { Object.assign(S, { all: null, classes: [], transcript: null, registration: null, reportcard: null, ipr: null, plan: null, requests: null, whatif: {}, hyp: {}, zeroMissing: false, q: null, open: new Set(), view: "dashboard", search: "", wk: 0, day: null, agendaFilter: null }); }

  document.addEventListener("click", async e => {
    const el = e.target.closest("[data-act]");
    if (!el) { if (S.pop && !e.target.closest(".pop")) { S.pop = null; render(); } return; }
    const fn = acts[el.dataset.act]; if (!fn) return;
    if (el.dataset.act === "remove") e.stopPropagation();
    const r = await fn(el.dataset.arg);
    if (r !== "skip") render();
  });
  document.addEventListener("keydown", e => { if (e.key === "[" && S.me && !/^(INPUT|SELECT|TEXTAREA)$/.test((e.target.tagName || ""))) { acts.sidebar(); return; } if (e.key === "Enter" && e.target.id === "p") acts.login(); if (e.key === "Escape" && S.pop) { S.pop = null; render(); } });
  document.addEventListener("input", e => { if (e.target.id === "search") { S.search = e.target.value; render(); } });
  document.addEventListener("change", e => {
    if (e.target.id === "sort") { S.sort = e.target.value; render(); return; }
    const el = e.target.closest("[data-chg]"); if (!el) return;
    const kind = el.dataset.chg, arg = el.dataset.arg, v = el.type === "checkbox" ? el.checked : el.value.trim();
    if (kind === "wi") { const i = arg.lastIndexOf("|"), k = arg.slice(0, i), idx = arg.slice(i + 1); (S.whatif[k] ||= {}); if (v === "") delete S.whatif[k][idx]; else if (!isNaN(Number(v))) S.whatif[k][idx] = Number(v); }
    else if (kind === "zeroMissing") S.zeroMissing = v;
    else if (kind === "planX") { const n = parseFloat(v); if (n >= 0 && n <= 100) ASet("planX", n); }
    else if (kind === "planTarget") { const n = parseFloat(v); if (n > 0 && n <= 6) ASet("planTarget", n); }
    else if (kind === "hscore" || kind === "hmax" || kind === "hcat") { const j = arg.lastIndexOf("#"), h = (S.hyp[arg.slice(0, j)] || [])[+arg.slice(j + 1)]; if (h) { if (kind === "hcat") h.category = v; else { const n = parseFloat(v); if (!isNaN(n) && (kind === "hscore" || n > 0)) h[kind === "hscore" ? "score" : "max"] = n; } } }
    else if (kind === "tier") { const t = tierOv(); t[arg] = +v; ASet("tier", t); }
    else if (kind === "credit") { const c = credOv(), n = parseFloat(v); if (n > 0) c[arg] = n; ASet("credit", c); }
    else if (kind === "incl") { const x = exclOv(); if (v) delete x[arg]; else x[arg] = true; ASet("excl", x); }
    else if (kind === "qedit") { const i = arg.lastIndexOf("|"), k = arg.slice(0, i), n = arg.slice(i + 1), ed = qEdits(); (ed[k] ||= {}); if (v === "" || isNaN(Number(v))) delete ed[k][n]; else ed[k][n] = Number(v); ASet("qedit", ed); }
    else if (kind === "tdone") { const l = A("tasks", []); l[+arg].done = v; ASet("tasks", l); }
    else if (kind.startsWith("set_")) {
      const key = kind.slice(4); setSetting(key, v);
      if (key === "notify" && v && "Notification" in window && Notification.permission === "default") Notification.requestPermission().then(render);
      if (key === "offline" && !v) { try { localStorage.removeItem("aceify_offline_last"); } catch { } }
    }
    render();
  });
  window.addEventListener("resize", () => { if (S.me && boot.shell) syncShell(); });

  /* ================= boot ================= */
  async function start() {
    applyLook();
    try { S.me = await api("me"); } catch { S.me = null; render(); return; }
    S.animate = true; render(); await loadAll();
  }
  setInterval(() => { if (S.me && S.all && !S.loading && settings().autoRefresh && document.visibilityState === "visible" && S.me.active !== "off") loadAll(true); }, 10 * 60 * 1000);
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => { });
  start();
})();
