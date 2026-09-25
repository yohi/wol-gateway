const statusEl = document.getElementById("status");
const resultEl = document.getElementById("result");
const wakeButton = document.getElementById("wake");

async function refreshStatus() {
  try {
    const response = await fetch("/api/status", { credentials: "same-origin" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    statusEl.textContent = data.last_wake_at
      ? `Gateway: ready / last wake: ${data.last_wake_at}`
      : "Gateway: ready / no wake request recorded since process start";
  } catch {
    statusEl.textContent = "Gateway status: unavailable";
  }
}

wakeButton.addEventListener("click", async () => {
  wakeButton.disabled = true;
  resultEl.textContent = "Sending magic packet…";

  try {
    const response = await fetch("/api/wake", {
      method: "POST",
      credentials: "same-origin",
      headers: {
        "X-WOL-Confirm": "wake",
      },
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.detail || `HTTP ${response.status}`);
    }

    resultEl.textContent = `Magic packet sent: ${data.sent_at}`;
    await refreshStatus();
  } catch (error) {
    resultEl.textContent = `Failed: ${error.message}`;
  } finally {
    wakeButton.disabled = false;
  }
});

refreshStatus();
