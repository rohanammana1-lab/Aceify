"""A tiny fake HAC server used to exercise Aceify's login / postback / parsing plumbing end to end.
The markup was modeled on REAL Frisco ISD HAC pages (structure only, all personal data invented): header rows use <td>,
category tables have blank headers, score codes read "L - Late Work", quarter dropdown has "(All Runs)", the Refresh View
button is __doPostBack('ctl00$plnMain$btnRefreshView'), IPR dates post back via __EVENTTARGET.
Run: python tests/mock_hac.py [port]   (login: 1001 / secret)"""
import sys
from http.server import BaseHTTPRequestHandler, HTTPServer
from urllib.parse import parse_qs, urlparse

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 9911
USER, PW, COOKIE = "1001", "secret", "ASP.NET_SessionId=mock123"
BANNER = '<div class="sg-banner-menu-container"><span>Student Test</span></div>'
LOGIN = """<html><body><form method="post" action="/HomeAccess/Account/LogOn">
<input name="__RequestVerificationToken" type="hidden" value="tok123" />
<input name="LogOnDetails.UserName" /><input name="LogOnDetails.Password" type="password" /></form></body></html>"""


def course(raw, avg, rows, cats, i):
    trs = "".join(f'<tr class="sg-asp-table-data-row"><td>{d}</td><td></td><td><a href="#">{n}</a><label style="display:none">*</label></td><td>{c}</td><td>\n   {s}\n  </td><td>{m}</td><td class="sg-view-quick">1.00</td></tr>' for d, n, c, s, m in rows)
    ctr = "".join(f'<tr class="sg-asp-table-data-row"><td>{n}</td><td>{p}</td><td>{m}</td><td>{pc}</td><td>{w}</td><td>0</td></tr>' for n, p, m, pc, w in cats)
    return f"""<div class="AssignmentClass"><div class="sg-header sg-header-square"><a class="sg-header-heading">{raw}</a>
<span id="plnMain_rptAssigmnetsByCourse_lblLastUpdDate_{i}" class="sg-header-sub-heading">(Last Updated: 11/15/2026)</span>
<span id="plnMain_rptAssigmnetsByCourse_lblHdrAverage_{i}" class="sg-header-heading sg-right">Student Grades {avg}%</span></div>
<div class="sg-content-grid"><table class="sg-asp-table" id="plnMain_rptAssigmnetsByCourse_dgCourseAssignments_{i}"><tr class="sg-asp-table-header-row"><td>Date Due</td><td>Date Assigned</td><td>Assignment</td><td>Category</td><td>Score</td><td>Total Points</td><td class="sg-view-quick">Weight</td></tr>{trs}</table>
<table class="sg-asp-table" id="plnMain_rptAssigmnetsByCourse_dgCourseCategories_{i}"><tr class="sg-asp-table-header-row"><td>Category</td><td></td><td></td><td>= Percent</td><td></td><td></td></tr>{ctr}</table></div></div>"""


def assignments(q):
    data = {
        "1-2027": [("ELA1 - 2    GT Humanities Adv", "99.22", [("09/20/2026", "Socratic Seminar", "Assessment of Learning", "99.00", "100.00")], [("Assessment of Learning", "99", "100", "99%", "100"), ("Progress Check for Learning", "0", "0", "0%", "0")]),
                   ("MTH1 - 2    Algebra 2 Adv S1", "98.14", [("09/22/2026", "Test 1", "Assessment of Learning", "98.00", "100.00")], [("Assessment of Learning", "98", "100", "98%", "100")])],
        "2-2027": [("ELA1 - 2    GT Humanities Adv S1", "70.44", [
                    ("11/03/2026", "Muckraker Expose", "Assessment of Learning", "L     - Late Work", "100.00"),
                    ("11/05/2026", "Reading Quiz", "Assessment of Learning", "88.00", "100.00"),
                    ("11/06/2026", "Vocab", "Progress Check for Learning", "ABS   - Absent", "20.00"),
                    ("11/07/2026", "Group Task", "Progress Check for Learning", "X - Excused", "50.00"),
                    ("11/10/2026", "Zero PC", "Progress Check for Learning", "0.00", "100.00"),
                    ("11/19/2026", "Unit 4 Project", "Assessment of Learning", "", "100.00")],
                   [("Assessment of Learning", "88", "200", "44%", "100"), ("Progress Check for Learning", "0", "170", "0%", "0")]),
                   ("MTH1 - 2    Algebra 2 Adv S1", "96.67", [("11/04/2026", "Quadratics", "Assessment of Learning", "98.00", "100.00")], [("Assessment of Learning", "98", "100", "98%", "100")])],
    }
    sel = "".join(f'<option value="{v}" {"selected" if v == q else ""}>{l}</option>' for v, l in [("ALL", "(All Runs)"), ("1-2027", "1"), ("2-2027", "2"), ("3-2027", "3"), ("4-2027", "4")])
    body = "".join(course(*c, i) for i, c in enumerate(data.get(q, [])))
    return f"""<html><body>{BANNER}<form method="post" action="Assignments.aspx">
<input type="hidden" name="__EVENTTARGET" value="" /><input type="hidden" name="__VIEWSTATE" value="vs" /><input type="hidden" name="__EVENTVALIDATION" value="ev" />
<select name="ctl00$plnMain$ddlReportCardRuns" id="plnMain_ddlReportCardRuns">{sel}</select>
<button onclick="__doPostBack('ctl00$plnMain$btnRefreshView','')" id="plnMain_btnRefreshView" type="button">Refresh</button>{body}</form></body></html>"""


