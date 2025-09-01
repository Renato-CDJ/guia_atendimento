// =====================================================
// roteiro.js — suporte a 2 JSONs (PF x PJ) + melhorias
// + Integração Auto-Save no Firebase
// + 🔒 Modo Operador: bloqueio total de recursos ADM
// + 👁️ Opção de mostrar/ocultar seletor de Telas no ADM
// =====================================================

// ------------------------
// Utils
// ------------------------
const $  = (s, ctx=document) => ctx.querySelector(s);
const $$ = (s, ctx=document) => [...ctx.querySelectorAll(s)];

// Detecta se estamos na página do Operador (trava ADM)
const IS_OPERADOR_PAGE =
  /operador\.html(\?|$)/.test(location.pathname || "") ||
  document.body?.dataset?.role === "operador" ||
  document.documentElement?.dataset?.role === "operador";

// ------------------------
// Firebase (auto-load) + helpers for auto-save
// ------------------------
let __fb_db = null;
let __fs = null;

(async function initFirebaseForRoteiro() {
  try {
    const mod = await import('./firebase.js');
    __fb_db = mod.db;
    __fs = await import('https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js');
    console.log('[Firebase] Firestore pronto para auto-save.');
  } catch (e) {
    console.warn('[Firebase] Não foi possível carregar Firestore para auto-save:', e);
  }
})();

// (original) salva tela no Firebase
async function saveScreenToFirebase(def, oldId=null) {
  try {
    if (!__fb_db || !__fs || !def?.id) return;
    const { doc, setDoc, deleteDoc } = __fs;

    // 🔽 remove chaves undefined
    const safeDef = JSON.parse(JSON.stringify(def));

    if (oldId && oldId !== def.id) {
      await deleteDoc(doc(__fb_db, 'roteiros', String(oldId)));
    }
    await setDoc(doc(__fb_db, 'roteiros', String(def.id)), safeDef, { merge: true });
    console.log('[Auto-save] Tela salva no Firebase:', def.id);
  } catch (e) {
    console.error('[Auto-save] Erro ao salvar tela:', e);
  }
}

async function deleteScreenFromFirebase(id) {
  try {
    if (!__fb_db || !__fs || !id) return;
    const { doc, deleteDoc } = __fs;
    await deleteDoc(doc(__fb_db, 'roteiros', String(id)));
    console.log('[Auto-save] Tela removida do Firebase:', id);
  } catch (e) {
    console.error('[Auto-save] Erro ao remover tela:', e);
  }
}

// Debounce util para evitar excesso de chamadas
function debounce(fn, ms = 800) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

// ------------------------
// DOM refs globais
// ------------------------
const flow          = $("#flow");
const bar           = $("#bar");
const progressText  = $("#progressText");
const jumpWrapper   = $("#jumpWrapper");
const jumpSelect    = $("#jumpSelect");
const btnJumpBack   = $("#btnJumpBack");
const globalActions = document.getElementById("globalActions") || document.querySelector(".global-actions");
const chkShowJump   = $("#chkShowJump");

// ------------------------
// Estado
// ------------------------
let roteiros = {};
let startByProduct = {};
let historyStack = [];
let state = { produto: "", atendimento: "", pessoa: "" };
let isAdmin = false;
let currentId = null;

// =====================================================
// 🔒 BLOQUEIO: Neutraliza funções de ADM no modo Operador
// =====================================================
if (IS_OPERADOR_PAGE) {
  // Blindagem: impede mutação de telas no Firestore
  const noOp = async () => { /* bloqueado no modo Operador */ };
  saveScreenToFirebase  = noOp;
  deleteScreenFromFirebase = noOp;

  // Impede alternar para ADM por devtools
  Object.defineProperty(window, 'forceAdmin', {
    configurable: false,
    enumerable: false,
    get: () => false,
    set: () => {/* ignore */}
  });
}

