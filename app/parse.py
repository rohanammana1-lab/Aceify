"""HTML parsers for Home Access Center (HAC) pages.

Selectors come from open-source HAC scrapers (nitheesh-cpu/HomeAccessCenterAPI, BSD-3) and HAC's own markup
conventions (div.AssignmentClass, table.sg-asp-table, tr.sg-asp-table-data-row, ids containing
CourseAssignments / CourseCategories, plnMain_* ids). Tables are read by header NAME, never by column index,
so small layout differences between districts do not break parsing. Everything here is pure
(str -> dict) so it can be unit tested with saved HTML.
"""
import re
from bs4 import BeautifulSoup

NUM = re.compile(r"-?\d+(?:\.\d+)?")


def soup(html):
    return BeautifulSoup(html, "lxml")


def _txt(el):
    return re.sub(r"\s+", " ", el.get_text(" ", strip=True)).strip() if el else ""


def to_num(s, last=False):
    if s is None:
        return None
    found = NUM.findall(str(s).replace(",", ""))
    if not found:
        return None
    return float(found[-1] if last else found[0])


def clean_course_name(raw):
    """'ALG2A  - 2  Algebra 2 Adv' -> 'Algebra 2 Adv' (best effort)."""
    raw = re.sub(r"\s+", " ", raw).strip()
    m = re.match(r"^[\w\-./]+\s*-\s*\d+\s+(.*)$", raw)
    name = (m.group(1) if m else raw).strip()
    return re.sub(r"\s+S[12]$", "", name).strip()


# ---------------------------------------------------------------- login
def parse_login_token(html):
    t = soup(html).find("input", {"name": "__RequestVerificationToken"})
    return t["value"] if t and t.has_attr("value") else None


def login_failed(html):
    low = html.lower()
    return "logondetails.username" in low and "logondetails.password" in low


def logged_in(html):
    """True if the page looks like an authenticated HAC page."""
    s = soup(html)
    return bool(s.select_one(".sg-banner-menu-container, [id^=plnMain_]")) and not login_failed(html)


# ---------------------------------------------------------------- score codes
MISSING_CODES = {"M", "ILAB", "MISSING"}
ZERO_CODES = {"ABS", "L"}
EXEMPT_CODES = {"T", "X", "CNS", "EXC", "EXEMPT", "EXCUSED", "NA", "N/A"}


def classify_score(text, flags=""):
    """Turn a HAC score cell into numeric/flags. Rules (from HAC grade codes):
    ABS and L count as zero; M and ILAB are flagged missing (not averaged until a score is posted);
    T, X, CNS and similar do not count in the average."""
    t = (text or "").strip()
    desc = ""
    m = re.match(r"^([A-Za-z]{1,5})\s*-\s*(.+)$", t)       # real HAC writes codes as "L - Late Work"
    if m:
        t, desc = m.group(1), m.group(2).strip()
    up = t.upper()
    out = {"score": None, "code": "", "desc": desc, "missing": False, "late": False, "exempt": False, "zero": False}
    flags = (flags or "").lower()
    if "late" in flags:
        out["late"] = True
    if re.fullmatch(r"-?\d+(\.\d+)?", t.replace(",", "")):
        out["score"] = float(t.replace(",", ""))
        out["zero"] = out["score"] == 0
    elif up in ZERO_CODES:
        out.update(score=0.0, code=up, zero=True, late=out["late"] or up == "L")
    elif up in MISSING_CODES or "missing" in flags:
        out.update(code=up if up in MISSING_CODES else "M", missing=True)
    elif up in EXEMPT_CODES or re.search(r"exempt|excused", flags) or (up.isalpha() and 0 < len(up) <= 4):
        out.update(code=up, exempt=True)
    elif t:
        n = to_num(t)
        out["score"] = n
    return out


# ---------------------------------------------------------------- tables
def _headers(table):
    row = table.select_one("tr.sg-asp-table-header-row") or table.select_one("thead tr") or table.select_one("tr")
    if not row:
        return []
    if row.get("class") and "sg-asp-table-header-row" in row.get("class"):
        return [_txt(t).lower() for t in row.find_all(["th", "td"])]
    return [_txt(t).lower() for t in row.find_all("th")]


