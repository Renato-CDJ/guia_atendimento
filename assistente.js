// assistente.js — IA simples baseada em fraseologias do DOM (com múltiplas respostas)

let knowledgeBase = [];

/**
 * Normaliza texto
 */
function norm(text) {
  return (text || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

/**
 * Constrói base de conhecimento varrendo o DOM
 */
function buildKnowledge() {
  knowledgeBase = [];

  // Scripts, descrições, listas
  document.querySelectorAll(".script, p, li").forEach(el => {
    const text = el.innerText.trim();
    if (text.length > 6) {
      knowledgeBase.push({
        text,
        normText: norm(text)
      });
    }
  });

  // Também pega títulos de situações/canais/tabulações
  document.querySelectorAll(".title, h3").forEach(el => {
    const text = el.innerText.trim();
    if (text.length > 3) {
      knowledgeBase.push({
        text,
        normText: norm(text)
      });
    }
  });
}

/**
 * Busca respostas mais relevantes
 */
function getAnswers(question, limit = 3) {
  const q = norm(question).split(/\s+/);
  let scored = [];

  for (const item of knowledgeBase) {
    let score = 0;
    q.forEach(word => {
      if (item.normText.includes(word)) score++;
    });
    if (score > 0) {
      scored.push({ ...item, score });
    }
  }

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit).map(s => s.text);
}

/**
 * Injeta UI do Assistente
 */
function injectAssistenteUI() {
  if (document.getElementById("btnAssistente")) return;

  const btn = document.createElement("button");
  btn.id = "btnAssistente";
  btn.className = "badge";
  btn.style.cssText = "position:fixed; bottom:20px; right:20px; z-index:1000;";
  btn.textContent = "🤖 Assistente";

  const panel = document.createElement("div");
  panel.id = "assistentePanel";
  panel.style.cssText = `
    position:fixed; bottom:70px; right:20px; width:320px;
    background:var(--panel); border:1px solid #222; border-radius:12px;
    padding:12px; box-shadow:var(--shadow); display:none; z-index:999;`;

  panel.innerHTML = `
    <h3 style="margin-bottom:8px; color:var(--accent)">Assistente</h3>
    <input id="assistenteInput" type="text" class="select" placeholder="Digite sua pergunta..." style="width:100%; margin-bottom:8px;">
    <button id="assistenteSend" class="btn btn-primary" style="width:100%;">Perguntar</button>
    <div id="assistenteOutput" style="margin-top:10px; font-size:14px; line-height:1.4;"></div>
  `;

  document.body.appendChild(btn);
  document.body.appendChild(panel);

  const input = panel.querySelector("#assistenteInput");
  const output = panel.querySelector("#assistenteOutput");

  function ask() {
    const question = input.value.trim();
    if (!question) return;
    const answers = getAnswers(question);
    if (answers.length === 0) {
      output.innerHTML = `<div><b>Pergunta:</b> ${question}</div><div>❓ Não encontrei resposta para isso.</div>`;
    } else {
      output.innerHTML = `<div><b>Pergunta:</b> ${question}</div>` +
        answers.map(a => `<div><b>Resposta:</b> ${a}</div>`).join("");
    }
  }

  btn.addEventListener("click", () => {
    panel.style.display = panel.style.display === "block" ? "none" : "block";
    input.focus();
  });

  panel.querySelector("#assistenteSend").addEventListener("click", ask);

  // Enter também envia
  input.addEventListener("keypress", e => {
    if (e.key === "Enter") ask();
  });
}

/**
 * Inicialização
 */
document.addEventListener("DOMContentLoaded", () => {
  injectAssistenteUI();
  buildKnowledge();
});
