// =====================================================
// roteiro.js — versão corrigida (Marcas: CPJA1 / CPJA2)
// =====================================================

// Utils
const $  = (s, ctx=document) => ctx.querySelector(s);
const $$ = (s, ctx=document) => [...ctx.querySelectorAll(s)];

// Dom refs globais
const flow         = $("#flow");
const bar          = $("#bar");
const progressText = $("#progressText");
const jumpSelect   = $("#jumpSelect");

// Estado
let roteiros = {};              // Mapa de telas por ID (inclui CPJA1/CPJA2 + inicio/fim/nao_confirma)
let startByProduct = {};        // { CPJA1: 'cpja1_abordagem', CPJA2: 'cpja2_abordagem' }
let historyStack = [];
let state = { produto: "", atendimento: "", pessoa: "" };
let isAdmin = false;
let currentId = null;

/* ============================================
   Carregamento do JSON e preparação de roteiros
============================================ */
async function loadRoteirosJSON() {
  const resp = await fetch("roteiros.json", { cache: "no-store" });
  if (!resp.ok) throw new Error("Não foi possível carregar roteiros.json");
  return resp.json();
}

// Constrói as telas "inicio", "fim" e "nao_confirma"
function buildSystemScreens() {
  // Tela de início com selects esperados pelo seu código
  roteiros.inicio = {
    id: "inicio",
    title: "Início",
    body: `
      <div class="grid-3">
        <label>Tipo de atendimento
          <select id="selAtendimento">
            <option value="">Selecione...</option>
            <option value="cobranca">Cobrança</option>
            <option value="negociacao">Negociação</option>
          </select>
        </label>

        <label>Produto
          <select id="selProduto">
            <option value="">Selecione...</option>
            <option value="CPJA1">Marca CPJA1</option>
            <option value="CPJA2">Marca CPJA2</option>
          </select>
        </label>

        <label>Pessoa
          <select id="selPessoa">
            <option value="">Selecione...</option>
            <option value="cnpj">CNPJ</option>
          </select>
        </label>
      </div>
    `,
    tab: "Seleção inicial do fluxo",
    buttons: [
      { label: "Iniciar", next: "__start", primary: true },
      { label: "Resetar", next: "inicio" }
    ]
  };

  // Tela de fim
  roteiros.fim = {
    id: "fim",
    title: "Fim",
    body: `Atendimento encerrado. Obrigado!`,
    tab: "Encerramento",
    buttons: [{ label: "Voltar ao início", next: "inicio", primary: true }]
  };

  // Fallback quando a identificação não confirma
  roteiros.nao_confirma = {
    id: "nao_confirma",
    title: "Não confirmado",
    body: `
      Não foi possível confirmar a identidade do responsável pelo CNPJ.<br>
      Oriente novo contato em momento oportuno.
    `,
    tab: "Sem confirmação",
    buttons: [
      { label: "Voltar ao início", next: "inicio", primary: true },
      { label: "Encerrar", next: "fim" }
    ]
  };
}

// Achata as telas do JSON por ID e marca o produto
function flattenProducts(json) {
  if (!json?.marcas) throw new Error("JSON inválido: nó 'marcas' ausente.");
  roteiros = {}; // zera para reconstruir

  // Varre produtos (CPJA1 / CPJA2)
  Object.entries(json.marcas).forEach(([produto, telasObj]) => {
    // tenta achar a tela de "abordagem" como ponto de partida
    const abordagem = telasObj.abordagem || Object.values(telasObj)[0];
    if (abordagem?.id) startByProduct[produto] = abordagem.id;

    // insere cada tela usando o seu próprio 'id' como chave
    Object.values(telasObj).forEach(def => {
      if (!def?.id) return;
      // clona e injeta metadado de produto
      const novo = { ...def, product: produto };
      roteiros[def.id] = novo;
    });
  });

  // adiciona telas do sistema
  buildSystemScreens();
}

