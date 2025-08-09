const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri"];
const form = document.getElementById("uploadForm");
const fileInput = document.getElementById("rotaFile");
const assignmentsDiv = document.getElementById("assignments");
const debugDiv = document.getElementById("debug");

function log(msg) {
  console.log(msg);
  debugDiv.textContent += (typeof msg === "string" ? msg : JSON.stringify(msg, null, 2)) + "\n";
}

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  debugDiv.textContent = ""; // reset
  log("Submit clicked");

  const file = fileInput?.files?.[0];
  if (!file) {
    toast("Please choose an .xlsx file.", true);
    log("No file selected");
    return;
  }

  assignmentsDiv.innerHTML = `<p>🔄 Processing rota…</p>`;

  try {
    log("Sending request to /api/rota as application/octet-stream");
    const res = await fetch("/api/rota", {
      method: "POST",
      headers: { "Content-Type": "application/octet-stream" },
      body: file
    });

    log(`HTTP ${res.status}`);
    const ct = res.headers.get("content-type") || "";
    log(`Content-Type: ${ct}`);

    let payload;
    let rawText = "";

    if (ct.includes("application/json")) {
      payload = await res.json();
      log({ json: payload });
    } else {
      rawText = await res.text();
      log({ rawText });
    }

    if (!res.ok) {
      const msg = payload?.error || rawText || `Server error (${res.status})`;
      throw new Error(msg);
    }

    const data = payload ?? JSON.parse(rawText);
    renderAssignments(data);
    toast("✅ Rota generated.");
  } catch (err) {
    log({ error: String(err) });
    assignmentsDiv.innerHTML = `<p class="text-danger">❌ ${sanitize(err.message || String(err))}</p>`;
    toast("Failed to generate rota.", true);
  }
});

function renderAssignments(data) {
  assignmentsDiv.innerHTML = "";
  const days = WEEKDAYS.filter(d => data[d]);
  if (!days.length) {
    assignmentsDiv.innerHTML = `<p class="text-danger">No weekday data found. Check sheet name “SHO Rota”.</p>`;
    return;
  }
  for (const day of days) {
    const info = data[day] || {};
    const teams = info["Teams"] || {};
    const locums = info["Locum Required"] || {};
    const html = `
      <div class="card mb-3 shadow-sm">
        <div class="card-header bg-primary text-white"><strong>${day}</strong></div>
        <div class="card-body">
          ${renderTeams(teams)}
          ${renderLocums(locums)}
        </div>
      </div>`;
    assignmentsDiv.insertAdjacentHTML("beforeend", html);
  }
}

function renderTeams(teams) {
  const order = ["Team A", "Team B", "Team C", "Team D"];
  return order.map(team => {
    const members = teams[team] || [];
    return `<p class="mb-1"><strong>${team}</strong>: ${
      members.length ? members.map(sanitize).join(", ") : "<em>None</em>"
    }</p>`;
  }).join("");
}

function renderLocums(locums) {
  const keys = Object.keys(locums || {});
  if (!keys.length) return "";
  const text = keys.map(k => `${sanitize(k)} (${sanitize(String(locums[k]))})`).join(" • ");
  return `<p class="mt-2 text-danger"><strong>⚠️ Locum Required:</strong> ${text}</p>`;
}

function toast(msg, error=false) {
  const el = document.createElement("div");
  el.textContent = msg;
  Object.assign(el.style, {
    position: "fixed", left: "50%", transform: "translateX(-50%)",
    bottom: "24px", padding: "10px 16px", borderRadius: "8px",
    background: error ? "#dc3545" : "#198754", color: "#fff",
    boxShadow: "0 6px 18px rgba(0,0,0,.2)", zIndex: 9999
  });
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 3000);
}

function sanitize(str) {
  return String(str).replace(/[&<>"']/g, m => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[m]));
}

