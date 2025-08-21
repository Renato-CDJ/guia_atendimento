// =====================================================
// roteiro.js — suporte a 2 JSONs (PF x PJ) + melhorias
// - Carrega "roteiros.json" (PF) ou "roteiros1.json" (PJ)
// - Botões ficam fora do quadro do script (em #globalActions / .global-actions)
// - Painel ADM, busca, progresso, histórico, tema, etc.
// =====================================================

// ------------------------
// Utils
// ------------------------
const $  = (s, ctx=document) => ctx.querySelector(s);
const $$ = (s, ctx=document) => [...ctx.querySelectorAll(s)];

// ------------------------
// DOM refs globais
// ------------------------
const flow          = $("#flow");
const bar           = $("#bar");
const progressText  = $("#progressText");
const jumpSelect    = $("#jumpSelect");
const globalActions = document.getElementById("globalActions") || document.querySelector(".global-actions");

// ------------------------
// Estado
// ------------------------
let roteiros = {};              // Mapa de telas por ID (inclui telas do sistema)
let startByProduct = {};        // { PRODUTO: 'id_da_tela_abordagem' }
let historyStack = [];
let state = { produto: "", atendimento: "", pessoa: "" };
let isAdmin = false;
let currentId = null;

// =====================================================
// Fonte de dados (PF x PJ)
// =====================================================
function sourceFileForPessoa(p) {
  const v = String(p || "").toLowerCase();
  if (["juridica", "jurídica", "pj"].includes(v)) return "roteiros1.json"; // PJ
  return "roteiros.json"; // PF (default)
}

async function loadRoteirosJSON(pessoa = state.pessoa || "fisica") {
  const file = sourceFileForPessoa(pessoa);
  const resp = await fetch(file, { cache: "no-store" });
  if (!resp.ok) throw new Error(`Não foi possível carregar ${file}`);
  return resp.json();
}

