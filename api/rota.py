# api/rota.py
# Pure-Python (.xlsx via zip+xml) rota processor for Vercel Functions (no external deps)
import json, io, re, zipfile
from xml.etree import ElementTree as ET
from collections import defaultdict

# ---- Config ----
SHEET_NAME = "SHO Rota"
UNAVAILABLE_TOKENS = ["NIGHT", "ZERO", "AL"]
REQUIRED = {"Team A": 2, "Team B": 3, "Team C": 1, "Team D": 1}
FIXED = {
    "George Hudson": "Team A",
    "Suraj Sennik": "Team B",
    "Sanchita Bhatia": "Team B",
    "Feras Fayez": "Team D",
}
LOCUM_THRESHOLD = 7
WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri"]

# Expected columns by LETTER in the SHO Rota sheet (adjust if template changes)
COL_TEAM = "A"   # where "Team A/B/..." headers appear
COL_NAME = "B"   # doctor names
COLS_WEEK = ["E", "F", "G", "H", "I"]  # Mon..Fri

# ---- XLSX helpers (no external libs) ----
_re_cell = re.compile(r"([A-Z]+)(\d+)")
def col_letter_to_index(col):
    """Convert Excel column letters (e.g., 'A','E','AA') to zero-based index."""
    s = 0
    for ch in col:
        s = s*26 + (ord(ch) - 64)
    return s - 1

def cell_ref_to_rc(ref):
    """Return (row_idx0, col_idx0) for an Excel cell ref like 'E12'."""
    m = _re_cell.fullmatch(ref)
    if not m:
        return None, None
    col, row = m.groups()
    return int(row)-1, col_letter_to_index(col)

def load_sheet_matrix(xlsx_bytes, target_sheet_name):
    """
    Load a sheet into a row-major list of lists of strings.
    Resolves sharedStrings, finds sheet XML by name (workbook.xml + rels).
    """
    with zipfile.ZipFile(io.BytesIO(xlsx_bytes)) as z:
        # 1) sharedStrings (optional)
        sst = []
        if "xl/sharedStrings.xml" in z.namelist():
            sst_xml = ET.fromstring(z.read("xl/sharedStrings.xml"))
            for si in sst_xml.findall("{http://schemas.openxmlformats.org/spreadsheetml/2006/main}si"):
                # collect all text nodes (handles rich text)
                text_parts = []
                for t in si.iter("{http://schemas.openxmlformats.org/spreadsheetml/2006/main}t"):
                    text_parts.append(t.text or "")
                sst.append("".join(text_parts))

        # 2) find sheet by name in workbook.xml
        wb = ET.fromstring(z.read("xl/workbook.xml"))
        ns = {"main": "http://schemas.openxmlformats.org/spreadsheetml/2006/main",
              "rel": "http://schemas.openxmlformats.org/officeDocument/2006/relationships"}
        target_rid = None
        for sh in wb.findall("main:sheets/main:sheet", ns):
            if (sh.get("name") or "").strip() == target_sheet_name:
                target_rid = sh.get("{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id")
                break
        if not target_rid:
            raise ValueError(f"Sheet '{target_sheet_name}' not found.")

        # 3) map rId -> sheet path via workbook rels
        rels = ET.fromstring(z.read("xl/_rels/workbook.xml.rels"))
        sheet_path = None
        for rel in rels.findall("{http://schemas.openxmlformats.org/package/2006/relationships}Relationship"):
            if rel.get("Id") == target_rid:
                sheet_path = "xl/" + rel.get("Target")
                break
        if not sheet_path or sheet_path not in z.namelist():
            raise ValueError(f"Could not resolve sheet XML for '{target_sheet_name}'.")

        # 4) parse sheet
        sheet_xml = ET.fromstring(z.read(sheet_path))
        # find max row/col to size the matrix
        max_r = 0; max_c = 0
        cells = []  # (r0, c0, value_str)
        for r in sheet_xml.iter("{http://schemas.openxmlformats.org/spreadsheetml/2006/main}row"):
            for c in r.iter("{http://schemas.openxmlformats.org/spreadsheetml/2006/main}c"):
                ref = c.get("r")
                if not ref: continue
                r0, c0 = cell_ref_to_rc(ref)
                if r0 is None: continue
                v = ""
                t = c.get("t")
                if t == "s":  # shared string
                    v_node = c.find("{http://schemas.openxmlformats.org/spreadsheetml/2006/main}v")
                    if v_node is not None:
                        try:
                            idx = int(v_node.text or "0")
                            v = sst[idx] if 0 <= idx < len(sst) else ""
                        except:
                            v = ""
                elif t == "inlineStr":
                    is_node = c.find("{http://schemas.openxmlformats.org/spreadsheetml/2006/main}is")
                    if is_node is not None:
                        tnode = is_node.find("{http://schemas.openxmlformats.org/spreadsheetml/2006/main}t")
                        v = (tnode.text or "") if tnode is not None else ""
                else:
                    v_node = c.find("{http://schemas.openxmlformats.org/spreadsheetml/2006/main}v")
                    v = (v_node.text or "") if v_node is not None else ""
                cells.append((r0, c0, v.strip()))
                if r0 > max_r: max_r = r0
                if c0 > max_c: max_c = c0

        # 5) build dense matrix of strings
        rows = max_r + 1
        cols = max_c + 1
        M = [["" for _ in range(cols)] for __ in range(rows)]
        for r0, c0, val in cells:
            M[r0][c0] = val
        return M

