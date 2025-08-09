import * as XLSX from "xlsx";

const SHEET_NAME = "SHO Rota";
const UNAVAILABLE = ["NIGHT", "ZERO", "AL"];
const REQUIRED = { "Team A": 2, "Team B": 3, "Team C": 1, "Team D": 1 };
const FIXED = {
  "George Hudson": "Team A",
  "Suraj Sennik": "Team B",
  "Sanchita Bhatia": "Team B",
  "Feras Fayez": "Team D",
};
const LOCUM_THRESHOLD = 7;
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri"];
const COLS = { TEAM: 0, NAME: 1, DAYS: [4, 5, 6, 7, 8] };

const isNameLike = (s) => {
  if (!s) return false;
  const u = s.toUpperCase();
  if (u.includes("FY1")) return false;
  const bad = ["TEAM","BLEEP","0800","0700","→","ZERO","NIGHT","AL","SECOND","LD"];
  return !bad.some(b => u.includes(b));
};

const cellAvailable = (s) => {
  if (!s) return true;
  const u = String(s).toUpperCase();
  return !UNAVAILABLE.some(t => u.includes(t));
};

const preferParent = (teams, doc, parentMap) => {
  const team = parentMap.get(doc);
  if (team && REQUIRED[team] && teams[team].length < REQUIRED[team]) {
    teams[team].push(doc);
    return true;
  }
  return false;
};

const assignForDay = (availableNames, parentMap) => {
  const names = availableNames.filter(n => !/LOCUM COVER/i.test(n));
  const teams = new Map(Object.keys(REQUIRED).map(k => [k, []]));
  let unassigned = [...names];

  for (const [doc, team] of Object.entries(FIXED)) {
    const idx = unassigned.indexOf(doc);
    if (idx !== -1) {
      teams.get(team).push(doc);
      unassigned.splice(idx, 1);
    }
  }

  for (const doc of [...unassigned]) {
    if (preferParent(teams, doc, parentMap)) {
      unassigned = unassigned.filter(x => x !== doc);
    }
  }

  for (const [team, need] of Object.entries(REQUIRED)) {
    while (teams.get(team).length < need && unassigned.length) {
      teams.get(team).push(unassigned.shift());
    }
  }

  while (unassigned.length) {
    let target = [...teams.keys()][0];
    for (const k of teams.keys()) {
      if (teams.get(k).length < teams.get(target).length) target = k;
    }
    teams.get(target).push(unassigned.shift());
  }

  const locum = {};
  if (names.length < LOCUM_THRESHOLD) {
    for (const [team, need] of Object.entries(REQUIRED)) {
      const have = teams.get(team).length;
      if (have < need) locum[team] = need - have;
    }
  }

  const outTeams = {};
  for (const k of teams.keys()) outTeams[k] = teams.get(k);
  return { teams: outTeams, locum };
};

const parseSheet = (bytes) => {
  const wb = XLSX.read(bytes, { type: "buffer" });
  if (!wb.Sheets[SHEET_NAME]) {
    throw new Error(`Sheet "${SHEET_NAME}" not found`);
  }
  const ws = wb.Sheets[SHEET_NAME];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false });

  const parentMap = new Map();
  let currentTeam = null;
  for (const r of rows) {
    const teamCell = (r[COLS.TEAM] || "").toString().trim();
    const nameCell = (r[COLS.NAME] || "").toString().trim();
    if (/^Team\s+/i.test(teamCell)) currentTeam = teamCell;
    if (currentTeam && isNameLike(nameCell)) parentMap.set(nameCell, currentTeam);
  }

  const work = [];
  for (const r of rows) {
    const name = (r[COLS.NAME] || "").toString().trim();
    if (!isNameLike(name)) continue;
    const obj = { Name: name };
    for (let i = 0; i < WEEKDAYS.length; i++) {
      const c = COLS.DAYS[i];
      obj[WEEKDAYS[i]] = (r[c] || "").toString().trim();
    }
    work.push(obj);
  }

  const result = {};
  for (const day of WEEKDAYS) {
    const available = work.filter(r => cellAvailable(r[day])).map(r => r.Name);
    const { teams, locum } = assignForDay(available, parentMap);
    result[day] = { Teams: teams, "Locum Required": locum };
  }
  return result;
};

export default async function handler(req, res) {
  if (req.method === "GET") {
    return res.status(200).json({ ok: true, endpoint: "rota" });
  }

  try {
    const bytes = await buffer(req);

    // 🚨 Guard to avoid "undefined length" crash
    if (!bytes || !Buffer.isBuffer(bytes) || bytes.length === 0) {
      return res.status(400).json({ error: "No Excel data received" });
    }

    const result = parseSheet(bytes);
    return res.status(200).json(result);
  } catch (err) {
    return res.status(500).json({ error: String(err.message || err) });
  }
}

function buffer(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}