/* ============================================
   Modal de Tabulação (injeção + controle)
============================================ */
function ensureTabModalInjected() {
  const existing = document.getElementById("tabModal");
  const hasOurStructure = existing && existing.querySelector(".rt-modal__content");
  if (hasOurStructure) return;

  const wrapper = existing || document.createElement("div");
  wrapper.id = "tabModal";
  wrapper.setAttribute("role", "dialog");
  wrapper.setAttribute("aria-modal", "true");
  wrapper.innerHTML = `
    <div class="rt-modal__content" tabindex="-1">
      <button class="rt-close" id="rtmClose" aria-label="Fechar">✕</button>
      <div class="rt-modal__icon">✔</div>
      <h2>Tabulação</h2>
      <p id="rtmText"></p>
      <div class="rt-actions">
        <button class="btn btn-primary" id="rtmOk">OK</button>
      </div>
    </div>
  `;
  if (!existing) document.body.appendChild(wrapper);

  $("#rtmClose").addEventListener("click", hideTabulacao);
  $("#rtmOk").addEventListener("click", hideTabulacao);
  wrapper.addEventListener("mousedown", (e) => { if (e.target === wrapper) hideTabulacao(); });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && $("#tabModal").style.display === "block") hideTabulacao();
  });
}
function showTabulacao(msg) {
  ensureTabModalInjected();
  $("#rtmText").textContent = msg;
  const modal = $("#tabModal");
  modal.style.display = "block";
  $(".rt-modal__content", modal).focus();
}
function hideTabulacao() {
  const modal = $("#tabModal");
  if (modal) modal.style.display = "none";
}

/* ============================================
   Renderiza uma tela
============================================ */
function renderScreen(def) {
  const sec = document.createElement("section");
  sec.className = "screen";
  sec.dataset.id = def.id;
  sec.innerHTML = `
    <div class="title">${def.title}</div>
    <div class="script">${def.body}</div>
    <div class="actions"></div>
  `;

  // Ícone ✔ de Tabulação
  const tabIcon = document.createElement("button");
  tabIcon.className = "tab-icon";
  tabIcon.textContent = "✔";
  tabIcon.title = def.tab || "Sem tabulação";
  tabIcon.type = "button";
  tabIcon.addEventListener("click", () => {
    const texto = def.tab && def.tab.trim() ? def.tab.trim() : "Sem tabulação";
    showTabulacao(`✔ ${texto}`);
  });
  sec.prepend(tabIcon);

  const actions = $(".actions", sec);

  // Botões definidos pela tela
  (def.buttons || []).forEach(b => {
    const btn = document.createElement("button");
    btn.className = "btn" + (b.primary ? " btn-primary" : "");
    btn.textContent = b.label;

    if (def.id === "inicio" && b.next === "__start") {
      btn.id = "btnStart";
      btn.disabled = true;
      btn.onclick = () => {
        const produto = state.produto;
        const startId = startByProduct[produto];
        if (!produto || !startId) {
          alert("Selecione um produto válido para iniciar.");
          return;
        }
        go(startId);
      };
    } else if (def.id === "inicio" && b.label === "Resetar") {
      btn.onclick = () => hardReset();
    } else if (def.id === "fim" && b.next === "inicio") {
      btn.onclick = () => hardReset();
    } else {
      btn.onclick = () => go(b.next);
    }

    actions.appendChild(btn);
  });

  // Botão voltar (exceto no início)
  if (def.id !== "inicio") {
    const backBtn = document.createElement("button");
    backBtn.className = "btn";
    backBtn.textContent = "⬅ Voltar";
    backBtn.onclick = () => {
      historyStack.pop();
      const prev = historyStack.pop();
      if (prev) go(prev);
      else go("inicio");
    };
    actions.insertBefore(backBtn, actions.firstChild);
  }

  flow.appendChild(sec);

  // Lógica especial para tela inicial: ler selects
  if (def.id === "inicio") {
    const selAtendimento = $("#selAtendimento", sec);
    const selProduto     = $("#selProduto", sec);
    const selPessoa      = $("#selPessoa", sec);
    const startBtn       = sec.querySelector("#btnStart");

    function checkReady() {
      state.atendimento = selAtendimento?.value || "";
      state.produto     = selProduto?.value || "";
      state.pessoa      = selPessoa?.value || "";
      startBtn.disabled = !(state.atendimento && state.produto && state.pessoa);
    }

    selAtendimento?.addEventListener("change", checkReady);
    selProduto?.addEventListener("change", checkReady);
    selPessoa?.addEventListener("change", checkReady);
  }
}