def _col(headers, *needles):
    for i, h in enumerate(headers):
        if any(n in h for n in needles):
            return i
    return None


def _rows(table):
    rows = table.select("tr.sg-asp-table-data-row")
    if rows:
        return rows
    return [r for r in table.select("tr") if r.find("td") and not r.find("th")]


def parse_form(html):
    """All fields of the ASP.NET form (hidden inputs, text, checked boxes, selected options, submit buttons)."""
    s = soup(html)
    form = s.find("form") or s
    data, buttons = {}, {}
    for i in form.select("input[name]"):
        typ = (i.get("type") or "text").lower()
        if typ in ("submit", "button", "image"):
            buttons[i["name"]] = i.get("value", "")
        elif typ in ("checkbox", "radio"):
            if i.has_attr("checked"):
                data[i["name"]] = i.get("value", "on")
        else:
            data[i["name"]] = i.get("value", "")
    for sel in form.select("select[name]"):
        opt = sel.find("option", selected=True) or sel.find("option")
        if opt:
            data[sel["name"]] = opt.get("value", _txt(opt))
    return data, buttons


# ---------------------------------------------------------------- assignments / grades
def parse_assignments(html):
    """Assignments.aspx -> {mp, mps, courses:[{name, teacher, average, level?, categories, assignments}]}"""
    s = soup(html)
    sel = s.select_one("select[id$=ddlReportCardRuns]")
    mps, cur = [], None
    if sel:
        for o in sel.find_all("option"):
            if (o.get("value") or "").upper() == "ALL" or "all runs" in _txt(o).lower():
                continue
            n = re.search(r"\d+", _txt(o))
            mps.append({"value": o.get("value"), "label": ("Q" + n.group()) if n else _txt(o)})
            if o.has_attr("selected"):
                cur = o.get("value")
        if cur is None and mps:
            cur = mps[0]["value"]
    courses = []
    for box in s.select("div.AssignmentClass"):
        head = box.select_one("a.sg-header-heading")
        raw = _txt(head)
        avg_el = box.select_one("[id*=lblHdrAverage]") or box.select_one("span.sg-header-heading")
        avg = to_num(_txt(avg_el), last=True) if avg_el else None
        teacher_el = box.select_one(".sg-header-sub-heading")
        upd = re.search(r"\d{1,2}/\d{1,2}/\d{2,4}", _txt(teacher_el))
        course = {"raw": raw, "name": clean_course_name(raw), "updated": upd.group() if upd else "",
                  "average": avg, "assignments": [], "categories": []}
        for table in box.select("table.sg-asp-table"):
            tid = table.get("id", "")
            h = _headers(table)
            is_cat = "CourseCategories" in tid or (_col(h, "category") is not None and _col(h, "assignment") is None)
            if is_cat:
                ci = _col(h, "category") if _col(h, "category") is not None else 0
                pi = _col(h, "student's points", "points")
                mi, wi = _col(h, "maximum"), _col(h, "weight")
                pi, mi, wi = (1 if pi is None else pi), (2 if mi is None else mi), (4 if wi is None else wi)  # real HAC leaves these headers blank
                for tr in _rows(table):
                    tds = [_txt(td) for td in tr.find_all("td")]
                    if len(tds) < 3 or ci is None or not tds[ci] or tds[ci].lower() in ("total", "totals"):
                        continue
                    course["categories"].append({
                        "name": tds[ci],
                        "points": to_num(tds[pi]) if pi is not None and pi < len(tds) else None,
                        "max": to_num(tds[mi]) if mi is not None and mi < len(tds) else None,
                        "weight": to_num(tds[wi]) if wi is not None and wi < len(tds) else None,
                    })
                continue
            ni = _col(h, "assignment", "name")
            if ni is None:
                continue
            di, ai, cati = _col(h, "due"), _col(h, "assigned"), _col(h, "category")
            si, ti = _col(h, "score"), _col(h, "total points", "max")
            for tr in _rows(table):
                tds = tr.find_all("td")
                if len(tds) <= ni:
                    continue

                def get(i):
                    return _txt(tds[i]).replace("*", "").strip() if i is not None and i < len(tds) else ""

                name = get(ni)
                if not name:
                    continue
                icon_flags = " ".join((i.get("title", "") + " " + i.get("alt", "")) for i in tr.find_all("img"))
                info = classify_score(get(si), icon_flags)
                info.update({"name": name, "due": get(di), "assigned": get(ai), "category": get(cati),
                             "max": to_num(get(ti)), "graded": info["score"] is not None})
                course["assignments"].append(info)
        courses.append(course)
    return {"mp": cur, "mps": mps, "courses": courses}


