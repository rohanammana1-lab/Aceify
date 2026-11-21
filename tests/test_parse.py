"""Parser + HAC-client tests against tests/mock_hac.py (markup modeled on real Frisco ISD pages, invented data).
Run: python -I tests/test_parse.py"""
import sys
import threading
from http.server import HTTPServer
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
sys.path.insert(0, str(Path(__file__).resolve().parent))
import mock_hac as M
from app import parse


def test_assignments():
    d = parse.parse_assignments(M.assignments("2-2027"))
    assert d["mp"] == "2-2027" and [m["label"] for m in d["mps"]] == ["Q1", "Q2", "Q3", "Q4"]   # "(All Runs)" dropped
    c = d["courses"][0]
    assert c["name"] == "GT Humanities Adv" and c["average"] == 70.44 and c["updated"] == "11/15/2026"
    a = {x["name"]: x for x in c["assignments"]}
    m = a["Muckraker Expose"]
    assert m["code"] == "L" and m["desc"] == "Late Work" and m["late"] and m["score"] == 0 and m["zero"]
    assert a["Reading Quiz"]["score"] == 88 and a["Reading Quiz"]["max"] == 100
    assert a["Vocab"]["code"] == "ABS" and a["Vocab"]["score"] == 0
    assert a["Group Task"]["exempt"] and a["Group Task"]["score"] is None
    assert a["Zero PC"]["score"] == 0 and a["Zero PC"]["code"] == ""
    assert not a["Unit 4 Project"]["graded"]
    cats = {k["name"]: k for k in c["categories"]}                                              # blank category headers -> positional
    assert cats["Assessment of Learning"]["weight"] == 100 and cats["Progress Check for Learning"]["weight"] == 0
    assert cats["Assessment of Learning"]["points"] == 88 and cats["Assessment of Learning"]["max"] == 200
    assert parse.parse_assignments(M.assignments("3-2027"))["courses"] == []


def test_codes():
    cs = parse.classify_score
    assert cs("95")["score"] == 95 and cs("0.00")["zero"]
    assert cs("L     - Late Work")["score"] == 0 and cs("L")["late"]
    assert cs("ILAB")["missing"] and cs("M - Missing")["missing"]
    assert cs("T")["exempt"] and cs("CNS")["exempt"] and cs("")["score"] is None


def test_other_pages():
    r = parse.parse_registration(M.REGISTRATION)
    assert r["grade"] == "09" and r["student_id"] == "1001" and r["homeroom_teacher"] == "Teacher, Hal"
    assert parse.parse_student_name(M.assignments("2-2027")) == "Student Test"
    t = parse.parse_transcript(M.TRANSCRIPT)
    assert t["gpa"] == {"Weighted GPA": 5.1, "Unweighted GPA": 4.0}
    s = t["semesters"][0]
    assert s["year"] == "2024-2025" and s["grade_level"] == "07" and s["school"] == "Test Middle School" and s["credits"] == 1.0
    assert s["courses"][0]["grade"] == 98.5 and s["courses"][0]["credit"] == 1.0                # mean of SEM1/SEM2
    cl = parse.parse_classes(M.CLASSES)
    assert len(cl) == 2 and cl[0]["period"] == "4" and cl[0]["days"] == "B" and cl[0]["mps"] == "Q1, Q2"
    i = parse.parse_ipr(M.ipr("10/30/2026 12:00:00 AM"))
    assert i["date"] == "10/30/2026 12:00:00 AM" and len(i["dates"]) == 2 and i["rows"][0]["ipr"] == "88"
    assert parse.parse_report_card(M.REPORT)["rows"][0]["q1"] == "98"


def test_client_end_to_end():
    import os
    srv = HTTPServer(("127.0.0.1", 0), M.H)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    os.environ["ACEIFY_TEST_HAC"] = f"http://127.0.0.1:{srv.server_port}/HomeAccess"
    from app import hac
    import importlib
    importlib.reload(hac)
    c = hac.HacClient("test")
    try:
        c.login("1001", "wrong")
        raise AssertionError("bad password accepted")
    except hac.HacError:
        pass
    c = hac.HacClient("test")
    c.login("1001", "secret")
    assert c.name == "Student Test"
    al = c.all_quarters()
    assert al["current"] == "2-2027" and set(al["data"]) == {"1-2027", "2-2027", "3-2027", "4-2027"}   # postback switching works
    assert al["data"]["1-2027"]["courses"][0]["average"] == 99.22 and al["data"]["2-2027"]["courses"][0]["average"] == 70.44
    ip = c.ipr()
    assert ip["dates"] == ["09/18/2026", "10/30/2026"] and ip["rows"][0]["grades"] == {"09/18/2026": "97", "10/30/2026": "88"}
    assert c.transcript()["semesters"] and c.registration()["grade"] == "09" and len(c.classes()) == 2
    srv.shutdown()


if __name__ == "__main__":
    test_assignments(); test_codes(); test_other_pages(); test_client_end_to_end(); print("parser + client tests passed")
