/***** 1) CONFIG & ESTADO *****/
const API_BASE = "https://SUA_URL_DO_APPS_SCRIPT/exec"; // <- troque
const API_KEY  = "SUA_API_KEY";                          // <- troque
const AUTO_REFRESH_MS = 60000;

let chartStatus, chartTipos, chartDiario;
let allRows = [];         // bruto da API
let filteredRows = [];    // após filtros
let selectedId = null;    // linha selecionada na tabela

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

function fmtBR(ts){
  if (!ts) return "-";
  const d = new Date(ts);
  // sem segundos:
  return d.toLocaleString("pt-BR", {
    year:"numeric", month:"2-digit", day:"2-digit",
    hour:"2-digit", minute:"2-digit", hour12:false
  });
}

function debounce(fn, ms=300){
  let t; return (...args)=>{ clearTimeout(t); t=setTimeout(()=>fn(...args), ms); };
}

/***** 3) OPÇÕES COMUNS DOS GRÁFICOS *****/
const commonOptions = {
  responsive: true,
  maintainAspectRatio: false,
  layout: { padding: 8 },
  plugins: {
    legend: {
      position: "bottom",
      labels: { boxWidth: 10, boxHeight: 10, padding: 12, font: { size: 12 } }
    },
    tooltip: { mode: "index", intersect: false }
  }
};

/***** 4) API (list/create/update/delete, com timeout) *****/
async function apiFetch(params){
  const url = `${API_BASE}?${new URLSearchParams(params)}&key=${encodeURIComponent(API_KEY)}`;
  const ctrl = new AbortController();
  const to = setTimeout(()=>ctrl.abort(), 10000);
  try{
    const res = await fetch(url, { signal: ctrl.signal });
    clearTimeout(to);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    if (!json.ok) throw new Error(json.error || "Resposta API inválida");
    return json;
  }catch(e){
    clearTimeout(to);
    throw e;
  }
}

async function apiList() {
  try{
    const j = await apiFetch({ action: "list" });
    return j.data.map(r => ({
      id: r.id,
      created_at: r.created_at,
      room_number: String(r.room_number || ""),
      service_type: String(r.service_type || ""),
      request_text: String(r.request_text || ""),
      status: String((r.status || "").toLowerCase()),
      setor: String((r.setor || "")).toLowerCase()
    }));
  }catch(e){
    console.warn("[dash] API falhou, usando MOCK:", e.message || e);
    return null;
  }
}

async function apiCreate(payload){
  return apiFetch({ action: "create", ...payload });
}
async function apiUpdate(id, payload){
  return apiFetch({ action: "update", id, ...payload });
}
async function apiDelete(id){
  return apiFetch({ action: "delete", id });
}

/***** 5) MOCK (fallback visual) *****/
function mockRows() {
  const now = Date.now();
  const days = (n)=> new Date(now - n*86400000).toISOString();
  return [
    {id: 101, created_at: days(0), room_number:"101", service_type:"Limpeza",         request_text:"Limpeza completa",        status:"aberto",        setor:"governança"},
    {id: 102, created_at: days(1), room_number:"305", service_type:"Toalhas",         request_text:"Troca de toalhas",        status:"concluido",     setor:"governança"},
    {id: 103, created_at: days(2), room_number:"502", service_type:"Roupas de Cama",  request_text:"Trocar lençóis",          status:"em_andamento",  setor:"governança"},
    {id: 104, created_at: days(3), room_number:"210", service_type:"Amenities",       request_text:"Reposição de amenities",   status:"aberto",        setor:"governança"},
    {id: 105, created_at: days(4), room_number:"418", service_type:"Outros",          request_text:"Cheiro de limpeza",        status:"cancelado",     setor:"governança"},
    {id: 106, created_at: days(5), room_number:"707", service_type:"Limpeza",         request_text:"Varredura rápida",         status:"concluido",     setor:"governança"},
    {id: 107, created_at: days(6), room_number:"120", service_type:"Toalhas",         request_text:"Toalha rosto + banho",     status:"aberto",        setor:"governança"},
  ];
}

