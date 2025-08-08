import io
import json
import pandas as pd
from collections import defaultdict

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

def cell_is_available(val):
    if isinstance(val, str):
        return not any(tok in val.upper() for tok in UNAVAILABLE_TOKENS)
    return True

def is_name_like(s):
    if not s or not isinstance(s, str):
        return False
    u = s.upper()
    bad = ["TEAM", "BLEEP", "0800", "0700", "→", "ZERO", "NIGHT", "AL", "SECOND", "LD"]
    if any(b in u for b in bad):
        return False
    if "FY1" in u:
        return False
    return True

def extract_parent_team_map(df):
    parent = {}
    current_team = None
    for _, row in df.iterrows():
        team_cell = str(row.iloc[0]).strip() if len(row) > 0 else ""
        name_cell = str(row.iloc[1]).strip() if len(row) > 1 else ""
        if team_cell.startswith("Team "):
            current_team = team_cell
        if current_team and is_name_like(name_cell):
            parent[name_cell] = current_team
    return parent

def build_working_rota(df):
    # assumes names in col index 1 and Mon–Fri in cols 4..8 (as per your template)
    name_col = df.columns[1] if len(df.columns) > 1 else df.columns[0]
    work = df.loc[:, [name_col] + list(df.columns[4:9])].copy()
    work.columns = ["Name"] + WEEKDAYS
    work = work.dropna(subset=["Name"])
    work = work[work["Name"].astype(str).apply(is_name_like)]
    work["Name"] = work["Name"].astype(str).str.strip()
    return work

def assign_for_day(avail_names, parent_map):
    names = [n for n in avail_names if "LOCUM COVER" not in n.upper()]
    teams = defaultdict(list)
    unassigned = names.copy()

    # fixed
    for doc, team in FIXED.items():
        if doc in unassigned:
            teams[team].append(doc)
            unassigned.remove(doc)

    # parent team first
    for doc in unassigned[:]:
        team = parent_map.get(doc)
        if team in REQUIRED and len(teams[team]) < REQUIRED[team]:
            teams[team].append(doc)
            unassigned.remove(doc)

    # fill mins
    for team, need in REQUIRED.items():
        while len(teams[team]) < need and unassigned:
            teams[team].append(unassigned.pop(0))

    # distribute extras
    while unassigned:
        team_to_fill = min(teams.items(), key=lambda kv: len(kv[1]))[0]
        teams[team_to_fill].append(unassigned.pop(0))

    # locum only if under threshold
    locum_required = {}
    if len(names) < LOCUM_THRESHOLD:
        for team, need in REQUIRED.items():
            if len(teams[team]) < need:
                locum_required[team] = need - len(teams[team])

    return dict(teams), locum_required

def process_rota(xlsx_bytes):
    df = pd.read_excel(io.BytesIO(xlsx_bytes), sheet_name=SHEET_NAME, dtype=str)
    parent_map = extract_parent_team_map(df)
    work = build_working_rota(df)

    result = {}
    for day in WEEKDAYS:
        available_today = work.loc[work[day].apply(cell_is_available), "Name"].tolist()
        teams, locum = assign_for_day(available_today, parent_map)
        result[day] = {"Teams": teams, "Locum Required": locum}
    return result

def handler(request):
    # Simple GET/health
    if request.method == "GET":
        return {
            "statusCode": 200,
            "headers": {"Content-Type": "application/json"},
            "body": json.dumps({"ok": True, "message": "rota API is up"})
        }

    if request.method != "POST":
        return {"statusCode": 405, "body": "Method Not Allowed"}

    file = request.files.get("file")
    if not file:
        return {
            "statusCode": 400,
            "headers": {"Content-Type": "application/json"},
            "body": json.dumps({"error": "No file uploaded"})
        }

    try:
        xlsx_bytes = file.read()
        result = process_rota(xlsx_bytes)
        return {
            "statusCode": 200,
            "headers": {"Content-Type": "application/json"},
            "body": json.dumps(result)
        }
    except Exception as e:
        return {
            "statusCode": 400,
            "headers": {"Content-Type": "application/json"},
            "body": json.dumps({"error": str(e)})
        }

