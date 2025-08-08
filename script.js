// --- Rota Allocator Frontend (for Vercel serverless backend at /api/rota) ---

const form = document.getElementById("uploadForm");
const rotaFile = document.getElementById("rotaFile");
const assignmentsDiv = document.getElementById("assignments");

const API_URL = "/api/rota";
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri"];

form.addEventListener("submit", async (e) => {
  e.preventDefault();

  const file = rotaFile.files?.[0];
  if (!file) {
    toast("Please choose an .xlsx file first.", true);
    return;
  }
  if (!file.name.toLowerCase().endsWith(".xlsx")) {
    toast("Only .xlsx Excel files are supported.", true);
    return;
  }

  const formData = new FormData();
  formData.append("file", file);

  assignmentsDiv.innerHTML = `<p>🔄 Processing rota… this can take a few seconds.</p>`;

  try {
    const res = await fetch(API_URL, {
      method: "POST",
      body: formData,
    });

    // Vercel Python functions may return JSON or plain text on error
    const contentType = res.headers.get("content-type") || "";
    const isJson = contentType.includes("application/json");

    if (!res.ok) {
      const msg = isJson ? (await res.json())?.error : await res.text();
      throw new Error(msg || `Server error (${res.status})`);
    }

    const data = isJson ? await res.json() : JSON.parse(await res.text());
    renderAssignments(data);
    toast("✅ Rota generated.");
  } catch (err) {
    console.error(err);
    assignmentsDiv.innerHTML = `<p class="text-danger">⚠️ ${sanitize(
      err.message || "Failed to process rota."
    )}</p>`;
    toast("Something went wrong. Check the file and try again.", true);
  }
});

function renderAssignments(data) {
  assignmentsDiv.innerHTML = "";

  // Ensure days appear Mon→Fri
  const days = WEEKDAYS.filter((d) => data[d]);

  if (days.length === 0) {
    assignmentsDiv.innerHTML =
      '<p class="text-danger">No weekday assignments found. Check the sheet name (“SHO Rota”) and columns.</p>';
    return;
  }

  for (const day of days) {
    const info = data[day] || {};
    const teams = info["Teams"] || {};
    const locums = info["Locum Required"] || {};

    let html = `
      <div class="card mb-3 shadow-sm">
        <div class="card-header bg-primary text-white"><strong>${day}</strong></div>
        <div class="card-body">
          ${renderTeams(teams)}
          ${renderLocums(locums)}
        </div>
      </div>
    `;
    assignmentsDiv.insertAdjacentHTML("beforeend", html);
  }
}

function renderTeams(teams) {
  const order = ["Team A", "Team B", "Team C", "Team D"];
  let html = "";
  for (const team of order) {
    const members = teams[team] || [];
    html += `<p class="mb-1"><strong>${team}</strong>: ${
      members.length ? members.map(sanitize).join(", ") : "<em>None</em>"
    }</p>`;
  }
  return html;
}

function renderLocums(locums) {
  const keys = Object.keys(locums || {});
  if (keys.length === 0) return "";
  const items = keys
    .map((k) => `${sanitize(k)} (${sanitize(String(locums[k]))})`)
    .join(" • ");
  return `<p class="mt-2 text-danger"><strong>⚠️ Locum Required:</strong> ${items}</p>`;
}

// --- helpers ---
function toast(msg, isError = false) {
  // Simple inline toast (no external deps)
  const el = document.createElement("div");
  el.textContent = msg;
  el.style.position = "fixed";
  el.style.left = "50%";
  el.style.transform = "translateX(-50%)";
  el.style.bottom = "24px";
  el.style.padding = "10px 16px";
  el.style.borderRadius = "8px";
  el.style.background = isError ? "#dc3545" : "#198754";
  el.style.color = "white";
  el.style.boxShadow = "0 6px 18px rgba(0,0,0,0.2)";
  el.style.zIndex = "9999";
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 3000);
}

function sanitize(str) {
  return String(str).replace(/[&<>"']/g, (m) => {
    const map = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
    return map[m];
  });
}