/* ============================================
   Navegação
============================================ */
function show(id) {
  $$(".screen", flow).forEach(s => s.classList.toggle("active", s.dataset.id === id));
  if (jumpSelect) jumpSelect.value = id;
  updateProgress();
  if (isAdmin) loadScreen(id);
}
function go(id) {
  if (!roteiros[id]) return;
  if (!byId(id)) renderScreen(roteiros[id]);
  historyStack.push(id);
  buildJumpList();
  show(id);
}
function byId(id) { return $(`.screen[data-id="${id}"]`); }

// Re-render seguro da tela atual (para refletir alterações como botões editados)
function rerenderScreen(id) {
  const old = byId(id);
  if (old) old.remove();
  renderScreen(roteiros[id]);
  show(id);
}

/* ============================================
   Progresso (considera somente o produto atual)
============================================ */
function updateProgress() {
  const isStep = (r) => r.id !== "inicio" && r.id !== "fim" && r.id !== "nao_confirma";
  const total = Object.values(roteiros).filter(r => isStep(r) && (!state.produto || r.product === state.produto)).length;
  const traversed = historyStack.filter(x => {
    const r = roteiros[x];
    return r && isStep(r) && (!state.produto || r.product === state.produto);
  }).length;

  const percent = total ? Math.round((traversed / total) * 100) : 0;
  bar.style.width = percent + "%";
  progressText.textContent = (traversed >= total && total > 0) ? "Concluído" : `Passo ${traversed} de ${total}`;
}

/* ============================================
   Jump
============================================ */
function buildJumpList() {
  if (!jumpSelect) return;
  jumpSelect.innerHTML = "";
  historyStack.forEach(id => {
    if (roteiros[id]) {
      const opt = document.createElement("option");
      opt.value = id;
      opt.textContent = roteiros[id].title;
      jumpSelect.appendChild(opt);
    }
  });
}
$("#btnJumpBack")?.addEventListener("click", () => {
  const id = jumpSelect.value;
  if (id) go(id);
});

/* ============================================
   ADM
============================================ */
const fldId       = $("#fldId");
const fldTitle    = $("#fldTitle");
const fldBody     = $("#fldBody");
const fldTab      = $("#fldTab");
const fldButtons  = $("#fldButtons");
const btnAddButton= $("#btnAddButton");

function loadButtons(def) {
  if (!fldButtons) return;
  fldButtons.innerHTML = "";
  (def.buttons || []).forEach((b, i) => {
    const wrapper = document.createElement("div");
    wrapper.className = "btn-edit";
    wrapper.innerHTML = `
      <input type="text" class="btn-label" value="${b.label || ""}" placeholder="Rótulo">
      <input type="text" class="btn-next" value="${b.next || ""}" placeholder="Próxima tela">
      <label><input type="checkbox" class="btn-primary" ${b.primary ? "checked" : ""}> Primário</label>
      <button type="button" class="btn-mini danger">✕</button>
    `;
    // remover botão
    wrapper.querySelector("button").onclick = () => {
      def.buttons.splice(i, 1);
      loadButtons(def);
    };
    fldButtons.appendChild(wrapper);
  });
}
function saveButtons(def) {
  if (!fldButtons) return;
  const rows = fldButtons.querySelectorAll(".btn-edit");
  def.buttons = [...rows].map(r => {
    const labelInput = r.querySelector(".btn-label");
    const nextInput  = r.querySelector(".btn-next");
    const primaryChk = r.querySelector(".btn-primary");
    return {
      label: labelInput ? labelInput.value : "",
      next: nextInput ? nextInput.value : "",
      primary: primaryChk ? primaryChk.checked : false
    };
  });
}
if (btnAddButton) {
  btnAddButton.addEventListener("click", () => {
    if (!currentId) return;
    if (!Array.isArray(roteiros[currentId].buttons)) roteiros[currentId].buttons = [];
    roteiros[currentId].buttons.push({ label: "Novo Botão", next: "inicio", primary: false });
    loadButtons(roteiros[currentId]);
  });
}

function loadScreen(id) {
  if (!roteiros[id]) return;
  currentId = id;
  const def = roteiros[id];

  if (fldId)    fldId.value = def.id || "";
  if (fldTitle) fldTitle.value = def.title || "";
  if (fldBody)  fldBody.value = def.body || "";
  if (fldTab)   fldTab.value = def.tab || "";
  loadButtons(def);
}