# ---- Business logic ----
def is_name_like(s):
    if not s: return False
    u = s.upper()
    if "FY1" in u: return False
    bad = ["TEAM","BLEEP","0800","0700","→","ZERO","NIGHT","AL","SECOND","LD"]
    return not any(b in u for b in bad)

def cell_available(s):
    if not s:  # blank = available
        return True
    u = s.upper()
    return not any(tok in u for tok in UNAVAILABLE_TOKENS)

def extract_parent_team_map(M):
    """From sheet matrix, read col A as team headers, col B as names."""
    team_col = col_letter_to_index(COL_TEAM)
    name_col = col_letter_to_index(COL_NAME)
    parent = {}
    current_team = None
    for row in M:
        team_val = (row[team_col] if team_col < len(row) else "").strip()
        name_val = (row[name_col] if name_col < len(row) else "").strip()
        if team_val.startswith("Team "):
            current_team = team_val
        if current_team and is_name_like(name_val):
            parent[name_val] = current_team
    return parent

def build_work_table(M):
    """
    Returns list of dict rows: {"Name": str, "Mon": "..", ..., "Fri": ".."}
    Using col B for names, E..I for Mon..Fri (change COLS_WEEK if needed).
    """
    idx_name = col_letter_to_index(COL_NAME)
    idx_days = [col_letter_to_index(c) for c in COLS_WEEK]
    out = []
    for r in range(len(M)):
        name = (M[r][idx_name] if idx_name < len(M[r]) else "").strip()
        if not is_name_like(name):  # skip rubbish rows
            continue
        row = {"Name": name}
        for i, day in enumerate(WEEKDAYS):
            ci = idx_days[i]
            val = (M[r][ci] if ci < len(M[r]) else "").strip()
            row[day] = val
        out.append(row)
    return out

def assign_for_day(avail_names, parent_map):
    names = [n for n in avail_names if "LOCUM COVER" not in n.upper()]
    teams = defaultdict(list)
    unassigned = names.copy()

    # fixed if available
    for doc, team in FIXED.items():
        if doc in unassigned:
            teams[team].append(doc)
            unassigned.remove(doc)

    # prefer parent team for minimum fill
    for doc in unassigned[:]:
        team = parent_map.get(doc)
        if team in REQUIRED and len(teams[team]) < REQUIRED[team]:
            teams[team].append(doc); unassigned.remove(doc)

    # fill remaining minimums
    for team, need in REQUIRED.items():
        while len(teams[team]) < need and unassigned:
            teams[team].append(unassigned.pop(0))

    # distribute extras to least-filled
    while unassigned:
        team_to_fill = min(teams.items(), key=lambda kv: len(kv[1]))[0]
        teams[team_to_fill].append(unassigned.pop(0))

    locum_required = {}
    if len(names) < LOCUM_THRESHOLD:
        for team, need in REQUIRED.items():
            if len(teams[team]) < need:
                locum_required[team] = need - len(teams[team])

    return dict(teams), locum_required

def process_rota_bytes(xlsx_bytes):
    M = load_sheet_matrix(xlsx_bytes, SHEET_NAME)
    parent_map = extract_parent_team_map(M)
    work_rows = build_work_table(M)

    result = {}
    for day in WEEKDAYS:
        # doctor available for that day if cell not containing NIGHT/ZERO/AL
        avail = [r["Name"] for r in work_rows if cell_available(r.get(day, ""))]
        teams, locum = assign_for_day(avail, parent_map)
        result[day] = {"Teams": teams, "Locum Required": locum}
    return result

def _read_request_bytes(request):
    # Prefer raw bytes (octet-stream)
    data = getattr(request, "get_data", lambda: None)()
    if not data and hasattr(request, "body"):
        data = request.body
    # Fallback to multipart
    if (not data) and hasattr(request, "files"):
        f = request.files.get("file")
        if f: data = f.read()
    return data

# ---- Vercel function handler ----
def handler(request):
    if request.method == "GET":
        return {
            "statusCode": 200,
            "headers": {"Content-Type": "application/json"},
            "body": json.dumps({"ok": True, "endpoint": "rota", "deps": "none"})
        }
    try:
        data = _read_request_bytes(request)
        if not data:
            return {
                "statusCode": 400,
                "headers": {"Content-Type": "application/json"},
                "body": json.dumps({"error": "No Excel bytes received"})
            }
        result = process_rota_bytes(data)
        return {
            "statusCode": 200,
            "headers": {"Content-Type": "application/json"},
            "body": json.dumps(result)
        }
    except Exception as e:
        # Always JSON error so frontend won't crash on text
        return {
            "statusCode": 500,
            "headers": {"Content-Type": "application/json"},
            "body": json.dumps({"error": str(e)})
        }
