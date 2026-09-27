const aiStatusEl = document.getElementById("ai-status");
const aiDetailEl = document.getElementById("ai-detail");
const resultEl = document.getElementById("result");
const wakeButton = document.getElementById("wake");
const updatedEl = document.getElementById("updated");

let refreshing = false;
let wakePendingUntil = 0;

function wakePending() {
  return Date.now() < wakePendingUntil;
}

function setAiState(status, lastWakeAt) {
  const online = status === "online";
  aiStatusEl.className = `status ${online ? "online" : "offline"}`;
  aiStatusEl.innerHTML = `<span class="dot" aria-hidden="true"></span>${online ? "オンライン" : "オフライン"}`;

  aiDetailEl.textContent = lastWakeAt
    ? `最終 Wake 要求: ${new Date(lastWakeAt).toLocaleString()}`
    : "Wake要求履歴はありません。";

  wakeButton.disabled = online || wakePending();
  wakeButton.textContent = online
    ? "起動済み"
    : (wakePending() ? "起動確認中…" : "Wake");
}

async function refreshStatus() {
  if (refreshing) return;
  refreshing = true;

  try {
    const response = await fetch("/api/status", {
      credentials: "same-origin",
      cache: "no-store",
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const data = await response.json();

    if (wakePendingUntil && Date.now() >= wakePendingUntil) {
      wakePendingUntil = 0;
      if (data.ai_agent.status !== "online") {
        resultEl.textContent = "起動を確認できませんでした。必要なら再度Wakeできます。";
      }
    }

    if (wakePendingUntil && data.ai_agent.status === "online") {
      wakePendingUntil = 0;
      resultEl.textContent = "AIエージェントPCの起動を確認しました。";
    }

    setAiState(data.ai_agent.status, data.ai_agent.last_wake_at);
    updatedEl.textContent = `最終更新: ${new Date().toLocaleTimeString()}`;
  } catch (error) {
    aiStatusEl.className = "status unknown";
    aiStatusEl.innerHTML = '<span class="dot" aria-hidden="true"></span>取得失敗';
    aiDetailEl.textContent = `状態取得に失敗しました: ${error.message}`;
    wakeButton.disabled = true;
  } finally {
    refreshing = false;
  }
}

wakeButton.addEventListener("click", async () => {
  if (!window.confirm("AIエージェントPCにWake-on-LANを送信しますか？")) {
    return;
  }

  wakeButton.disabled = true;
  wakeButton.textContent = "送信中…";
  resultEl.textContent = "";

  try {
    const response = await fetch("/api/wake", {
      method: "POST",
      credentials: "same-origin",
      headers: {
        "X-WOL-Confirm": "wake",
      },
    });

    const data = await response.json();

    if (response.status === 409) {
      wakePendingUntil = 0;
      resultEl.textContent = "AIエージェントPCはすでにオンラインです。";
    } else if (!response.ok) {
      throw new Error(data.detail || `HTTP ${response.status}`);
    } else {
      wakePendingUntil = Date.now() + 90_000;
      resultEl.textContent = "Magic Packetを送信しました。起動を確認しています…";
    }
  } catch (error) {
    wakePendingUntil = 0;
    resultEl.textContent = `送信失敗: ${error.message}`;
  } finally {
    await refreshStatus();
  }
});

refreshStatus();
setInterval(refreshStatus, 5000);
