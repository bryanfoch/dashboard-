/***** 1) CONFIG & ESTADO *****/
const API_BASE = "https://SUA_URL_DO_APPS_SCRIPT/exec"; // <- troque
const API_KEY  = "SUA_API_KEY";                          // <- troque
const AUTO_REFRESH_MS = 60000;

let chartStatus, chartTipos, chartDiario;

/***** 2) HELPERS *****/
const el = (id) => document.getElementById(id);

const toInputDate = (d)=>{
  const z=n=>String(n).padStart(2,"0");
  return `${d.getFullYear()}-${z(d.getMonth()+1)}-${z(d.getDate())}`;
};

function groupCount(rows, keyFn){
  const out = {};
  for (const r of rows){
    const k = keyFn(r) || "—";
    out[k] = (out[k]||0) + 1;
  }
  return out;
}

function lastNDates(n){
  const t=new Date(), arr=[];
  for(let i=n-1;i>=0;i--){
    const d=new Date(t); d.setDate(t.getDate()-i);
    arr.push(toInputDate(d));
  }
  return arr;
}

function drawOrUpdate(inst, canvasId, cfg){
  const c = document.getElementById(canvasId);
  if (!c){ console.error("[dash] canvas não encontrado:", canvasId); return inst; }
  const ctx = c.getContext("2d");
  if (!ctx){ console.error("[dash] getContext falhou:", canvasId); return inst; }
  if (inst) inst.destroy();
  return new Chart(ctx, cfg);
}

function esc(s=""){
  return s.replace(/[&<>"']/g, m => (
    {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]
  ));
}

/***** 3) OPÇÕES COMUNS DOS GRÁFICOS (harmonia visual) *****/
const commonOptions = {
  responsive: true,
  maintainAspectRatio: false,         // respeita a altura do CSS (.chart-area)
  layout: { padding: 8 },
  plugins: {
    legend: {
      position: "bottom",
      labels: { boxWidth: 10, boxHeight: 10, padding: 12, font: { size: 12 } }
    },
    tooltip: { mode: "index", intersect: false }
  }
};

/***** 4) API (com timeout e tratamento de erro) *****/
async function apiList() {
  const url = `${API_BASE}?action=list&key=${encodeURIComponent(API_KEY)}`;
  console.log("[dash] fetching:", url);
  const ctrl = new AbortController();
  const t = setTimeout(()=>ctrl.abort(), 8000); // timeout 8s

  try{
    const res = await fetch(url, { signal: ctrl.signal });
    clearTimeout(t);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    console.log("[dash] api response:", json);
    if (!json.ok) throw new Error(json.error || "Resposta API inválida");

    return json.data.map(r => ({
      id: r.id,
      created_at: r.created_at,
      room_number: String(r.room_number || ""),
      service_type: String(r.service_type || ""),
      request_text: String(r.request_text || ""),
      status: String((r.status || "").toLowerCase())
    }));
  } catch (e){
    clearTimeout(t);
    console.warn("[dash] API falhou, usando MOCK:", e.message || e);
    return null; // use mock
  }
}

/***** 5) MOCK (garante visual mesmo sem API) *****/
function mockRows() {
  const now = Date.now();
  const days = (n)=> new Date(now - n*86400000).toISOString();
  return [
    {id: 101, created_at: days(0), room_number:"101", service_type:"Limpeza",         request_text:"Limpeza completa",        status:"aberto"},
    {id: 102, created_at: days(1), room_number:"305", service_type:"Toalhas",         request_text:"Troca de toalhas",        status:"concluido"},
    {id: 103, created_at: days(2), room_number:"502", service_type:"Roupas de Cama",  request_text:"Trocar lençóis",          status:"em_andamento"},
    {id: 104, created_at: days(3), room_number:"210", service_type:"Amenities",       request_text:"Reposição de amenities",   status:"aberto"},
    {id: 105, created_at: days(4), room_number:"418", service_type:"Outros",          request_text:"Cheiro de limpeza",        status:"cancelado"},
    {id: 106, created_at: days(5), room_number:"707", service_type:"Limpeza",         request_text:"Varredura rápida",         status:"concluido"},
    {id: 107, created_at: days(6), room_number:"120", service_type:"Toalhas",         request_text:"Toalha rosto + banho",     status:"aberto"},
  ];
}

