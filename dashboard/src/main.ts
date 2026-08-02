import { fetchAnonymitySets, formatDenomination, type DenominationStats } from "./anonymitySet.js";

const form = document.getElementById("connect-form") as HTMLFormElement;
const rpcInput = document.getElementById("rpc-url") as HTMLInputElement;
const poolInput = document.getElementById("pool-address") as HTMLInputElement;
const targetInput = document.getElementById("target-size") as HTMLInputElement;
const statusEl = document.getElementById("status") as HTMLElement;
const kpiRow = document.getElementById("kpi-row") as HTMLElement;
const table = document.getElementById("table") as HTMLTableElement;
const tableBody = document.getElementById("table-body") as HTMLElement;

const REFRESH_MS = 5000;
let pollHandle: ReturnType<typeof setInterval> | undefined;

const params = new URLSearchParams(location.search);
if (params.get("rpc")) rpcInput.value = params.get("rpc")!;
if (params.get("pool")) poolInput.value = params.get("pool")!;

function setStatus(message: string, tone?: "error" | "ok") {
  statusEl.textContent = message;
  if (tone) statusEl.dataset.tone = tone;
  else delete statusEl.dataset.tone;
}

function render(stats: DenominationStats[]) {
  kpiRow.hidden = false;
  table.hidden = false;

  kpiRow.innerHTML = stats
    .map(
      (s) => `
      <div class="stat-tile">
        <div class="label">${formatDenomination(s.denomination)} unit pool</div>
        <div class="value">${s.count.toLocaleString()}</div>
        <div class="meter-label"><span>Privacy score</span><span>${s.privacyScore}/100</span></div>
        <div class="meter-track"><div class="meter-fill" style="width:${s.privacyScore}%"></div></div>
      </div>`,
    )
    .join("");

  tableBody.innerHTML = stats
    .map(
      (s) => `
      <tr>
        <td>${formatDenomination(s.denomination)}</td>
        <td>${s.count.toLocaleString()}</td>
        <td>${s.privacyScore}/100</td>
        <td class="mono">${s.currentRoot.toString().slice(0, 18)}…</td>
      </tr>`,
    )
    .join("");
}

async function refresh(rpcUrl: string, poolAddress: string, target: number) {
  try {
    const stats = await fetchAnonymitySets(rpcUrl, poolAddress, target);
    render(stats);
    setStatus(`Updated ${new Date().toLocaleTimeString()}`, "ok");
  } catch (err) {
    setStatus(err instanceof Error ? err.message : String(err), "error");
  }
}

form.addEventListener("submit", (e) => {
  e.preventDefault();
  if (pollHandle) clearInterval(pollHandle);

  const rpcUrl = rpcInput.value.trim();
  const poolAddress = poolInput.value.trim();
  const target = Number(targetInput.value) || 100;

  setStatus("Connecting…");
  void refresh(rpcUrl, poolAddress, target);
  pollHandle = setInterval(() => refresh(rpcUrl, poolAddress, target), REFRESH_MS);
});

if (params.get("pool")) {
  form.requestSubmit();
}