// =====================================================
// Fonte de dados (PF x PJ)
// =====================================================
function sourceFileForPessoa(p) {
  const v = String(p || "").toLowerCase();
  if (["juridica", "jurídica", "pj"].includes(v)) return "roteiros1.json";
  return "roteiros.json";
}
async function loadRoteirosJSON(pessoa = state.pessoa || "fisica") {
  const file = sourceFileForPessoa(pessoa);
  const resp = await fetch(file, { cache: "no-store" });
  if (!resp.ok) throw new Error(`Não foi possível carregar ${file}`);
  return resp.json();
}

// Novo: carregar roteiros direto do Firestore
async function loadRoteirosFromFirebase() {
  if (!__fb_db || !__fs) return null;
  const { collection, getDocs } = __fs;
  const snapshot = await getDocs(collection(__fb_db, "roteiros"));
  const data = {};
  snapshot.forEach(docSnap => {
    const def = docSnap.data();
    if (def?.id) {
      data[def.id] = def;
    }
  });
  return data;
}

// =====================================================
// Telas do sistema
// =====================================================
function buildSystemScreens() {
  roteiros.inicio = {
    id: "inicio",
    title: "Início",
    body: `
      <div class="grid-3">
        <label><b>Tipo de atendimento</b></label>
        <div class="chips" id="chipsAtendimento">
          <button class="chip" data-value="ativo"><b>Ativo</b></button>
          <button class="chip" data-value="receptivo"><b>Receptivo</b></button>
        </div>
        <label><b>Pessoa</b></label>
        <div class="chips" id="chipsPessoa">
          <button class="chip" data-value="fisica"><b>Física</b></button>
          <button class="chip" data-value="juridica"><b>Jurídica</b></button>
        </div>
        <label><b>Produto</b></label>
        <div class="chips" id="chipsProduto"></div>
      </div>
    `,
    tab: "Seleção inicial do fluxo",
    buttons: [
      { label: "Iniciar", next: "__start", primary: true },
      { label: "Resetar", next: "inicio" }
    ]
  };
  roteiros.fim = {
    id: "fim",
    title: "Fim",
    body: `Atendimento encerrado. Obrigado!`,
    tab: "Encerramento",
    buttons: [{ label: "Voltar ao início", next: "inicio", primary: true }]
  };
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
function flattenProducts(json) {
  if (!json?.marcas) throw new Error("JSON inválido: nó 'marcas' ausente.");
  roteiros = {};
  startByProduct = {};
  Object.entries(json.marcas).forEach(([produto, telasObj]) => {
    const abordagem = telasObj.abordagem || Object.values(telasObj)[0];
    if (abordagem?.id) startByProduct[produto] = abordagem.id;
    Object.values(telasObj).forEach(def => {
      if (!def?.id) return;
      roteiros[def.id] = { ...def, product: produto };
    });
  });
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
// Alerta Global (mostrado só ao iniciar)
// =====================================================
let tabAlertTimer = null;

function startTabAlertLoop() {
  const tabAlert = document.getElementById("tabAlert");
  if (!tabAlert) return;

  // 🔄 limpa qualquer loop anterior
  if (tabAlertTimer) clearInterval(tabAlertTimer);

  const toggleAlert = () => {
    // reset visibilidade
    tabAlert.classList.remove("show", "hide");

    // força repaint para reativar animação
    void tabAlert.offsetWidth;

    // mostra
    requestAnimationFrame(() => {
      tabAlert.classList.add("show");
    });

    // esconde após 2s
    setTimeout(() => {
      tabAlert.classList.remove("show");
      tabAlert.classList.add("hide");
    }, 3000);
  };

  // mostra imediatamente ao entrar na tela
  toggleAlert();

  // repete a cada 3s
  tabAlertTimer = setInterval(toggleAlert, 7000);
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

  state.produto = "";
  updateStartEnabled();

  const json = await loadRoteirosJSON(pessoaSel);
  flattenProducts(json);

  if (inicioSec) buildProductChips(inicioSec);

  if (isAdmin) buildJumpList();
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
  <div class="script" style="font-size:${def.fontSizeBody || '18px'}; padding:${def.paddingBody || '16px'}">${def.body}</div>
`;

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

  flow.appendChild(sec);

  const tabWrapper = document.createElement("div");
tabWrapper.className = "tab-wrapper";

const tabText = document.createElement("span");
tabText.className = "tab-text";
tabText.textContent = "Verificar Tabulação";

tabWrapper.appendChild(tabIcon);
tabWrapper.appendChild(tabText);
sec.prepend(tabWrapper);


  if (def.id === "inicio") {
    updateStartEnabled();

    $$("#chipsAtendimento .chip", sec).forEach(btn => {
      btn.onclick = () => {
        state.atendimento = btn.dataset.value;
        $$("#chipsAtendimento .chip", sec).forEach(c => c.classList.remove("selected"));
        btn.classList.add("selected");
        updateStartEnabled();
      };
    });

    buildProductChips(sec);

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

function buildGlobalButtons(def) {
  const container = globalActions;
  const useFallback = !container;
  const host = useFallback ? byId(def.id).querySelector(".actions") || byId(def.id).appendChild(Object.assign(document.createElement("div"),{className:"actions"})) : container;

  if (host) host.innerHTML = "";

  const add = (btn) => host && host.appendChild(btn);

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

  (def.buttons || []).forEach(b => {
    const btn = document.createElement("button");
    btn.className = "btn" + (b.primary ? " btn-primary" : "");
    btn.textContent = b.label;
    btn.style.fontSize = def.fontSizeButtons || "16px"; // 🔥 NOVO: tamanho customizado

    if (def.id === "inicio" && b.next === "__start") {
  btn.id = "btnStart";
  btn.disabled = true;
  btn.onclick = () => {
    const produto = state.produto;
    const startId = startByProduct[produto];
    if (!produto || !startId) return alert("Selecione um produto válido para iniciar.");
    go(startId);

    // 🔔 só mostra o alerta ao clicar em iniciar
    startTabAlertLoop();
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
  if (isAdmin && jumpSelect) jumpSelect.value = id;
  updateProgress();
  if (isAdmin && !IS_OPERADOR_PAGE) loadScreen(id); // só carrega no ADM

  // Atualiza os botões globais da tela ativa
  const def = roteiros[id];
  if (def) buildGlobalButtons(def);
}
function go(id) {
  if (!roteiros[id]) return;
  if (!byId(id)) renderScreen(roteiros[id]);
  historyStack.push(id);
  if (isAdmin) buildJumpList();
  show(id);

  // 🔔 inicia o alerta sempre que mudar de tela
  startTabAlertLoop();
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
  const current = historyStack.at(-1); // tela atual

  // Se for a tela de fim → resetar barra
  if (current === "fim") {
    if (bar) bar.style.width = "0%";
    if (progressText) progressText.textContent = "Passo 0 de 0";
    return;
  }

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
// Jump (somente para ADM)
// =====================================================
function buildJumpList() {
  if (!isAdmin || !jumpSelect) return; // 🔒 só ADM
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
btnJumpBack?.addEventListener("click", () => {
  if (!isAdmin) return;
  const id = jumpSelect?.value;
  if (id) go(id);
});

// =====================================================
// Preferência de visibilidade do Jump (ADM)
// =====================================================
function getStoredShowJump() {
  const v = localStorage.getItem("showJump");
  return v === null ? true : v !== "0"; // default: mostrar
}
function applyJumpVisibility(visibleParam) {
  if (!jumpWrapper) return;
  const visible = (typeof visibleParam === 'boolean')
    ? visibleParam
    : (chkShowJump ? !!chkShowJump.checked : getStoredShowJump());
  jumpWrapper.style.display = visible ? "" : "none";
  // salva apenas quando soubermos o estado booleano
  if (typeof visible === 'boolean') localStorage.setItem("showJump", visible ? "1" : "0");
}
function updateJumpAdminVisibility() {
  if (!jumpWrapper) return;
  if (IS_OPERADOR_PAGE || !isAdmin) {
    jumpWrapper.style.display = "none"; // nunca mostra para operador / fora do ADM
  } else {
    applyJumpVisibility(); // respeita preferência do ADM
  }
}

document.addEventListener("DOMContentLoaded", () => {
  if (chkShowJump) {
    chkShowJump.checked = getStoredShowJump();
    chkShowJump.addEventListener("change", () => applyJumpVisibility());
  }
  // Aplica estado inicial do jump (considerando admin/operador)
  updateJumpAdminVisibility();
});

// =====================================================
// ADM + Auto-save
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
const fldPaddingBody     = $("#fldPaddingBody");

// 🔥 NOVA FUNÇÃO: Vincular inputs do painel ADM
function bindAdmInputs() {
  const map = {
    fldFontSizeBody: "fontSizeBody",
    fldFontSizeButtons: "fontSizeButtons",
    fldFontSizeTitle: "fontSizeTitle",
    fldPaddingBody: "paddingBody",
    fldTab: "tab"
  };

  Object.entries(map).forEach(([fldId, key]) => {
    const el = document.getElementById(fldId);
    if (!el) return;
    el.addEventListener("input", debounce(() => {
      if (!currentId || !roteiros[currentId]) return;
      roteiros[currentId][key] = el.type === "number" ? Number(el.value) + "px" : el.value;
      saveScreenToFirebase(roteiros[currentId]);
      rerenderScreen(currentId); // aplica imediatamente
    }, 600));
  });
}

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
  if (!currentId || IS_OPERADOR_PAGE) return; // bloqueado para operador
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
  if (fldFontSizeBody)    fldFontSizeBody.value = parseInt(def.fontSizeBody) || 18;
  if (fldFontSizeButtons) fldFontSizeButtons.value = parseInt(def.fontSizeButtons) || 16;
  if (fldFontSizeTitle)   fldFontSizeTitle.value = parseInt(def.fontSizeTitle) || 22;
  if (fldPaddingBody)     fldPaddingBody.value = parseInt(def.paddingBody) || 16;
}

function applyAdmChanges() {
  if (!currentId || IS_OPERADOR_PAGE) return; // bloqueado para operador
  const def = roteiros[currentId];
  const oldId = def.id;
  def.id    = fldId?.value?.trim()   || def.id;
  def.title = fldTitle?.value?.trim()|| def.title;
  def.body  = fldBody?.value?.trim() || def.body;
  def.tab   = (fldTab?.value?.trim() || def.tab || "");

  saveButtons(def);
  if (fldFontSizeBody && fldFontSizeBody.value) def.fontSizeBody = fldFontSizeBody.value + "px";
  if (fldFontSizeButtons && fldFontSizeButtons.value) def.fontSizeButtons = fldFontSizeButtons.value + "px";
  if (fldFontSizeTitle && fldFontSizeTitle.value) def.fontSizeTitle = fldFontSizeTitle.value + "px";
  if (fldPaddingBody && fldPaddingBody.value) def.paddingBody = fldPaddingBody.value + "px";
  rerenderScreen(currentId);
  try { saveScreenToFirebase(roteiros[currentId], oldId); } catch (_) {}
}
const __autoSave = debounce(applyAdmChanges, 1000);

// Eventos de auto-save — só se não for Operador
if (!IS_OPERADOR_PAGE) {
  [fldId, fldTitle, fldBody, fldTab, fldFontSizeBody, fldFontSizeButtons, fldFontSizeTitle, fldPaddingBody]
    .filter(Boolean)
    .forEach(el => {
      el.addEventListener('input', __autoSave);
      el.addEventListener('change', __autoSave);
    });
  if (fldButtons) {
    fldButtons.addEventListener('input', __autoSave);
    fldButtons.addEventListener('change', __autoSave);
  }
}

$("#btnSave")?.addEventListener("click", () => {
  if (IS_OPERADOR_PAGE) return; // bloqueado
  applyAdmChanges(); alert("Alterações aplicadas!");
});
$("#btnReset")?.addEventListener("click", () => {
  if (IS_OPERADOR_PAGE) return; // bloqueado
  loadScreen(currentId);
});
$("#btnDelScreen")?.addEventListener("click", () => {
  if (IS_OPERADOR_PAGE) return; // bloqueado
  if (currentId && confirm("Deseja realmente remover esta tela?")) {
    const delId = currentId;
    delete roteiros[currentId];
    try { deleteScreenFromFirebase(delId); } catch(_) {}
    alert("Tela removida.");
    if (isAdmin) buildJumpList();
    $("#admPanel")?.classList.remove("open");
  }
});

$("#btnToggleMode")?.addEventListener("click", () => {
  if (IS_OPERADOR_PAGE) return; // bloqueado
  isAdmin = !isAdmin;
  $("#admPanel")?.classList.toggle("open", isAdmin);
  const toggle = $("#btnToggleMode");
  if (toggle) toggle.textContent = isAdmin ? "👤 Operador" : "⚙️ ADM";
  updateJumpAdminVisibility();
  if (isAdmin) {
    loadScreen(historyStack.at(-1) || "inicio");
    buildJumpList();
    if (jumpSelect) jumpSelect.value = historyStack.at(-1) || "inicio";
    bindAdmInputs(); // 🔥 NOVO: vincular inputs quando entrar no modo ADM
  }
});
$("#btnAdmClose")?.addEventListener("click", () => {
  if (IS_OPERADOR_PAGE) return; // bloqueado
  isAdmin = false;
  $("#admPanel")?.classList.remove("open");
  const toggle = $("#btnToggleMode");
  if (toggle) toggle.textContent = "⚙️ ADM";
  updateJumpAdminVisibility();
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

  // Se por algum motivo existir botão/painel ADM numa página de operador, remove
  if (IS_OPERADOR_PAGE) {
    $("#btnToggleMode")?.remove();
    $("#admPanel")?.remove();
    jumpWrapper?.remove();   // 👉 remove seletor de telas no operador
    isAdmin = false;
  }

  try {
    const firebaseData = await loadRoteirosFromFirebase();
    if (firebaseData && Object.keys(firebaseData).length > 0) {
      // 🔹 Carregamos direto do Firestore
      roteiros = firebaseData;
      buildSystemScreens(); // adiciona telas padrão (inicio/fim/nao_confirma)
    } else {
      // 🔹 Se não houver dados no Firestore, usa JSON local
      const json = await loadRoteirosJSON("fisica");
      flattenProducts(json);
    }

    renderScreen(roteiros.inicio);
    go("inicio");
  } catch (err) {
    console.error(err);
    alert("Erro ao carregar os roteiros. Verifique os arquivos JSON ou Firebase.");
  }

  // Ajusta a visibilidade do Jump conforme modo atual
  updateJumpAdminVisibility();
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

function adjustField(fieldId, step) {
  const input = document.getElementById(fieldId);
  if (!input) return;
  let val = parseInt(input.value) || 0;
  val = Math.min(Math.max(val + step, parseInt(input.min) || 0), parseInt(input.max) || 999);
  input.value = val;
}

// =====================================================
// Atalhos do rodapé (Operador/ADM)
// =====================================================
document.getElementById("btnTab")?.addEventListener("click", () => {
  go("inicio"); // volta para a tela inicial do roteiro
});
document.getElementById("btnSit")?.addEventListener("click", () => {
  go("inicio"); // ou poderia abrir modal específica de situações
});
document.getElementById("btnCanal")?.addEventListener("click", () => {
  go("inicio"); // idem acima
});