// =====================================================
// Telas do sistema
// =====================================================
function buildSystemScreens() {
  // Tela de Início
  roteiros.inicio = {
    id: "inicio",
    title: "Início",
    body: `
      <div class="grid-3">
        <label>Tipo de atendimento</label>
        <div class="chips" id="chipsAtendimento">
          <button class="chip" data-value="ativo">Ativo</button>
          <button class="chip" data-value="receptivo">Receptivo</button>
        </div>

        <label>Pessoa</label>
        <div class="chips" id="chipsPessoa">
          <button class="chip" data-value="fisica">Física</button>
          <button class="chip" data-value="juridica">Jurídica</button>
        </div>

        <label>Produto</label>
        <div class="chips" id="chipsProduto"></div>
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
    body: `Não foi possível confirmar a identidade do responsável pelo CNPJ.<br>Oriente novo contato em momento oportuno.`,
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
  roteiros = {};               // zera para reconstruir
  startByProduct = {};         // zera mapeamento de início por produto

  Object.entries(json.marcas).forEach(([produto, telasObj]) => {
    // tenta achar a tela de "abordagem" como ponto de partida
    const abordagem = telasObj.abordagem || Object.values(telasObj)[0];
    if (abordagem?.id) startByProduct[produto] = abordagem.id;

    // insere cada tela usando o seu próprio 'id' como chave
    Object.values(telasObj).forEach(def => {
      if (!def?.id) return;
      roteiros[def.id] = { ...def, product: produto };
    });
  });

  // adiciona telas do sistema
  buildSystemScreens();
}

// =====================================================
// Modal de Tabulação (injeção + controle)
// =====================================================
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

// =====================================================
// Helpers (produtos, chips, etc.)
// =====================================================
function uniqueProducts() {
  return [...new Set(Object.values(roteiros).map(r => r.product).filter(Boolean))];
}
function updateStartEnabled() {
  const startBtn = $("#btnStart");
  if (startBtn) startBtn.disabled = !(state.atendimento && state.produto && state.pessoa);
}
function buildProductChips(inicioSection) {
  const chipsProduto = $("#chipsProduto", inicioSection);
  if (!chipsProduto) return;
  chipsProduto.innerHTML = "";
  uniqueProducts().forEach(produto => {
    const btn = document.createElement("button");
    btn.className = "chip";
    btn.dataset.value = produto;
    btn.textContent = produto;
    if (produto === state.produto) btn.classList.add("selected");
    btn.onclick = () => {
      state.produto = produto;
      $$("#chipsProduto .chip", inicioSection).forEach(c => c.classList.remove("selected"));
      btn.classList.add("selected");
      updateStartEnabled();
    };
    chipsProduto.appendChild(btn);
  });
}

async function reloadRoteirosForPessoa(pessoaSel) {
  const inicioSec = byId("inicio");
  $("#chipsProduto", inicioSec)?.replaceChildren(document.createTextNode("Carregando..."));

  // limpa produto ao trocar de pessoa
  state.produto = "";
  updateStartEnabled();

  const json = await loadRoteirosJSON(pessoaSel);
  flattenProducts(json);

  // Reconstroi chips de produto na tela atual de início
  if (inicioSec) buildProductChips(inicioSec);

  // Como o conjunto de telas mudou, atualiza jump/progresso
  buildJumpList();
  updateProgress();
}

// =====================================================
// Renderização de telas
// =====================================================
function renderScreen(def) {
  const sec = document.createElement("section");
sec.className = "screen";
sec.dataset.id = def.id;
sec.innerHTML = `
  <div class="title" style="font-size:${def.fontSizeTitle || '22px'}">${def.title}</div>
  <div class="script" style="font-size:${def.fontSizeBody || '18px'}">${def.body}</div>
`;


  // Ícone ✔ de Tabulação (no canto do quadro)
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

  // Mensagem temporária ao lado externo (opcional)
  const tabAlert = document.createElement("div");
  tabAlert.className = "tab-alert";
  tabAlert.innerHTML = `⬅️ Caso a ligação encerre,<br>verifique a tabulação<br>ao lado`;
  sec.appendChild(tabAlert);
  const toggleAlert = () => {
    tabAlert.classList.remove("hide");
    setTimeout(() => tabAlert.classList.add("hide"), 5000);
  };
  toggleAlert();
  setInterval(toggleAlert, 15000);

  flow.appendChild(sec);

  // Lógica especial para tela inicial: chips e Start
  if (def.id === "inicio") {
    updateStartEnabled();

    // atendimento
    $$("#chipsAtendimento .chip", sec).forEach(btn => {
      btn.onclick = () => {
        state.atendimento = btn.dataset.value;
        $$("#chipsAtendimento .chip", sec).forEach(c => c.classList.remove("selected"));
        btn.classList.add("selected");
        updateStartEnabled();
      };
    });

    // produto
    buildProductChips(sec);

    // pessoa
    $$("#chipsPessoa .chip", sec).forEach(btn => {
      btn.onclick = async () => {
        state.pessoa = btn.dataset.value;
        $$("#chipsPessoa .chip", sec).forEach(c => c.classList.remove("selected"));
        btn.classList.add("selected");
        try {
          await reloadRoteirosForPessoa(state.pessoa);
        } catch (e) {
          console.error(e);
          alert("Erro ao carregar os roteiros da pessoa selecionada.");
        }
        updateStartEnabled();
      };
    });
  }
}

// Monta os botões no container global (abaixo do quadro)
function buildGlobalButtons(def) {
  const container = globalActions;
  // Fallback: se não houver container global, cria/usa um dentro da tela ativa
  const useFallback = !container;
  const host = useFallback ? byId(def.id).querySelector(".actions") || byId(def.id).appendChild(Object.assign(document.createElement("div"),{className:"actions"})) : container;

  if (host) host.innerHTML = "";

  const add = (btn) => host && host.appendChild(btn);

  // Botão Voltar (exceto início)
  if (def.id !== "inicio") {
    const backBtn = document.createElement("button");
    backBtn.className = "btn";
    backBtn.textContent = "⬅ Voltar";
    backBtn.onclick = () => {
      historyStack.pop();
      const prev = historyStack.pop();
      go(prev || "inicio");
    };
    add(backBtn);
  }

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
        if (!produto || !startId) return alert("Selecione um produto válido para iniciar.");
        go(startId);
      };
    } else if (def.id === "inicio" && b.label === "Resetar") {
      btn.onclick = () => hardReset();
    } else if (def.id === "fim" && b.next === "inicio") {
      btn.onclick = () => hardReset();
    } else {
      btn.onclick = () => go(b.next);
    }

    add(btn);
  });
}

// =====================================================
// Navegação
// =====================================================
function show(id) {
  $$(".screen", flow).forEach(s => s.classList.toggle("active", s.dataset.id === id));
  if (jumpSelect) jumpSelect.value = id;
  updateProgress();
  if (isAdmin) loadScreen(id);

  // Atualiza os botões globais da tela ativa
  const def = roteiros[id];
  if (def) buildGlobalButtons(def);
}
function go(id) {
  if (!roteiros[id]) return;
  if (!byId(id)) renderScreen(roteiros[id]);
  historyStack.push(id);
  buildJumpList();
  show(id);
}
function byId(id) { return $(`.screen[data-id="${id}"]`); }

// Re-render seguro da tela atual (para refletir alterações via ADM)
function rerenderScreen(id) {
  const old = byId(id);
  if (old) old.remove();
  renderScreen(roteiros[id]);
  show(id);
}

// =====================================================
// Progresso (considera somente o produto atual)
// =====================================================
function updateProgress() {
  const isStep = (r) => r.id !== "inicio" && r.id !== "fim" && r.id !== "nao_confirma";
  const total = Object.values(roteiros).filter(r => isStep(r) && (!state.produto || r.product === state.produto)).length;
  const traversed = historyStack.filter(x => {
    const r = roteiros[x];
    return r && isStep(r) && (!state.produto || r.product === state.produto);
  }).length;

  const percent = total ? Math.round((traversed / total) * 100) : 0;
  if (bar) bar.style.width = percent + "%";
  if (progressText) progressText.textContent = (traversed >= total && total > 0) ? "Concluído" : `Passo ${traversed} de ${total}`;
}

// =====================================================
// Jump
// =====================================================
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
  const id = jumpSelect?.value;
  if (id) go(id);
});

// =====================================================
// ADM
// =====================================================

const fldId        = $("#fldId");
const fldTitle     = $("#fldTitle");
const fldBody      = $("#fldBody");
const fldTab       = $("#fldTab");
const fldButtons   = $("#fldButtons");
const btnAddButton = $("#btnAddButton");
const fldFontSizeBody    = $("#fldFontSizeBody");
const fldFontSizeButtons = $("#fldFontSizeButtons");
const fldFontSizeTitle   = $("#fldFontSizeTitle");


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
btnAddButton?.addEventListener("click", () => {
  if (!currentId) return;
  if (!Array.isArray(roteiros[currentId].buttons)) roteiros[currentId].buttons = [];
  roteiros[currentId].buttons.push({ label: "Novo Botão", next: "inicio", primary: false });
  loadButtons(roteiros[currentId]);
});

function loadScreen(id) {
  if (!roteiros[id]) return;
  currentId = id;
  const def = roteiros[id];

  if (fldId)    fldId.value = def.id || "";
  if (fldTitle) fldTitle.value = def.title || "";
  if (fldBody)  fldBody.value = def.body || "";
  if (fldTab)   fldTab.value = def.tab || "";
  loadButtons(def);

  if (fldFontSizeBody) fldFontSizeBody.value = parseInt(def.fontSizeBody) || 18;
  if (fldFontSizeButtons) fldFontSizeButtons.value = parseInt(def.fontSizeButtons) || 16;
  if (fldFontSizeTitle) fldFontSizeTitle.value = parseInt(def.fontSizeTitle) || 22;

}


function applyAdmChanges() {
  if (!currentId) return;
  const def = roteiros[currentId];
  def.id    = fldId?.value?.trim()   || def.id;
  def.title = fldTitle?.value?.trim()|| def.title;
  def.body  = fldBody?.value?.trim() || def.body;
  def.tab   = fldTab?.value?.trim()  || def.tab;
  saveButtons(def);

  // aplica tamanho de texto do quadro
  if (fldFontSizeBody && fldFontSizeBody.value) {
    def.fontSizeBody = fldFontSizeBody.value + "px";
  }

  // aplica tamanho de texto dos botões
  if (fldFontSizeButtons && fldFontSizeButtons.value) {
    def.fontSizeButtons = fldFontSizeButtons.value + "px";
  }

  // aplica tamanho de texto do título
  if (fldFontSizeTitle && fldFontSizeTitle.value) {
  def.fontSizeTitle = fldFontSizeTitle.value + "px";
  }

  if (def.fontSizeTitle) {
  const screen = byId(currentId);
  if (screen) {
    $(".title", screen).style.fontSize = def.fontSizeTitle;
  }
}



  // Atualiza a tela atual
  rerenderScreen(currentId);

  // aplica estilos na tela renderizada
  const screen = byId(currentId);
  if (screen && def.fontSizeBody) {
    $(".script", screen).style.fontSize = def.fontSizeBody;
  }
  if (def.fontSizeButtons) {
    $$("#globalActions .btn").forEach(btn => {
      btn.style.fontSize = def.fontSizeButtons;
    });
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

// =====================================================
// Reset completo (UI + estado + progresso)
// =====================================================
function resetInicioUI() {
  const scr = byId("inicio");
  if (!scr) return;

  // limpa seleção dos chips
  ["chipsAtendimento", "chipsProduto", "chipsPessoa"].forEach(id => {
    $(`#${id}`, scr)?.querySelectorAll(".chip")?.forEach(c => c.classList.remove("selected"));
  });

  // limpa estado
  state = { produto: "", atendimento: "", pessoa: "" };

  // desabilita Start
  updateStartEnabled();
}
async function hardReset() {
  historyStack = [];
  state = { produto: "", atendimento: "", pessoa: "" };
  flow.innerHTML = "";
  globalActions && (globalActions.innerHTML = "");

  // Recarrega PF (default) para a primeira renderização
  try {
    const json = await loadRoteirosJSON("fisica");
    flattenProducts(json);
  } catch (e) {
    console.error(e);
    alert("Erro ao carregar roteiros iniciais (PF).");
  }

  renderScreen(roteiros.inicio);
  go("inicio");                // reabre do início
  resetInicioUI();             // limpa chips e desabilita Start
  updateProgress();            // barra volta pra 0%
}

