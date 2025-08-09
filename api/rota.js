// api/rota.js
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

// Expected columns in the sheet (adjust if your template changes)
const COLS = {
  TEAM: 0,  // column A (0-based)
  NAME: 1,  // column B
  DAYS: [4, 5, 6, 7, 8] // E..I => Mon..Fri
};

const isNameLike = (s) => {
  if (!s) return false;
  const u = s.toUpperCase();
  if (u.includes("FY1")) return false;
  const bad = ["TEAM","BLEEP","0800","0700","→","ZERO","NIGHT","AL","SECOND","LD"];
  return !bad.some(b => u.includes(b));
};

const cellAvailable = (s) => {
  if (!s) return true; // blank => available
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

  // fixed if available
  for (const [doc, team] of Object.entries(FIXED)) {
    const idx = unassigned.indexOf(doc);
    if (idx !== -1) {
      teams.get(team).push(doc);
      unassigned.splice(idx, 1);
    }
  }

  // prefer parent team to hit minimums
  for (const doc of [...unassigned]) {
    if (preferParent(teams, doc, parentMap)) {
      unassigned = unassigned.filter(x => x !== doc);
    }
  }

  // fill remaining minimums
  for (const [team, need] of Object.entries(REQUIRED)) {
    while (teams.get(team).length < need && unassigned.length) {
      teams.get(team).push(unassigned.shift());
    }
  }

  // distribute extras to least-filled
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

  // Convert map to plain object
  const outTeams = {};
  for (const k of teams.keys()) outTeams[k] = teams.get(k);
  return { teams: outTeams, locum };
};

const parseSheet = (bytes) => {
  // Read workbook from ArrayBuffer
  const wb = XLSX.read(bytes, { type: "buffer" });
  if (!wb.Sheets[SHEET_NAME]) {
    throw new Error(`Sheet "${SHEET_NAME}" not found. Sheets: ${wb.SheetNames.join(", ")}`);
  }
  const ws = wb.Sheets[SHEET_NAME];
  // Sheet as 2D array (rows of cells)
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false });

  // Build parent team map from col A (team headers) + col B (names)
  const parentMap = new Map();
  let currentTeam = null;
  for (const r of rows) {
    const teamCell = (r[COLS.TEAM] || "").toString().trim();
    const nameCell = (r[COLS.NAME] || "").toString().trim();
    if (/^Team\s+/i.test(teamCell)) currentTeam = teamCell;
    if (currentTeam && isNameLike(nameCell)) parentMap.set(nameCell, currentTeam);
  }

  // Build tidy work rows: Name + Mon..Fri (from E..I)
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

  // Assign per day
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
    return res.status(200).json({ ok: true, endpoint: "rota", runtime: "node" });
  }

  try {
    // Prefer raw bytes (application/octet-stream)
    let bytes;
    if (req.headers["content-type"]?.includes("application/octet-stream")) {
      bytes = await buffer(req);
    } else if (req.method === "POST") {
      // fallback: multipart form-data
      const buf = await buffer(req);
      // naive extraction: look for the first file-like chunk after two \r\n\r\n
      // (works for our simple upload, but recommend raw bytes)
      bytes = extractFileFromMultipart(buf, req.headers["content-type"] || "");
      if (!bytes) throw new Error("No file found in multipart payload. Send as application/octet-stream for reliability.");
    }

    if (!bytes || !bytes.length) {
      return res.status(400).json({ error: "No Excel bytes received" });
    }

    const result = parseSheet(bytes);
    return res.status(200).json(result);
  } catch (err) {
    return res.status(500).json({ error: String(err.message || err) });
  }
}

// ---- helpers ----
function buffer(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function extractFileFromMultipart(buf, contentType) {
  const m = /boundary=([^;]+)/i.exec(contentType);
  if (!m) return null;
  const boundary = `--${m[1]}`;
  const parts = buf.toString("binary").split(boundary);
  for (const p of parts) {
    // Look for a file part (has filename= and two CRLFs before data)
    if (/filename=/i.test(p)) {
      const idx = p.indexOf("\r\n\r\n");
      if (idx !== -1) {
        const body = p.slice(idx + 4);
        // remove trailing CRLF--
        const trimmed = body.replace(/\r\n--\s*$/, "").replace(/\r\n$/, "");
        return Buffer.from(trimmed, "binary");
      }
    }
  }
  return null;
}