function applyAdmChanges() {
  if (!currentId) return;
  const def = roteiros[currentId];
  def.id    = fldId?.value?.trim()   || def.id;
  def.title = fldTitle?.value?.trim()|| def.title;
  def.body  = fldBody?.value?.trim() || def.body;
  def.tab   = fldTab?.value?.trim()  || def.tab;
  saveButtons(def);

  // Se o ID foi alterado, precisamos reindexar
  if (currentId !== def.id) {
    roteiros[def.id] = def;
    delete roteiros[currentId];
    currentId = def.id;
  }

  // Atualiza UI da tela atual (inclui rótulos dos botões)
  rerenderScreen(currentId);

  // Atualiza tooltip do ícone de tabulação no novo render
  const screen = byId(currentId);
  if (screen) {
    const tabBtn = screen.querySelector(".tab-icon");
    if (tabBtn) tabBtn.title = def.tab || "Sem tabulação";
  }
}
$("#btnSave")?.addEventListener("click", () => { applyAdmChanges(); alert("Alterações aplicadas!"); });
$("#btnReset")?.addEventListener("click", () => loadScreen(currentId));
$("#btnDelScreen")?.addEventListener("click", () => {
  if (currentId && confirm("Deseja realmente remover esta tela?")) {
    delete roteiros[currentId];
    alert("Tela removida.");
    buildJumpList();
    $("#admPanel")?.classList.remove("open");
  }
});

$("#btnToggleMode")?.addEventListener("click", () => {
  isAdmin = !isAdmin;
  $("#admPanel")?.classList.toggle("open", isAdmin);
  const toggle = $("#btnToggleMode");
  if (toggle) toggle.textContent = isAdmin ? "👤 Operador" : "⚙️ ADM";
  if (isAdmin) loadScreen(historyStack.at(-1) || "inicio");
});
$("#btnAdmClose")?.addEventListener("click", () => {
  isAdmin = false;
  $("#admPanel")?.classList.remove("open");
  const toggle = $("#btnToggleMode");
  if (toggle) toggle.textContent = "⚙️ ADM";
});

/* ============================================
   Reset completo (UI + estado + progresso)
============================================ */
function resetInicioUI() {
  const scr = byId("inicio");
  if (!scr) return;
  const a  = $("#selAtendimento", scr);
  const p  = $("#selProduto", scr);
  const pe = $("#selPessoa", scr);
  if (a) a.value = "";
  if (p) p.value = "";
  if (pe) pe.value = "";
  const startBtn = scr.querySelector("#btnStart");
  if (startBtn) startBtn.disabled = true;
}
function hardReset() {
  historyStack = [];
  state = { produto: "", atendimento: "", pessoa: "" };
  flow.innerHTML = "";
  renderScreen(roteiros.inicio);
  go("inicio");                // reabre do início
  resetInicioUI();             // limpa selects e desabilita Start
  updateProgress();            // barra volta pra 0%
}

/* ============================================
   Bootstrap / Init (assíncrono)
============================================ */
async function bootstrap() {
  ensureTabModalInjected();
  try {
    const json = await loadRoteirosJSON();
    flattenProducts(json);     // popula roteiros + startByProduct + telas do sistema
    hardReset();               // abre a UI
  } catch (err) {
    console.error(err);
    alert("Erro ao carregar os roteiros. Verifique o arquivo roteiros.json.");
  }
}
document.addEventListener("DOMContentLoaded", bootstrap);

/* ============================================
   Pesquisa rápida (Situações + Tabulações)
============================================ */
const searchInput = document.getElementById("searchInput");
searchInput?.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    const termo = searchInput.value.trim().toLowerCase();
    if (!termo) return;

    if (termo.includes("situa")) {
      window.location.href = "situacoes.html";
      return;
    }
    if (termo.includes("tabula")) {
      window.location.href = "tabulacoes.html";
      return;
    }

    const found = Object.values(roteiros).find(r =>
      (r.title || "").toLowerCase().includes(termo) ||
      (r.body  || "").toLowerCase().includes(termo)
    );

    if (found) {
      go(found.id);
    } else {
      alert("Nenhuma tela encontrada para: " + termo);
    }
  }
});
