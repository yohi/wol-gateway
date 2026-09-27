const gatewayStatusEl = document.getElementById("gateway-status");
const aiStatusEl = document.getElementById("ai-status");
const aiDetailEl = document.getElementById("ai-detail");
const wakeButton = document.getElementById("wake");
const resultEl = document.getElementById("result");
const updatedEl = document.getElementById("updated");

let wakePendingUntil = 0;
let refreshing = false;

function setBadge(element, state, text) {
  element.className = `status ${state}`;
  element.innerHTML = `<span class="dot" aria-hidden="true"></span>${text}`;
}

async function refreshStatus() {
  if (refreshing) return;
  refreshing = true;
  try {
    const [targetsResponse, relaysResponse] = await Promise.all([
      fetch("/api/targets", { cache: "no-store", credentials: "same-origin" }),
      fetch("/api/relays", { cache: "no-store", credentials: "same-origin" }),
    ]);
    if (!targetsResponse.ok || !relaysResponse.ok) throw new Error("status request failed");

    const targets = await targetsResponse.json();
    const relays = await relaysResponse.json();
    const target = targets.targets?.find((item) => item.id === "ai-agent");
    const relay = relays.relays?.find((item) => item.id === "home-gateway");
    if (!target || !relay) throw new Error("status payload invalid");

    if (relay.status === "online") {
      setBadge(gatewayStatusEl, "online", "オンライン");
    } else {
      setBadge(gatewayStatusEl, "offline", "利用不可");
    }

    if (target.status === "online") {
      setBadge(aiStatusEl, "online", "オンライン");
      aiDetailEl.textContent = "起動済みです。";
      wakePendingUntil = 0;
      resultEl.textContent = resultEl.textContent.includes("確認") ? "AIエージェントPCの起動を確認しました。" : resultEl.textContent;
    } else if (target.status === "offline") {
      setBadge(aiStatusEl, "offline", "オフライン");
      aiDetailEl.textContent = "Wake-on-LANを送信できます。";
    } else {
      setBadge(aiStatusEl, "unknown", "不明");
      aiDetailEl.textContent = "Relayから対象PCの状態を確認できません。";
    }

    if (wakePendingUntil && Date.now() >= wakePendingUntil) {
      wakePendingUntil = 0;
      if (target.status !== "online") {
        resultEl.textContent = "起動を確認できませんでした。必要なら再度Wakeできます。";
      }
    }

    const pending = Date.now() < wakePendingUntil;
    wakeButton.disabled = !target.wakeAvailable || pending;
    wakeButton.textContent = target.status === "online"
      ? "起動済み"
      : pending ? "起動確認中…" : target.wakeAvailable ? "Wake" : "Wake不可";

    updatedEl.textContent = `最終更新: ${new Date().toLocaleTimeString()}`;
  } catch (error) {
    setBadge(gatewayStatusEl, "offline", "利用不可");
    setBadge(aiStatusEl, "unknown", "不明");
    aiDetailEl.textContent = "状態取得に失敗しました。";
    wakeButton.disabled = true;
    wakeButton.textContent = "Wake不可";
  } finally {
    refreshing = false;
  }
}

wakeButton.addEventListener("click", async () => {
  if (!window.confirm("AIエージェントPCにWake-on-LANを送信しますか？")) return;
  wakeButton.disabled = true;
  wakeButton.textContent = "送信中…";
  resultEl.textContent = "";
  try {
    const response = await fetch("/api/targets/ai-agent/wake", {
      method: "POST",
      credentials: "same-origin",
      headers: { "X-WOL-Confirm": "wake" },
    });
    const body = await response.json();
    if (response.status === 409) {
      resultEl.textContent = "AIエージェントPCはすでにオンラインです。";
    } else if (!response.ok) {
      throw new Error(body.error || `HTTP ${response.status}`);
    } else {
      wakePendingUntil = Date.now() + 90_000;
      resultEl.textContent = "Magic Packetを送信しました。起動を確認しています…";
    }
  } catch (error) {
    resultEl.textContent = `送信失敗: ${error.message}`;
  }
  await refreshStatus();
});

refreshStatus();
setInterval(refreshStatus, 5000);