/***** 6) RENDER PRINCIPAL (KPIs, tabela e 3 gráficos) *****/
async function loadAndRender(){
  const $msg = el("msg");
  try{
    if ($msg) $msg.textContent = "Carregando...";

    let rows = await apiList();
    if (!rows || !Array.isArray(rows) || rows.length === 0){
      rows = mockRows(); // fallback
    }

    // >>> Se tiver filtros (data/status/busca), aplique aqui e gere "filtered"
    const filtered = rows;

    // KPIs
    const cont = filtered.reduce((a,r)=> (a[r.status]=(a[r.status]||0)+1, a), {});
    el("kpiTotal")      && (el("kpiTotal").textContent      = filtered.length);
    el("kpiAbertos")    && (el("kpiAbertos").textContent    = cont.aberto || 0);
    el("kpiAndamento")  && (el("kpiAndamento").textContent  = cont.em_andamento || 0);
    el("kpiConcluidos") && (el("kpiConcluidos").textContent = cont.concluido || 0);
    el("kpiCancelados") && (el("kpiCancelados").textContent = cont.cancelado || 0);

    // Tabela
    const fmt = (s)=> new Date(s).toLocaleString("pt-BR");
    const $tb = el("tbRows");
    if ($tb){
      $tb.innerHTML = [...filtered]
        .sort((a,b)=> new Date(b.created_at) - new Date(a.created_at))
        .slice(0,200)
        .map(r => `
          <tr>
            <td>#${r.id}</td>
            <td>${fmt(r.created_at)}</td>
            <td>${esc(r.room_number)}</td>
            <td>${esc(r.service_type)}</td>
            <td>${esc(r.request_text)}</td>
            <td>${esc(r.status)}</td>
          </tr>
        `).join("");
    }

    // ===== Dados para os 3 gráficos =====
    const byStatus = groupCount(filtered, r => r.status);
    const statusLabels = Object.keys(byStatus);
    const statusData   = Object.values(byStatus);

    const byTipo = groupCount(filtered, r => r.service_type);
    const tipoLabels = Object.keys(byTipo);
    const tipoData   = Object.values(byTipo);

    const daysLabels = lastNDates(30);
    const byDay = filtered.reduce((a,r)=> {
      const k = toInputDate(new Date(r.created_at));
      a[k] = (a[k]||0)+1; return a;
    }, {});
    const dailyData = daysLabels.map(d => byDay[d] || 0);

    // ===== Gráfico 1: Pizza (Status) =====
    chartStatus = drawOrUpdate(chartStatus, "chartStatus", {
      type: "doughnut",
      data: {
        labels: statusLabels,
        datasets: [{ data: statusData, borderWidth: 2 }]
      },
      options: commonOptions
    });

    // ===== Gráfico 2: Barras (Tipos) =====
    chartTipos = drawOrUpdate(chartTipos, "chartTipos", {
      type: "bar",
      data: {
        labels: tipoLabels,
        datasets: [{
          label: "Solicitações",
          data: tipoData,
          borderWidth: 1.5,
          borderRadius: 6,
          barPercentage: 0.7,
          categoryPercentage: 0.7
        }]
      },
      options: {
        ...commonOptions,
        plugins: { ...commonOptions.plugins, legend: { display: false } },
        scales: {
          x: { ticks: { maxRotation: 0, autoSkip: true, font: { size: 12 } }, grid: { display: false } },
          y: { beginAtZero: true, ticks: { stepSize: 1, font: { size: 12 } }, grid: { color: "rgba(15,76,129,.08)" } }
        }
      }
    });

    // ===== Gráfico 3: Linha (Diário) =====
    chartDiario = drawOrUpdate(chartDiario, "chartDiario", {
      type: "line",
      data: {
        labels: daysLabels,
        datasets: [{
          label: "Solicitações/dia",
          data: dailyData,
          borderWidth: 2,
          pointRadius: 2,
          tension: 0.25,
          fill: false
        }]
      },
      options: {
        ...commonOptions,
        plugins: { ...commonOptions.plugins, legend: { display: false } },
        scales: {
          x: { ticks: { autoSkip: true, maxTicksLimit: 8, font: { size: 12 } }, grid: { display: false } },
          y: { beginAtZero: true, ticks: { font: { size: 12 } }, grid: { color: "rgba(15,76,129,.08)" } }
        }
      }
    });

    if ($msg) $msg.textContent = "";
    console.log("[dash] render OK");
  }catch(e){
    console.error("[dash] erro geral:", e);
    if ($msg) $msg.textContent = "Erro ao carregar/renderizar.";
  }
}

/***** 7) BOOT *****/
document.addEventListener("DOMContentLoaded", () => {
  loadAndRender();
  setInterval(loadAndRender, AUTO_REFRESH_MS);
});
