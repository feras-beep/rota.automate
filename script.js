document.addEventListener("DOMContentLoaded", () => {
  const rotaFile = document.getElementById("rotaFile");
  const uploadBtn = document.getElementById("uploadBtn");
  const assignmentsDiv = document.getElementById("assignments");

  uploadBtn.addEventListener("click", async () => {
    const file = rotaFile.files?.[0];
    if (!file) {
      assignmentsDiv.innerHTML = `<p style="color:red">⚠️ Please select a file first.</p>`;
      return;
    }

    assignmentsDiv.innerHTML = `<p>🔄 Uploading and processing...</p>`;

    try {
      const res = await fetch("/api/rota", {
        method: "POST",
        headers: { "Content-Type": "application/octet-stream" },
        body: file
      });

      const data = await res.json();

      assignmentsDiv.innerHTML = `<pre>${JSON.stringify(data, null, 2)}</pre>`;
    } catch (err) {
      assignmentsDiv.innerHTML = `<p style="color:red">❌ Error: ${err.message}</p>`;
    }
  });
});