// =====================================================
// Bootstrap / Init
// =====================================================
async function bootstrap() {
  ensureTabModalInjected();
  try {
    const json = await loadRoteirosJSON("fisica"); // default PF até o usuário escolher PJ
    flattenProducts(json);     // popula roteiros + startByProduct + telas do sistema
    // render inicial
    renderScreen(roteiros.inicio);
    go("inicio");
  } catch (err) {
    console.error(err);
    alert("Erro ao carregar os roteiros. Verifique os arquivos JSON.");
  }
}
document.addEventListener("DOMContentLoaded", bootstrap);

// =====================================================
// Pesquisa rápida (Situações + Tabulações + Canais)
// =====================================================
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
    if (termo.includes("canais")) {
      window.location.href = "canais.html";
      return;
    }

    const found = Object.values(roteiros).find(r =>
      (r.title || "").toLowerCase().includes(termo) ||
      (r.body  || "").toLowerCase().includes(termo)
    );

    if (found) go(found.id);
    else alert("Nenhuma tela encontrada para: " + termo);
  }
});

// =====================================================
// Tema (Dark / Light)
// =====================================================
const themeBtn = document.getElementById("btnToggleTheme");

// Carrega tema salvo
if (localStorage.getItem("theme")) {
  document.body.setAttribute("data-theme", localStorage.getItem("theme"));
}

themeBtn?.addEventListener("click", () => {
  const current = document.body.getAttribute("data-theme");
  const next = current === "light" ? "dark" : "light";
  document.body.setAttribute("data-theme", next);
  localStorage.setItem("theme", next);
});