/***** 6) FILTROS E BUSCA *****/
function applyFilters(){
  const q       = (el("txtSearch")?.value || "").trim().toLowerCase();
  const st      = (el("selStatus")?.value || "").trim().toLowerCase();
  const setor   = (el("selSetor")?.value  || "").trim().toLowerCase();
  const dStart  = el("dateStart")?.value || "";
  const dEnd    = el("dateEnd")?.value   || "";

  let out = [...allRows];

  if (st)    out = out.filter(r => (r.status||"").toLowerCase() === st);
  if (setor) out = out.filter(r => (r.setor||"").toLowerCase() === setor);

  if (dStart){
    const t0 = new Date(`${dStart}T00:00:00`);
    out = out.filter(r => new Date(r.created_at) >= t0);
  }
  if (dEnd){
    const t1 = new Date(`${dEnd}T23:59:59`);
    out = out.filter(r => new Date(r.created_at) <= t1);
  }

  if (q){
    out = out.filter(r=>{
      return (
        String(r.id).includes(q) ||
        (r.room_number||"").toLowerCase().includes(q) ||
        (r.service_type||"").toLowerCase().includes(q) ||
        (r.request_text||"").toLowerCase().includes(q) ||
        (r.status||"").toLowerCase().includes(q)
      );
    });
  }

  return out;
}

/***** 7) RENDER (KPIs, Tabela, Gráficos) *****/
function renderAll(){
  const rows = applyFilters();
  filteredRows = rows;

  // KPIs
  const cont = rows.reduce((a,r)=> (a[r.status]=(a[r.status]||0)+1, a), {});
  el("kpiTotal")      && (el("kpiTotal").textContent      = rows.length);
  el("kpiAbertos")    && (el("kpiAbertos").textContent    = cont.aberto || 0);
  el("kpiAndamento")  && (el("kpiAndamento").textContent  = cont.em_andamento || 0);
  el("kpiConcluidos") && (el("kpiConcluidos").textContent = cont.concluido || 0);
  el("kpiCancelados") && (el("kpiCancelados").textContent = cont.cancelado || 0);

  // Tabela
  const $tb = el("tbRows");
  if ($tb){
    $tb.innerHTML = [...rows]
      .sort((a,b)=> new Date(b.created_at) - new Date(a.created_at))
      .slice(0,500)
      .map(r=>{
        const isSel = r.id === selectedId ? ' style="outline:2px solid #4da3ff"' : "";
        return `
          <tr data-id="${r.id}"${isSel}>
            <td>#${r.id}</td>
            <td>${fmtBR(r.created_at)}</td>
            <td>${esc(r.room_number)}</td>
            <td>${esc(r.service_type)}</td>
            <td>${esc(r.request_text)}</td>
            <td>${esc(r.status)}</td>
          </tr>
        `;
      }).join("");
  }

  // ===== Dados para os 3 gráficos =====
  const byStatus = groupCount(rows, r => r.status);
  const statusLabels = Object.keys(byStatus);
  const statusData   = Object.values(byStatus);

  const byTipo = groupCount(rows, r => r.service_type);
  const tipoLabels = Object.keys(byTipo);
  const tipoData   = Object.values(byTipo);

  const daysLabels = lastNDates(30);
  const byDay = rows.reduce((a,r)=> {
    const k = toInputDate(new Date(r.created_at));
    a[k] = (a[k]||0)+1; return a;
  }, {});
  const dailyData = daysLabels.map(d => byDay[d] || 0);

  // Gráfico 1: Status (doughnut)
  chartStatus = drawOrUpdate(chartStatus, "chartStatus", {
    type: "doughnut",
    data: { labels: statusLabels, datasets: [{ data: statusData, borderWidth: 2 }] },
    options: commonOptions
  });

  // Gráfico 2: Tipos (bar)
  chartTipos = drawOrUpdate(chartTipos, "chartTipos", {
    type: "bar",
    data: {
      labels: tipoLabels,
      datasets: [{ label: "Solicitações", data: tipoData, borderWidth: 1.5, borderRadius: 6 }]
    },
    options: {
      ...commonOptions,
      plugins: { ...commonOptions.plugins, legend: { display: false } },
      scales: {
        x: { grid: { display: false } },
        y: { beginAtZero: true, grid: { color: "rgba(15,76,129,.08)" } }
      }
    }
  });

  // Gráfico 3: Diário (line) + clique filtra datas
  chartDiario = drawOrUpdate(chartDiario, "chartDiario", {
    type: "line",
    data: {
      labels: daysLabels,
      datasets: [{ label: "Solicitações/dia", data: dailyData, borderWidth: 2, pointRadius: 2, tension: 0.25 }]
    },
    options: {
      ...commonOptions,
      plugins: { ...commonOptions.plugins, legend: { display: false } },
      scales: {
        x: { grid: { display: false } },
        y: { beginAtZero: true, grid: { color: "rgba(15,76,129,.08)" } }
      },
      onClick: (_, els)=>{
        if (!els?.length) return;
        const i = els[0].index;
        const day = daysLabels[i]; // YYYY-MM-DD
        if (el("dateStart")) el("dateStart").value = day;
        if (el("dateEnd"))   el("dateEnd").value   = day;
        renderAll();
        document.querySelector("table")?.scrollIntoView({ behavior:"smooth", block:"start" });
      }
    }
  });

  el("msg") && (el("msg").textContent = "");
}

