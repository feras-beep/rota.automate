const form = document.getElementById("uploadForm");
const rotaFile = document.getElementById("rotaFile");
const assignmentsDiv = document.getElementById("assignments");

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const file = rotaFile.files[0];
  if (!file) return;

  const formData = new FormData();
  formData.append("file", file);

  assignmentsDiv.innerHTML = `<p>🔄 Processing rota...</p>`;

  try {
    const response = await fetch("https://your-backend.com/upload", {
      method: "POST",
      body: formData
    });

    if (!response.ok) throw new Error("Server error");

    const data = await response.json();
    displayAssignments(data);
  } catch (err) {
    assignmentsDiv.innerHTML = `<p class="text-danger">⚠️ Error processing rota. ${err.message}</p>`;
  }
});

function displayAssignments(data) {
  assignmentsDiv.innerHTML = "";
  for (const [day, info] of Object.entries(data)) {
    const teams = info.Teams;
    const locums = info["Locum Required"];

    let html = `<div class="card mb-3">
      <div class="card-header bg-primary text-white"><strong>${day}</strong></div>
      <div class="card-body">`;

    for (const [team, members] of Object.entries(teams)) {
      html += `<p><strong>${team}</strong>: ${members.join(", ")}</p>`;
    }

    if (Object.keys(locums).length > 0) {
      html += `<p class="text-danger"><strong>⚠️ Locum Required:</strong> `;
      for (const [team, count] of Object.entries(locums)) {
        html += `${team} (${count}) `;
      }
      html += `</p>`;
    }

    html += `</div></div>`;
    assignmentsDiv.innerHTML += html;
  }
}