REGISTRATION = f"""<html><body>{BANNER}<span id="plnMain_lblRegStudentID">1001</span><span id="plnMain_lblRegStudentName">Test, Student</span>
<span id="plnMain_lblGrade">09</span><span id="plnMain_lblBuildingName">Test High School</span><span id="plnMain_lblCounselor">COUNSELOR, ANN</span>
<span id="plnMain_lblHomeroom">F1</span><span id="plnMain_lblHomeroomTeacher">Teacher, Hal</span></body></html>"""

HDR = '<tr class="sg-asp-table-header-row"><td>Course</td><td>Description</td><td>Periods</td><td>Teacher</td><td>Room</td><td>Days</td><td>Marking Periods</td><td>Building</td><td>Status</td></tr>'
CLASSES = f"""<html><body>{BANNER}<table class="sg-asp-table" id="plnMain_dgSchedule">{HDR}
<tr class="sg-asp-table-data-row"><td>ELA1A - 2</td><td><a>GT Humanities Adv S1</a></td><td>4</td><td><a>HOPKINS, G</a></td><td>B330</td><td>B</td><td>Q1, Q2</td><td>Test HS</td><td>Active</td></tr>
<tr class="sg-asp-table-data-row"><td>MTH1A - 2</td><td><a>Algebra 2 Adv S1</a></td><td>2</td><td><a>WILLIAMS, V</a></td><td>B202</td><td>A</td><td>Q1, Q2</td><td>Test HS</td><td>Active</td></tr></table></body></html>"""

TRANSCRIPT = f"""<html><body>{BANNER}<table><tr><td>
<table><tr><td>Year:</td><td>2024-2025</td><td></td><td></td><td>Grade:</td><td>07</td></tr><tr><td>Building:</td><td>Test Middle School</td></tr></table>
<table class="sg-asp-table" id="plnMain_rpTranscriptGroup_dgCourses_0"><tr class="sg-asp-table-header-row"><td>Course</td><td>Description</td><td>SEM1</td><td>SEM2</td><td>FIN</td><td>Credit</td></tr>
<tr class="sg-asp-table-data-row"><td>03440100 - 1</td><td>SPAN 1</td><td>99</td><td>98</td><td></td><td>1.0000</td></tr></table>
<table><tr><td></td><td></td><td>Total Credit:</td><td>1.0000</td></tr></table></td></tr></table>
<table id="plnMain_rpTranscriptGroup_tblCumGPAInfo" class="sg-asp-table"><tr class="sg-asp-table-header-row"><td>GPA Type</td><td>GPA</td></tr>
<tr class="sg-asp-table-data-row"><td>Weighted GPA</td><td>5.1000</td></tr><tr class="sg-asp-table-data-row"><td>Unweighted GPA</td><td>4.0000</td></tr></table></body></html>"""