# ---------------------------------------------------------------- generic tables (report card, IPR, classes)
def parse_tables(html, min_cols=3):
    """Every header-bearing table -> {headers, rows:[{header: text}]}. Used for pages where only column names matter."""
    out = []
    for table in soup(html).select("table"):
        h = _headers(table)
        if len(h) < min_cols:
            continue
        rows = []
        for tr in _rows(table):
            tds = [_txt(td) for td in tr.find_all("td")]
            if len(tds) < max(2, len(h) // 2) or not any(tds):
                continue
            rows.append({h[i] if i < len(h) and h[i] else f"col{i}": tds[i] for i in range(len(tds))})
        if rows:
            out.append({"headers": h, "rows": rows})
    return out


def _pick(tables, *needles):
    for t in tables:
        if all(any(n in h for h in t["headers"]) for n in needles):
            return t
    return None


def _g(row, *needles):
    for k, v in row.items():
        if any(n in k.lower() for n in needles):
            return v
    return ""


def parse_classes(html):
    """Schedule rows: course, description, period, teacher, room, days (A/B), marking periods (Q1, Q2), building."""
    tables = parse_tables(html)
    t = _pick(tables, "course", "period") or _pick(tables, "description", "period")
    if not t:
        return []
    return [{"course": _g(r, "course"), "description": _g(r, "description") or _g(r, "course"),
             "period": _g(r, "period"), "teacher": _g(r, "teacher"), "room": _g(r, "room"),
             "days": _g(r, "days"), "mps": _g(r, "marking"), "status": _g(r, "status")}
            for r in t["rows"] if _g(r, "period") and _g(r, "status").lower() != "dropped"]


def parse_report_card(html):
    tables = parse_tables(html, 5)
    t = _pick(tables, "course", "period") or _pick(tables, "description")
    return {"headers": t["headers"], "rows": t["rows"]} if t else {"headers": [], "rows": []}


def parse_ipr(html):
    """Interim progress report for the currently selected date: rows + list of available dates."""
    s = soup(html)
    sel = s.select_one("select[id$=ddlIPRDates]")
    dates, cur = [], None
    if sel:
        for o in sel.find_all("option"):
            dates.append({"value": o.get("value"), "label": _txt(o)})
            if o.has_attr("selected"):
                cur = o.get("value")
        if cur is None and dates:
            cur = dates[0]["value"]
    tables = parse_tables(html, 3)
    big = max(tables, key=lambda t: len(t["rows"]), default=None)
    return {"headers": big["headers"] if big else [], "rows": big["rows"] if big else [], "dates": dates, "date": cur}


# ---------------------------------------------------------------- registration / transcript
def _span(s, ident):
    el = s.find(id=ident)
    return _txt(el)


def parse_registration(html):
    s = soup(html)
    return {"name": _span(s, "plnMain_lblRegStudentName"), "grade": _span(s, "plnMain_lblGrade"),
            "school": _span(s, "plnMain_lblBuildingName"), "counselor": _span(s, "plnMain_lblCounselor"),
            "student_id": _span(s, "plnMain_lblRegStudentID"), "house": _span(s, "plnMain_lblHouseTeam"),
            "homeroom": _span(s, "plnMain_lblHomeroom"), "homeroom_teacher": _span(s, "plnMain_lblHomeroomTeacher"),
            "cohort": _span(s, "plnMain_lblCohortYear"), "language": _span(s, "plnMain_lblLanguage")}


def parse_student_name(html):
    s = soup(html)
    box = s.select_one("div.sg-banner-menu-container")
    if box and box.find("span"):
        return _txt(box.find("span"))
    return ""


def parse_transcript(html):
    """Transcript.aspx. Tables appear in order: [Year/Grade/Building], dgCourses_N (Course, Description, SEM1, SEM2, FIN, Credit),
    'Total Credit', ... then tblCumGPAInfo. A course's grade = FIN, else the mean of SEM1/SEM2, else whichever exists."""
    s = soup(html)
    semesters, cur = [], None
    for table in s.select("table"):
        tid = table.get("id", "") or ""
        if "dgCourses" in tid:
            h = _headers(table)
            cur = {"year": cur["year"] if cur else "", "grade_level": cur["grade_level"] if cur else "",
                   "school": cur["school"] if cur else "", "courses": [], "credits": None}
            for tr in _rows(table):
                tds = [_txt(x) for x in tr.find_all("td")]
                row = {h[i] if i < len(h) else f"col{i}": tds[i] for i in range(len(tds))}
                sem1, sem2, fin = to_num(_g(row, "sem1")), to_num(_g(row, "sem2")), to_num(_g(row, "fin"))
                vals = [v for v in (sem1, sem2) if v is not None]
                grade = fin if fin is not None else (sum(vals) / len(vals) if vals else None)
                cur["courses"].append({"course": _g(row, "course"), "description": _g(row, "description"),
                                       "sem1": sem1, "sem2": sem2, "fin": fin, "grade": grade, "credit": to_num(_g(row, "credit"))})
            semesters.append(cur)
            continue
        text = _txt(table)
        if tid == "" and "Year:" in text and "Building:" in text and not table.select("tr.sg-asp-table-header-row"):
            tds = [_txt(x) for x in table.find_all("td")]
            info = {"year": "", "grade_level": "", "school": ""}
            for i, v in enumerate(tds):
                if v.startswith("Year") and i + 1 < len(tds):
                    info["year"] = tds[i + 1]
                if v.startswith("Grade") and i + 1 < len(tds):
                    info["grade_level"] = tds[i + 1]
                if v.startswith("Building") and i + 1 < len(tds):
                    info["school"] = tds[i + 1]
            if info["year"] and len(tds) < 12:
                cur = info
        elif "Total Credit" in text and semesters:
            semesters[-1]["credits"] = to_num(text.split("Total Credit")[-1])
    gpa = {}
    tbl = s.find("table", id="plnMain_rpTranscriptGroup_tblCumGPAInfo")
    if tbl:
        for tr in _rows(tbl):
            tds = [_txt(x) for x in tr.find_all("td")]
            if len(tds) >= 2 and tds[0]:
                gpa[tds[0].rstrip(":")] = to_num(tds[1])
    rank = _span(s, "plnMain_rpTranscriptGroup_lblGPARank3")
    return {"semesters": semesters, "gpa": gpa, "rank": rank}


# ---------------------------------------------------------------- course plan (Career Plan + Course Requests)
_COURSE = re.compile(r"^(?P<name>.*?)\s*\((?P<code>[A-Za-z0-9]+)(?:\s*-\s*\d+)?\)\s*$")
_TERM = re.compile(r"\s+(?P<term>S1|S2|YR)(?P<virt>@\w+)?$")


def parse_plan_course(raw):
    """'Algebra 2 Adv S1 (MTH12200A - 2)' -> {name:'Algebra 2 Adv', term:'S1', code:'MTH12200A', virtual:False, exam:False}"""
    raw = re.sub(r"\s+", " ", raw or "").strip()
    m = _COURSE.match(raw)
    name, code = (m.group("name"), m.group("code")) if m else (raw, "")
    t = _TERM.search(name)
    term, virtual = "", False
    if t:
        term, virtual = t.group("term"), bool(t.group("virt"))
        name = name[:t.start()]
    return {"name": name.strip(), "term": term, "code": code, "virtual": virtual,
            "exam": bool(re.match(r"^(EA|CBE)\b", name.strip()))}


def parse_career_plan(html):
    """CareerPlan.aspx -> {plan, grades:[{grade,year}], subjects:[{name,needed,est,courses:{gradeIdx:[course]}}], totals}.
    Rows with 3+2n cells start a subject; rows with 2n cells continue it. Italic course names = not complete yet."""
    s = soup(html)
    tbl = s.find("table", id="TblMain")
    out = {"plan": "", "grades": [], "subjects": [], "totals": {}}
    m = re.search(r"Foundation[^<\n]{0,60}", s.get_text("\n", strip=True))
    if m:
        out["plan"] = m.group(0).strip()
    if not tbl:
        return out
    n = 0
    cur = None
    for tr in tbl.select("tr"):
        cells = tr.find_all(["td", "th"])
        first = _txt(cells[0]) if cells else ""
        if "Subject Area" in first and len(cells) > 3:
            for c in cells[3:]:
                g = re.search(r"Grade\s*(\d+)\s*\(([^)]*)\)", _txt(c))
                out["grades"].append({"grade": g.group(1) if g else _txt(c), "year": g.group(2).strip() if g else ""})
            n = len(out["grades"])
            continue
        if not n:
            continue
        if first.startswith("To-Date Totals") or first.startswith("Estimated Totals"):
            vals = [to_num(_txt(c)) for c in cells[1:]]
            out["totals"]["todate" if first.startswith("To-Date") else "estimated"] = vals
            continue
        if "sg-cp-button-row" in (tr.get("class") or []) or "sg-asp-table-header-row" in (tr.get("class") or []):
            continue
        if len(cells) == 3 + 2 * n:
            cur = {"name": re.sub(r"^\d+\.\s*", "", first).strip(), "needed": to_num(_txt(cells[1])), "est": to_num(_txt(cells[2])), "courses": {}}
            out["subjects"].append(cur)
            off = 3
        elif len(cells) == 2 * n and cur is not None:
            off = 0
        else:
            continue
        for g in range(n):
            c, cr = cells[off + 2 * g], cells[off + 2 * g + 1]
            raw = _txt(c)
            if not raw:
                continue
            info = parse_plan_course(raw)
            info.update({"credit": to_num(_txt(cr)) or 0.0, "complete": not c.find(["i", "em"])})
            lst = cur["courses"].setdefault(g, [])
            if not any(x["code"] == info["code"] and x["name"] == info["name"] and x["term"] == info["term"] for x in lst):   # HAC repeats some year-long courses on two rows
                lst.append(info)
    return out


def parse_course_requests(html):
    """CourseRequests.aspx -> {year, building, requests:[{subject, course, credits}], subjects:[{name, required, completed, scheduled, planned, needed}]}"""
    s = soup(html)
    out = {"year": _span(s, "plnMain_dgYear_lblYear").strip("- ").strip(), "building": _span(s, "plnMain_dgYear_lblBuildingAndGrade"), "requests": [], "subjects": []}
    tbl = s.find("table", id="plnMain_dgYear_dgCourseRequests")
    subj = ""
    for tr in (tbl.select("tr") if tbl else []):
        cls = tr.get("class") or []
        tds = [_txt(x) for x in tr.find_all("td")]
        if "sg-requests-header" in cls and tds:
            subj = re.sub(r"^\d+\.\s*", "", re.sub(r"\s*\([A-Z]+\)\s*$", "", tds[0])).strip()
        elif "sg-requests-item" in cls and len(tds) >= 3 and tds[1]:
            info = parse_plan_course(tds[1])
            out["requests"].append({"subject": subj, "course": tds[1], "name": info["name"], "term": info["term"], "virtual": info["virtual"], "credits": to_num(tds[2]) or 0.0})
    t2 = s.find("table", id="plnMain_dgSubjectAreas")
    for tr in (_rows(t2) if t2 else []):
        tds = [_txt(x) for x in tr.find_all("td")]
        if len(tds) >= 6:
            out["subjects"].append({"name": re.sub(r"^\d+\.\s*", "", re.sub(r"\s*\([A-Z]+\)\s*$", "", tds[0])).strip(), "required": to_num(tds[1]), "completed": to_num(tds[2]),
                                    "scheduled": to_num(tds[3]), "planned": to_num(tds[4]), "needed": to_num(tds[5])})
    return out