/***** 8) CRUD (UI simples com prompt para manter genérico) *****/
async function onAdd(){
  // você pode substituir por um modal; aqui uso prompt para rapidez
  const room  = prompt("Quarto (ex.: 302):","");
  if (room === null) return;
  const tipo  = prompt("Tipo/Serviço (ex.: Limpeza/Toalhas):","");
  if (tipo === null) return;
  const texto = prompt("Pedido/Detalhe:","");
  if (texto === null) return;
  const setor = (el("selSetor")?.value || "governança").toLowerCase();

  try{
    el("msg") && (el("msg").textContent = "Enviando...");
    await apiCreate({ room_number: room, service_type: tipo, request_text: texto, status:"aberto", setor });
    await refresh();
  }catch(e){
    console.error(e);
    alert("Falha ao criar: " + (e.message||e));
    el("msg") && (el("msg").textContent = "");
  }
}

async function onEdit(){
  if (!selectedId){ alert("Selecione uma linha na tabela."); return; }
  const row = allRows.find(r=> r.id === selectedId);
  if (!row){ alert("Registro não encontrado."); return; }

  const room  = prompt("Quarto:", row.room_number);
  if (room === null) return;
  const tipo  = prompt("Tipo/Serviço:", row.service_type);
  if (tipo === null) return;
  const texto = prompt("Pedido/Detalhe:", row.request_text);
  if (texto === null) return;
  const status = prompt("Status (aberto|em_andamento|concluido|cancelado):", row.status);
  if (status === null) return;

  try{
    el("msg") && (el("msg").textContent = "Atualizando...");
    await apiUpdate(selectedId, { room_number: room, service_type: tipo, request_text: texto, status });
    await refresh();
  }catch(e){
    console.error(e);
    alert("Falha ao atualizar: " + (e.message||e));
    el("msg") && (el("msg").textContent = "");
  }
}

async function onDelete(){
  if (!selectedId){ alert("Selecione uma linha na tabela."); return; }
  if (!confirm(`Excluir #${selectedId}?`)) return;
  try{
    el("msg") && (el("msg").textContent = "Excluindo...");
    await apiDelete(selectedId);
    selectedId = null;
    await refresh();
  }catch(e){
    console.error(e);
    alert("Falha ao excluir: " + (e.message||e));
    el("msg") && (el("msg").textContent = "");
  }
}

/***** 9) BOOT + EVENTOS UI *****/
async function refresh(){
  el("msg") && (el("msg").textContent = "Carregando...");
  let rows = await apiList();
  if (!rows || !Array.isArray(rows) || rows.length === 0){
    rows = mockRows();
  }
  // normaliza status aceitáveis
  allRows = rows.map(r => ({
    ...r,
    status: (r.status||"").replace(/\s+/g,"_") // "em andamento" -> "em_andamento"
  }));
  renderAll();
}

document.addEventListener("DOMContentLoaded", ()=>{
  // filtros/busca
  el("selStatus") && el("selStatus").addEventListener("change", renderAll);
  el("selSetor")  && el("selSetor").addEventListener("change", renderAll);
  el("dateStart") && el("dateStart").addEventListener("change", renderAll);
  el("dateEnd")   && el("dateEnd").addEventListener("change", renderAll);
  el("txtSearch") && el("txtSearch").addEventListener("input", debounce(renderAll, 200));

  // modo escuro on/off (seu CSS deve ler [data-theme="dark"])
  el("chkDark") && el("chkDark").addEventListener("change", (e)=>{
    document.documentElement.setAttribute("data-theme", e.target.checked ? "dark" : "light");
  });

  // botões CRUD
  el("btnAdd")    && el("btnAdd").addEventListener("click", onAdd);
  el("btnEdit")   && el("btnEdit").addEventListener("click", onEdit);
  el("btnDelete") && el("btnDelete").addEventListener("click", onDelete);

  // seleção de linha na tabela
  const $tbody = el("tbRows");
  if ($tbody){
    $tbody.addEventListener("click", (ev)=>{
      const tr = ev.target.closest("tr[data-id]");
      if (!tr) return;
      selectedId = Number(tr.getAttribute("data-id"));
      // re-render só para aplicar destaque visual
      renderAll();
    });
  }

  // carregar e auto refresh
  refresh();
  setInterval(refresh, AUTO_REFRESH_MS);
});
