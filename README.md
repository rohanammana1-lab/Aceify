# Aceify

Grades, GPA and agenda for Frisco ISD students, built on Home Access Center (HAC).
Run: `start_aceify.bat` (or `python run.py`) -> http://127.0.0.1:8825/ · Tests: `python -I tests/test_parse.py` · `node tests/test_gpa.js`

## Features
Dashboard (recently posted, missing work, upcoming, optional GPA tiles, list/grid grades) · Grades (Q1–Q4 + all-quarters table, accordion
class cards, category weights, inline what-if edits, hypothetical assignments, "what do I need", count-missing-as-zero, GPA impact) ·
GPA (official FISD formula, per-quarter predictions, tier/credit/include per course, transcript courses, official GPA) · Agenda (week/day,
class filters, own tasks) · Schedule (A/B day) · More: Trends chart, Teachers, This Week, Interim Progress (drops flagged), Transcript,
Report Card, Profile, FAQ/GPA/HAC guides · Settings: 5 themes, accent colors, reduce blur/motion, alerts, offline copy · multi-account · installable PWA.

## HAC connection (VERIFIED against the real Frisco ISD site, 2026-11-18, read-only login)
- Login: `GET https://hac.friscoisd.org/HomeAccess/Account/LogOn` -> `__RequestVerificationToken` -> POST with `SCKTY00328510CustomEnabled=True`,
  `SCKTY00436568CustomEnabled=True`, `Database=10`, `VerificationOption=UsernamePassword`, `LogOnDetails.UserName/Password`. Username = student ID.
- Pages under `/Content/Student/`: `Assignments.aspx`, `Classes.aspx`, `ReportCards.aspx`, `InterimProgress.aspx`, `Transcript.aspx`, `Registration.aspx`.
- Real-markup facts the parsers depend on: header rows are `<td>` (not `<th>`) inside `tr.sg-asp-table-header-row`; category tables have BLANK headers
  (positional: name, points, max, percent, weight, cat-points); score codes read `L     - Late Work`; teacher is NOT in the class header
  (the sub-heading is "Last Updated"); course names end in ` S1`/` S2`; quarter dropdown `ddlReportCardRuns` includes "(All Runs)" (value `ALL`).
- Quarter switching = ASP.NET postback: set the dropdown, `__EVENTTARGET=ctl00$plnMain$btnRefreshView`. IPR dates: `__EVENTTARGET=ctl00$plnMain$ddlIPRDates`.
- Cross-check: every class average and the Q2 GPA impact (4.867 / 3.667) matched WebGrades for the same account.
- Not found on HAC pages: class rank (transcript rank cell empty), cohort year (class of is derived from grade level), Career Plan (so transcript
  course tiers like "ALG 1" default to Tier I; change them with the dropdown).

## GPA rules (official: FISD 2026-27 High School Academic Guide; copy in `research/`)
Semester grades only · weighted = tier max − 0.1/point below 100 (I 5.0, II 5.5, III 6.0), <70 = 0 · unweighted 90/80/70 = 4/3/2, else 0 ·
credit-weighted, 3 decimals · Tier III AP/IB (+ all dual credit class of 2030+) · Tier II "Adv", Ind. Study, AcDec, PLTW (+ dual credit before 2030) ·
CBE/EA and pass/fail excluded. Unpublished: how HAC builds a semester grade from quarters (Aceify averages the two quarters) and exam weighting.
Zeros in 0%-weight categories (e.g. Progress Checks) are not shown as missing work; `ABS`, `L`, `M`, `ILAB` always are.

## Privacy / scaling design
Password used once, never stored or logged · HAC cookies in server memory only (30 min idle) · no database · login throttle (5 fails / 10 min per IP and
per username) · district allowlist · CSRF header + SameSite cookie + CSP · 90 s per-account cache · per-user data (tasks, tiers, predictions, new-grade
tracking, optional offline copy) lives in the user's browser. Deliberately NOT done: background push notifications (needs stored passwords).

## Before opening it to other students
FISD does not support third-party grade apps - needs families' informed decision. Needs HTTPS hosting, a privacy policy, per-IP rate
limiting at the proxy, and a decision on the remaining unknowns (rank, Career Plan tiers).

## Deploying to Render (free tier, for a small friends-test)
This repo is ready to deploy as-is: `requirements.txt` pins the dependencies, `render.yaml` describes the service, and the server already
detects HTTPS automatically behind Render's proxy (no env var needed) to mark its cookie `Secure`.

1. **Push this folder to a GitHub repo you own** (Render deploys from a connected Git repo, not a file upload):
   ```
   git init
   git add .
   git commit -m "Aceify"
   ```
   then create an empty repo on github.com and follow the `git remote add origin ...` / `git push` instructions it gives you.
2. **On render.com**, sign in (or create a free account) and click **New +** → **Blueprint**. Connect your GitHub account if asked, then
   pick the repo you just pushed. Render reads `render.yaml` and proposes a web service called `aceify` on the free plan - click **Apply**.
   - If you'd rather not use a Blueprint: **New +** → **Web Service** → pick the repo → Runtime **Python 3** → Build Command
     `pip install -r requirements.txt` → Start Command `uvicorn app.main:app --host 0.0.0.0 --port $PORT` → plan **Free**.
3. Render builds it and gives you a URL like `https://aceify-xxxx.onrender.com`. That's the link to send people to test with.
4. **Free-plan caveat:** the free instance spins down after ~15 minutes idle, so the first visit after a quiet spell takes 30-60s to wake up.
   That's fine for a small test; a paid instance (~$7/mo) removes the delay if this grows.
5. Nothing else to configure - no database, no secrets to set. Do **not** set `ACEIFY_TEST_HAC` in production; that variable (see `app/hac.py`)
   only exists so `tests/test_parse.py` can point the client at the local `tests/mock_hac.py` fixture server.
