"""Home Access Center client. Logs in with the STUDENT'S OWN credentials, keeps only the session cookies in
memory, never writes the password anywhere. Login flow (from open-source HAC scrapers): GET /Account/LogOn ->
read __RequestVerificationToken -> POST the form (SCKTY...CustomEnabled, Database=10, VerificationOption,
LogOnDetails.UserName / LogOnDetails.Password)."""
import os
import threading
import time

import httpx

from . import parse

# Only hosts in this list can be contacted (stops the server being used as a proxy to arbitrary sites).
DISTRICTS = {
    "frisco": {"name": "Frisco ISD", "base": "https://hac.friscoisd.org/HomeAccess"},
}
if os.environ.get("ACEIFY_TEST_HAC"):   # operator-only switch used by tests/mock_hac.py; never set in production
    DISTRICTS["test"] = {"name": "Local test server", "base": os.environ["ACEIFY_TEST_HAC"].rstrip("/")}
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"
CACHE_TTL = 90  # seconds; protects HAC from refresh-spam and keeps the app fast


class HacError(Exception):
    pass


class HacClient:
    def __init__(self, district="frisco"):
        if district not in DISTRICTS:
            raise HacError("Unknown district")
        self.district = district
        self.base = DISTRICTS[district]["base"]
        self.http = httpx.Client(follow_redirects=True, timeout=30, headers={"User-Agent": UA})
        self.lock = threading.Lock()
        self.created = self.last_used = time.time()
        self.name = ""
        self.username_hint = ""
        self._cache = {}

    # ---- auth
    def login(self, user, password):
        url = f"{self.base}/Account/LogOn"
        r = self.http.get(url)
        token = parse.parse_login_token(r.text)
        if not token:
            raise HacError("Could not reach the HAC login page (the site may be down or its layout changed).")
        data = {
            "__RequestVerificationToken": token,
            "SCKTY00328510CustomEnabled": "True",
            "SCKTY00436568CustomEnabled": "True",
            "Database": "10",
            "VerificationOption": "UsernamePassword",
            "LogOnDetails.UserName": user,
            "LogOnDetails.Password": password,
            "tempUN": "", "tempPW": "",
        }
        r = self.http.post(url, data=data)
        if "Account/LogOn" in str(r.url) or parse.login_failed(r.text):
            raise HacError("HAC rejected that username or password.")
        self.name = parse.parse_student_name(r.text)
        self.username_hint = user[:2] + "***" if user else ""
        return True

    def close(self):
        try:
            self.http.close()
        except Exception:
            pass

    # ---- plumbing
    def _get(self, path):
        r = self.http.get(f"{self.base}{path}")
        if "Account/LogOn" in str(r.url):
            raise HacError("HAC session expired - please sign in again.")
        self.last_used = time.time()
        return r

    def _cached(self, key, fn):
        hit = self._cache.get(key)
        if hit and time.time() - hit[0] < CACHE_TTL:
            return hit[1]
        with self.lock:
            hit = self._cache.get(key)
            if hit and time.time() - hit[0] < CACHE_TTL:
                return hit[1]
            val = fn()
            self._cache[key] = (time.time(), val)
            return val

    def refresh(self):
        self._cache.clear()

    # ---- pages
    def _postback(self, path, html, field, value, target):
        """Re-submit an ASP.NET page with one dropdown changed (HAC drives these with __doPostBack)."""
        form, _ = parse.parse_form(html)
        form[field] = value
        form["__EVENTTARGET"] = target
        form["__EVENTARGUMENT"] = ""
        r = self.http.post(f"{self.base}{path}", data=form)
        if "Account/LogOn" in str(r.url):
            raise HacError("HAC session expired - please sign in again.")
        self.last_used = time.time()
        return r.text

    def _assignments_page(self, mp_value=None, first_html=None):
        path = "/Content/Student/Assignments.aspx"
        html = first_html or self._get(path).text
        data = parse.parse_assignments(html)
        if mp_value is None or data["mp"] == mp_value:
            return data, html
        sel = parse.soup(html).select_one("select[id$=ddlReportCardRuns]")
        if not sel:
            return data, html
        # the "Refresh View" button is __doPostBack('ctl00$plnMain$btnRefreshView','')
        out = self._postback(path, html, sel["name"], mp_value, "ctl00$plnMain$btnRefreshView")
        return parse.parse_assignments(out), html

    def grades(self, mp=None):
        return self._cached(("grades", mp), lambda: self._assignments_page(mp)[0])

    def all_quarters(self):
        """Every marking period at once: {current, mps:[{value,label}], data:{mp: parsed}}"""
        def go():
            first = self._get("/Content/Student/Assignments.aspx").text
            base = parse.parse_assignments(first)
            out = {base["mp"]: base}
            for m in base["mps"]:
                if m["value"] in out:
                    continue
                try:
                    out[m["value"]] = self._assignments_page(m["value"], first)[0]
                except HacError:
                    raise
                except Exception:
                    out[m["value"]] = {"mp": m["value"], "mps": base["mps"], "courses": []}
            return {"current": base["mp"], "mps": base["mps"], "data": out}
        return self._cached(("all",), go)

    def classes(self):
        def go():
            for path in ("/Content/Student/Classes.aspx", "/Content/Student/ReportCards.aspx"):
                try:
                    rows = parse.parse_classes(self._get(path).text)
                except HacError:
                    raise
                except Exception:
                    rows = []
                if rows:
                    return rows
            return []
        return self._cached(("classes",), go)

    def report_card(self):
        return self._cached(("rc",), lambda: parse.parse_report_card(self._get("/Content/Student/ReportCards.aspx").text))

    def ipr(self):
        """Every interim progress report date: {dates:[label], rows:[{description, teacher, period, grades:{date: value}}]}"""
        def go():
            path = "/Content/Student/InterimProgress.aspx"
            html = self._get(path).text
            first = parse.parse_ipr(html)
            rows = {}
            labels = []
            for d in first["dates"]:
                data = first if d["value"] == first["date"] else None
                if data is None:
                    sel = parse.soup(html).select_one("select[id$=ddlIPRDates]")
                    data = parse.parse_ipr(self._postback(path, html, sel["name"], d["value"], sel["name"]))
                labels.append(d["label"])
                for r in data["rows"]:
                    key = r.get("description") or r.get("course")
                    row = rows.setdefault(key, {"description": key, "teacher": r.get("teacher", ""), "period": r.get("period", ""), "grades": {}})
                    row["grades"][d["label"]] = r.get("ipr", "")
            return {"dates": labels, "rows": list(rows.values())}
        return self._cached(("ipr",), go)

    def transcript(self):
        return self._cached(("tr",), lambda: parse.parse_transcript(self._get("/Content/Student/Transcript.aspx").text))

    def registration(self):
        return self._cached(("reg",), lambda: parse.parse_registration(self._get("/Content/Student/Registration.aspx").text))

    def career_plan(self):
        return self._cached(("plan",), lambda: parse.parse_career_plan(self._get("/Content/Student/CareerPlan.aspx").text))

    def course_requests(self):
        return self._cached(("req",), lambda: parse.parse_course_requests(self._get("/Content/Student/CourseRequests.aspx").text))