def ipr(date):
    vals = {"9/18/2026 12:00:00 AM": "97", "10/30/2026 12:00:00 AM": "88"}
    sel = "".join(f'<option value="{v}" {"selected" if v == date else ""}>{"0" + v.split()[0] if v.index("/") == 1 else v.split()[0]}</option>' for v in vals)
    return f"""<html><body>{BANNER}<form method="post"><input type="hidden" name="__VIEWSTATE" value="x" /><input type="hidden" name="__EVENTTARGET" value="" />
<select name="ctl00$plnMain$ddlIPRDates" id="plnMain_ddlIPRDates" onchange="__doPostBack('ctl00$plnMain$ddlIPRDates','')">{sel}</select>
<table class="sg-asp-table" id="plnMain_dgIPR"><tr class="sg-asp-table-header-row"><td>Course</td><td>Description</td><td>Period</td><td>Teacher</td><td>Room</td><td>IPR</td><td>CM1</td></tr>
<tr class="sg-asp-table-data-row"><td>MTH1A - 2</td><td>Algebra 2 Adv S1</td><td>2</td><td>WILLIAMS, V</td><td>B202</td><td>{vals[date]}</td><td></td></tr></table></form></body></html>"""


REPORT = f"""<html><body>{BANNER}<table class="sg-asp-table" id="plnMain_dgReportCard"><tr class="sg-asp-table-header-row"><td>Course</td><td>Description</td><td>Period</td><td>Teacher</td><td>Room</td><td>Q1</td><td>CM1</td></tr>
<tr class="sg-asp-table-data-row"><td>MTH1A - 2</td><td>Algebra 2 Adv S1</td><td>2</td><td>WILLIAMS, V</td><td>B202</td><td>98</td><td>29</td></tr></table></body></html>"""

PAGES = {"/HomeAccess/Content/Student/Registration.aspx": REGISTRATION, "/HomeAccess/Content/Student/Classes.aspx": CLASSES,
         "/HomeAccess/Content/Student/Transcript.aspx": TRANSCRIPT, "/HomeAccess/Content/Student/ReportCards.aspx": REPORT,
         "/HomeAccess/Home/Index": f"<html><body>{BANNER}ok</body></html>"}


class H(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def _send(self, body, code=200, headers=None):
        self.send_response(code)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        for k, v in (headers or {}).items():
            self.send_header(k, v)
        self.end_headers()
        self.wfile.write(body.encode())

    def _authed(self):
        return COOKIE.split("=")[1] in (self.headers.get("Cookie") or "")

    def do_GET(self):
        path = urlparse(self.path).path
        if path == "/HomeAccess/Account/LogOn":
            return self._send(LOGIN)
        if not self._authed():
            return self._send("", 302, {"Location": "/HomeAccess/Account/LogOn?ReturnUrl=" + path})
        if path.endswith("Assignments.aspx"):
            return self._send(assignments("2-2027"))
        if path.endswith("InterimProgress.aspx"):
            return self._send(ipr("10/30/2026 12:00:00 AM"))
        self._send(PAGES.get(path, "<html>404</html>"), 200 if path in PAGES else 404)

    def do_POST(self):
        path = urlparse(self.path).path
        data = parse_qs(self.rfile.read(int(self.headers.get("Content-Length", 0))).decode())
        if path == "/HomeAccess/Account/LogOn":
            if data.get("__RequestVerificationToken") == ["tok123"] and data.get("LogOnDetails.UserName") == [USER] and data.get("LogOnDetails.Password") == [PW]:
                return self._send("", 302, {"Location": "/HomeAccess/Home/Index", "Set-Cookie": COOKIE + "; path=/"})
            return self._send(LOGIN)
        if not self._authed():
            return self._send("", 302, {"Location": "/HomeAccess/Account/LogOn"})
        if path.endswith("Assignments.aspx"):     # only the Refresh View postback switches quarters
            if data.get("__EVENTTARGET") == ["ctl00$plnMain$btnRefreshView"]:
                return self._send(assignments(data.get("ctl00$plnMain$ddlReportCardRuns", ["2-2027"])[0]))
            return self._send(assignments("2-2027"))
        if path.endswith("InterimProgress.aspx") and data.get("__EVENTTARGET") == ["ctl00$plnMain$ddlIPRDates"]:
            return self._send(ipr(data["ctl00$plnMain$ddlIPRDates"][0]))
        self._send("<html>404</html>", 404)


if __name__ == "__main__":
    print("mock HAC on", PORT)
    HTTPServer(("127.0.0.1", PORT), H).serve_forever()
