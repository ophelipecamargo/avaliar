// =========================
// AvaliaCEEP (Node + Postgres)
// =========================
// Front-end consumindo API + sessão (cookie via express-session).
// Objetivo: manter simples, com o mesmo padrão visual e comportamento que já funcionava.

// ---------- Utilidades ----------
function $(id) {
  return document.getElementById(id);
}

function paginaAtual() {
  const p = window.location.pathname.split("/").pop();
  return p || "index.html";
}

const LOGIN_PAGE = "login.html";
const PUBLIC_HOME = "index.html";
const ANO_KEY = "avalia_ano";

function getAnoSelecionado() {
  return Number(sessionStorage.getItem(ANO_KEY)) || new Date().getFullYear();
}

function setAnoSelecionado(ano) {
  const val = Number(ano) || new Date().getFullYear();
  sessionStorage.setItem(ANO_KEY, String(val));
  return val;
}

function anoAtual() {
  return getAnoSelecionado();
}

// Evita XSS ao renderizar texto vindo do banco
function escapeHtml(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function fmtDataBr(dataStr){
  if (!dataStr) return "-";
  const s = String(dataStr).slice(0,10);
  if (s.length !== 10 || s.indexOf("-") === -1) return s;
  return `${s.slice(8,10)}/${s.slice(5,7)}/${s.slice(0,4)}`;
}

function fmtDataHoraBr(dtStr){
  if (!dtStr) return "-";
  const s = String(dtStr).replace("T"," ");
  const [d, t] = s.split(" ");
  if (!d) return "-";
  const data = fmtDataBr(d);
  const hora = (t || "").slice(0,5);
  return hora ? `${data} ${hora}` : data;
}

// Tabelas responsivas: adiciona data-label nos td com base no thead
function enableMobileTables() {
  const tables = Array.from(document.querySelectorAll("table"));
  if (!tables.length) return;

  function applyLabels(table) {
    const headers = Array.from(table.querySelectorAll("thead th")).map(h => h.textContent.trim());
    if (!headers.length) return;
    const rows = table.querySelectorAll("tbody tr");
    rows.forEach(tr => {
      const cells = Array.from(tr.children);
      cells.forEach((td, i) => {
        if (!td.getAttribute("data-label") && headers[i]) {
          td.setAttribute("data-label", headers[i]);
        }
      });
    });
    table.classList.add("table-mobile");
  }

  tables.forEach(applyLabels);

  const observer = new MutationObserver((mutations) => {
    const toUpdate = new Set();
    mutations.forEach(m => {
      const t = m.target && m.target.closest ? m.target.closest("table") : null;
      if (t) toUpdate.add(t);
    });
    toUpdate.forEach(applyLabels);
  });

  tables.forEach(t => {
    const tb = t.querySelector("tbody");
    if (tb) observer.observe(tb, { childList: true, subtree: true });
  });

  window.addEventListener("resize", () => {
    if (window.innerWidth <= 720) tables.forEach(applyLabels);
  });
}

// Wrapper de API (JSON) com tratamento padrão
async function api(path, { method = "GET", body, headers } = {}) {
  const opts = {
    method,
    headers: { ...(headers || {}) },
    credentials: "same-origin",
  };

  if (body !== undefined) {
    opts.headers["Content-Type"] = "application/json";
    opts.body = JSON.stringify(body);
  }

  const res = await fetch(path, opts);
  let data = null;
  try {
    data = await res.json();
  } catch (_) {
    // algumas rotas podem não retornar JSON (não deveria), mas evitamos quebrar
  }

  if (!res.ok) {
    const msg = (data && (data.msg || data.error)) ? (data.msg || data.error) : `Erro (${res.status})`;
    const err = new Error(msg);
    err.status = res.status;
    err.data = data;
    throw err;
  }

  return data;
}

// ---------- Sessão (cache local para UI; sessão real é no servidor) ----------
const SESS_KEY = "avalia_sess"; // sessionStorage
function getSessaoCache() {
  try {
    return JSON.parse(sessionStorage.getItem(SESS_KEY) || "null");
  } catch (_) {
    return null;
  }
}
function setSessaoCache(obj) {
  sessionStorage.setItem(SESS_KEY, JSON.stringify(obj));
}
function clearSessaoCache() {
  sessionStorage.removeItem(SESS_KEY);
}

// Busca sessão real no servidor e atualiza cache
  async function ensureSession({ redirect = true } = {}) {
    const me = await api("/api/me");
    if (!me.logged) {
    const p = paginaAtual();
    if (redirect && p !== PUBLIC_HOME && p !== LOGIN_PAGE) {
      window.location.href = LOGIN_PAGE;
    }
    return null;
  }

  // Guarda no cache para renderizar header/fluxo rápido
  const cached = getSessaoCache() || {};
  const anoSel = Number(me.ano || getAnoSelecionado() || new Date().getFullYear());
  setAnoSelecionado(anoSel);
  const novo = {
    matricula: me.user?.matricula,
    nome: me.user?.nome,
    perfil: me.user?.perfil,
    ano: anoSel,
    // primeiroAcesso pode vir do /api/me (recomendado). Se não vier, mantém o que já tinha no cache.
    primeiroAcesso: (me.primeiroAcesso !== undefined) ? !!me.primeiroAcesso : !!cached.primeiroAcesso,
  };
  setSessaoCache(novo);
  return novo;
}

function getSessao() {
  return getSessaoCache();
}

function isAdmin() {
  const s = getSessao();
  return s?.perfil === "admin";
}

function isProfessor() {
  const s = getSessao();
  return s?.perfil === "professor";
}

function precisaTrocarSenha(sess) {
  return (sess?.perfil === "admin" || sess?.perfil === "professor") && sess?.primeiroAcesso === true;
}

// ---------- Header ----------
function renderHeader(perfil) {
  const header = $("header");
  if (!header) return;

  const s = getSessao() || {};
  const ano = String(anoAtual());

  // "AvaliaCEEP" sempre leva ao menu inicial
  const homeLink = "dashboard.html";

  let links = "";
    if (perfil === "admin") {
      links = `
        <a href="${homeLink}">Início</a>
        <a href="usuarios-tipos.html">Usuários</a>
        <a href="simulados-criar.html">Simulados</a>
        <a href="resultados.html">Resultados</a>
        <a href="graficos.html">Gráficos</a>
        <a href="liberacoes.html" class="nav-link-badge">Liberações
          <span class="nav-badge" id="liberacoesNavCount" style="display:none;">0</span>
        </a>
          <a href="perfil.html">Perfil</a>
        <a href="#" onclick="logout()">Sair</a>
      `;
    } else if (perfil === "professor") {
      links = `
        <a href="${homeLink}">Início</a>
        <a href="simulados-criar.html">Simulados</a>
        <a href="resultados.html">Resultados</a>
        <a href="graficos.html">Gráficos</a>
        <a href="alunos.html">Alunos</a>
        <a href="liberacoes.html" class="nav-link-badge">Liberações
          <span class="nav-badge" id="liberacoesNavCount" style="display:none;">0</span>
        </a>
        <a href="perfil.html">Perfil</a>
        <a href="#" onclick="logout()">Sair</a>
      `;
  } else {
    links = `
      <a href="${homeLink}">Início</a>
      <a href="simulados-aluno.html">Simulados</a>
      <a href="resultados.html">Resultados</a>
        <a href="perfil.html">Perfil</a>
      <a href="#" onclick="logout()">Sair</a>
    `;
  }

  header.innerHTML = `
    <div style="display:flex;gap:12px;align-items:center;flex-wrap:wrap;">
      <a href="${homeLink}" class="brand-link" style="color:#fff;text-decoration:none;font-weight:800;">AvaliaCEEP</a>
      <span style="opacity:.9;font-size:12px;">
        Nome: <b>${escapeHtml(s.nome || "-")}</b> | Matrícula: <b>${s.matricula || "-"}</b> | Ano:
        <select id="anoSelect" class="ano-select"></select>
        | Perfil: <b>${perfil || "-"}</b>
      </span>
    </div>
      <nav>${links}</nav>
    `;
    if (perfil === "admin" || perfil === "professor") {
      atualizarLiberacoesBadge();
    }
    initAnoSelect(ano);
  }

  async function atualizarLiberacoesBadge() {
    try {
      const r = await api("/api/admin/liberacoes");
      const total = Number((r.rows || []).length);
      const elCard = document.getElementById("liberacoesCount");
      if (elCard) {
        elCard.textContent = String(total);
        elCard.style.display = total > 0 ? "inline-flex" : "none";
      }
      const elNav = document.getElementById("liberacoesNavCount");
      if (elNav) {
        elNav.textContent = String(total);
        elNav.style.display = total > 0 ? "inline-flex" : "none";
      }
    } catch (_) {
      const elCard = document.getElementById("liberacoesCount");
      if (elCard) elCard.style.display = "none";
      const elNav = document.getElementById("liberacoesNavCount");
      if (elNav) elNav.style.display = "none";
    }
  }

  async function initAnoSelect(anoLabel) {
    const sel = document.getElementById("anoSelect");
    if (!sel) return;
    sel.disabled = true;
    try {
      const r = await api("/api/anos");
      const lista = Array.isArray(r.anos) ? r.anos.map(Number) : [];
      const atual = Number(anoLabel || getAnoSelecionado() || new Date().getFullYear());
      if (!lista.includes(atual)) lista.push(atual);
      const anos = lista.filter(n => Number.isFinite(n)).sort((a, b) => b - a);
      sel.innerHTML = anos.map(a => `<option value="${a}">${a}</option>`).join("");
      sel.value = String(atual);
      sel.disabled = false;
      sel.addEventListener("change", async () => {
        const novo = Number(sel.value);
        if (!Number.isFinite(novo)) return;
        sel.disabled = true;
        try {
          await api("/api/ano", { method: "PUT", body: { ano: novo } });
          setAnoSelecionado(novo);
          window.location.reload();
        } catch (e) {
          alert(e.message || "Erro ao alterar o ano.");
          sel.disabled = false;
        }
      });
    } catch (e) {
      sel.innerHTML = `<option value="${anoLabel}">${anoLabel}</option>`;
      sel.value = String(anoLabel);
      sel.disabled = false;
    }
  }

// ---------- Modal "Esqueci minha senha" (index) ----------
function abrirEsqueciSenha() {
  const modal = $("modalEsqueciSenha");
  if (modal) modal.style.display = "flex";
}
function fecharEsqueciSenha() {
  const modal = $("modalEsqueciSenha");
  if (modal) modal.style.display = "none";
}
window.abrirEsqueciSenha = abrirEsqueciSenha;
window.fecharEsqueciSenha = fecharEsqueciSenha;

// ---------- Login ----------
async function login() {
  const matricula = $("usuario")?.value?.trim();
  const senha = $("senha")?.value?.trim();
  const erro = $("erro");

  if (!matricula || !senha) {
    if (erro) {
      erro.innerText = "Informe matrícula e senha.";
      erro.style.color = "red";
    }
    return;
  }

  try {
    const r = await api("/api/login", { method: "POST", body: { matricula, senha } });

    // cache da sessão para UI
    setSessaoCache({
      matricula: r.user?.matricula,
      nome: r.user?.nome,
      perfil: r.user?.perfil,
      primeiroAcesso: !!r.primeiroAcesso,
    });

    // regra primeiro acesso
    if (precisaTrocarSenha(getSessao())) {
      window.location.href = "alterar-senha.html";
      return;
    }

    window.location.href = "dashboard.html";
  } catch (e) {
    if (erro) {
      erro.innerText = e.message || "Falha no login.";
      erro.style.color = "red";
    }
  }
}
window.login = login;

function toggleSenha(inputId, btn) {
  const input = document.getElementById(inputId);
  if (!input || !btn) return;
  const mostrando = input.type === "text";
  input.type = mostrando ? "password" : "text";
  btn.setAttribute("aria-label", mostrando ? "Mostrar senha" : "Ocultar senha");
}
window.toggleSenha = toggleSenha;

// ---------- Logout ----------
async function logout() {
  try {
    await api("/api/logout", { method: "POST" });
  } catch (_) {
    // mesmo se falhar, limpa cache e volta
  }
  clearSessaoCache();
  window.location.href = PUBLIC_HOME;
}
window.logout = logout;

// ✅ BLOQUEIO: se admin/prof está em primeiro acesso, só pode ficar na tela alterar-senha.html
async function bloquearSePrimeiroAcesso() {
  // index não precisa bloquear
  const p = paginaAtual();
  if (p === PUBLIC_HOME || p === LOGIN_PAGE) return;

  const s = await ensureSession({ redirect: true });
  if (!s) return;

  const estaNaTelaTroca = paginaAtual() === "alterar-senha.html";
  if (precisaTrocarSenha(s) && !estaNaTelaTroca) {
    window.location.href = "alterar-senha.html";
  }
}

// ---------- Alterar Senha ----------
async function initAlterarSenha() {
  const s = await ensureSession({ redirect: true });
  if (!s) return;

  renderHeader(s.perfil);
}

async function salvarNovaSenha() {
  const s = await ensureSession({ redirect: true });
  if (!s) return;

  const nova = $("novaSenha")?.value?.trim() || "";
  const conf = $("confirmarSenha")?.value?.trim() || "";
  const msg = $("msg");

  if (nova.length < 4) {
    if (msg) { msg.innerText = "A senha deve ter pelo menos 4 caracteres."; msg.style.color = "red"; }
    return;
  }
  if (nova !== conf) {
    if (msg) { msg.innerText = "As senhas não conferem."; msg.style.color = "red"; }
    return;
  }

  try {
    await api("/api/alterar-senha", { method: "POST", body: { nova } });

    // Atualiza cache para liberar telas
    const cached = getSessao() || {};
    cached.primeiroAcesso = false;
    setSessaoCache(cached);

    if (msg) { msg.innerText = "Senha alterada com sucesso!"; msg.style.color = "green"; }
    setTimeout(() => window.location.href = "dashboard.html", 350);
  } catch (e) {
    if (msg) { msg.innerText = e.message || "Erro ao alterar senha."; msg.style.color = "red"; }
  }
}
window.salvarNovaSenha = salvarNovaSenha;

function voltarPainel() {
  const s = getSessao();
  if (precisaTrocarSenha(s)) {
    alert("No primeiro acesso é obrigatório alterar a senha.");
    return;
  }
  window.location.href = "dashboard.html";
}
window.voltarPainel = voltarPainel;

// ---------- Dashboard ----------
async function initDashboard() {
  const s = await ensureSession({ redirect: true });
  if (!s) return;

  renderHeader(s.perfil);

  const panelTitle = $("panelTitle");
  if (panelTitle) {
    panelTitle.innerText =
      (s.perfil === "admin") ? "PAINEL ADMINISTRATIVO" :
      (s.perfil === "professor") ? "PAINEL DO PROFESSOR" :
      "PAINEL DO ALUNO";
  }

  const saudacao = $("saudacao");
  if (saudacao) saudacao.innerText = `Olá, ${s.nome || "usuário"}`;

  const mensagem = $("mensagem");
  if (mensagem) mensagem.innerText = "Selecione uma opção para continuar.";

  const cards = $("cards");
  if (!cards) return;

    if (s.perfil === "admin") {
      cards.innerHTML = `
        <div class="card card--tone-1" onclick="window.location.href='usuarios-tipos.html'">
        <div class="card-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" class="icon">
            <path d="M16 11a4 4 0 1 0-8 0 4 4 0 0 0 8 0Zm-12 9a6 6 0 0 1 12 0" />
            <path d="M17 13.5a3.5 3.5 0 1 0 0-7" />
            <path d="M19 18.5a4.5 4.5 0 0 0-3-4.2" />
          </svg>
        </div>
        <div class="card-title">Cadastrar usuários</div>
        <div class="card-desc">Administração de contas e acessos</div>
      </div>
      <div class="card card--tone-2" onclick="window.location.href='simulados-criar.html'">
        <div class="card-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" class="icon">
            <path d="M8 4h8a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z" />
            <path d="M9 8h6M9 12h6M9 16h4" />
          </svg>
        </div>
        <div class="card-title">Simulados</div>
        <div class="card-desc">Criar e organizar avaliações</div>
      </div>
      <div class="card card--tone-3" onclick="window.location.href='resultados.html'">
        <div class="card-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" class="icon">
            <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />
          </svg>
        </div>
        <div class="card-title">Resultados</div>
        <div class="card-desc">Painel de desempenho e relatórios</div>
      </div>
        <div class="card card--tone-5" onclick="window.location.href='graficos.html'">
          <div class="card-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" class="icon">
              <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />
            </svg>
          </div>
          <div class="card-title">Gráficos</div>
          <div class="card-desc">Comparativos e ranking por turma</div>
        </div>
        <div class="card card--tone-4" onclick="window.location.href='liberacoes.html'">
          <span class="badge-count" id="liberacoesCount" style="display:none;">0</span>
          <div class="card-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" class="icon">
              <path d="M12 3v6" />
            <path d="M8 7h8" />
            <path d="M6 12h12v7a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2v-7Z" />
          </svg>
        </div>
          <div class="card-title">Liberações</div>
          <div class="card-desc">Gerenciar bloqueios</div>
        </div>
        <div class="card card--tone-6" onclick="window.location.href='perfil.html'">
          <div class="card-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" class="icon">
              <path d="M12 12a4 4 0 1 0-4-4 4 4 0 0 0 4 4Z" />
              <path d="M4 20a8 8 0 0 1 16 0" />
            </svg>
          </div>
          <div class="card-title">Perfil</div>
          <div class="card-desc">Atualizar dados pessoais</div>
        </div>
      `;
    } else if (s.perfil === "professor") {
      cards.innerHTML = `
      <div class="card card--tone-1" onclick="window.location.href='simulados-criar.html'">
        <div class="card-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" class="icon">
            <path d="M8 4h8a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z" />
            <path d="M9 8h6M9 12h6M9 16h4" />
          </svg>
        </div>
        <div class="card-title">Simulados</div>
        <div class="card-desc">Acessar avaliações disponíveis</div>
      </div>
      <div class="card card--tone-2" onclick="window.location.href='resultados.html'">
        <div class="card-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" class="icon">
            <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />
          </svg>
        </div>
        <div class="card-title">Resultados</div>
        <div class="card-desc">Ver resultados de todas as turmas</div>
      </div>
      <div class="card card--tone-5" onclick="window.location.href='graficos.html'">
        <div class="card-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" class="icon">
            <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />
          </svg>
        </div>
        <div class="card-title">Gráficos</div>
        <div class="card-desc">Comparativos e ranking por turma</div>
      </div>
      <div class="card card--tone-2" onclick="window.location.href='alunos.html'">
        <div class="card-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" class="icon">
            <path d="M12 4 3 8l9 4 9-4-9-4Z" />
            <path d="M7 12v5a5 5 0 0 0 10 0v-5" />
          </svg>
        </div>
        <div class="card-title">Alunos</div>
        <div class="card-desc">Consultar lista de alunos</div>
      </div>
        <div class="card card--tone-4" onclick="window.location.href='liberacoes.html'">
          <span class="badge-count" id="liberacoesCount" style="display:none;">0</span>
          <div class="card-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" class="icon">
            <path d="M12 3v6" />
            <path d="M8 7h8" />
            <path d="M6 12h12v7a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2v-7Z" />
          </svg>
        </div>
          <div class="card-title">Liberações</div>
          <div class="card-desc">Gerenciar bloqueios</div>
        </div>
        <div class="card card--tone-6" onclick="window.location.href='perfil.html'">
          <div class="card-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" class="icon">
              <path d="M12 12a4 4 0 1 0-4-4 4 4 0 0 0 4 4Z" />
              <path d="M4 20a8 8 0 0 1 16 0" />
            </svg>
          </div>
          <div class="card-title">Perfil</div>
          <div class="card-desc">Atualizar dados pessoais</div>
        </div>

      `;
    } else {
      cards.innerHTML = `
      <div class="card card--tone-1" onclick="window.location.href='simulados-aluno.html'">
        <div class="card-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" class="icon">
            <path d="M8 4h8a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z" />
            <path d="M9 8h6M9 12h6M9 16h4" />
          </svg>
        </div>
        <div class="card-title">Avaliações</div>
        <div class="card-desc">Ver provas liberadas</div>
      </div>
        <div class="card card--tone-2" onclick="window.location.href='resultados.html'">
          <div class="card-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" class="icon">
              <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />
            </svg>
          </div>
          <div class="card-title">Meu Resultado</div>
          <div class="card-desc">Consultar minha nota</div>
        </div>
        <div class="card card--tone-6" onclick="window.location.href='perfil.html'">
          <div class="card-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" class="icon">
              <path d="M12 12a4 4 0 1 0-4-4 4 4 0 0 0 4 4Z" />
              <path d="M4 20a8 8 0 0 1 16 0" />
            </svg>
          </div>
          <div class="card-title">Perfil</div>
          <div class="card-desc">Atualizar dados pessoais</div>
        </div>
      `;
    }

    if (s.perfil === "admin" || s.perfil === "professor") {
      await atualizarLiberacoesBadge();
    }
  }

  async function initPerfilForm(sess) {
    const card = $("perfilCard");
    if (!card) return;

    const nome = $("perfilNome");
    const nascimento = $("perfilNascimento");
    const idadeWrap = $("perfilIdadeWrap");
    const idade = $("perfilIdade");
    const email = $("perfilEmail");
    const telefone = $("perfilTelefone");
    const estado = $("perfilEstado");
    const cidade = $("perfilCidade");
    const endereco = $("perfilEndereco");
    const msg = $("perfilMsg");
    const btnSalvar = $("btnSalvarPerfil");

    if (nome) nome.value = sess?.nome || "";
    if (sess?.perfil === "aluno") {
      if (idadeWrap) idadeWrap.style.display = "block";
    } else if (idadeWrap) {
      idadeWrap.style.display = "none";
    }

    try {
      const r = await api("/api/perfil");
      const p = r.perfil || {};

      if (nome && p.nome) nome.value = p.nome;
      if (nascimento && p.data_nascimento) nascimento.value = String(p.data_nascimento).slice(0, 10);
      if (sess?.perfil === "aluno") {
        atualizarIdade();
      }
      if (email) email.value = p.email || "";
      if (telefone) telefone.value = p.telefone || "";
      if (estado) estado.value = p.estado || "";
      if (cidade) cidade.value = p.cidade || "";
      if (endereco) endereco.value = p.endereco || "";
    } catch (e) {
      if (msg) {
        msg.textContent = e.message || "Erro ao carregar perfil.";
        msg.style.color = "#B91C1C";
      }
    }

    if (nascimento) {
      nascimento.addEventListener("change", () => {
        if (sess?.perfil === "aluno") atualizarIdade();
      });
    }

    if (btnSalvar) {
      btnSalvar.addEventListener("click", async () => {
        if (msg) {
          msg.textContent = "Salvando...";
          msg.style.color = "#1E3A8A";
        }
        try {
          await api("/api/perfil", {
            method: "PUT",
            body: {
              data_nascimento: nascimento?.value || "",
              email: email?.value || "",
              telefone: telefone?.value || "",
              estado: estado?.value || "",
              cidade: cidade?.value || "",
              endereco: endereco?.value || "",
            }
          });
          if (msg) {
            msg.textContent = "Dados atualizados com sucesso.";
            msg.style.color = "#15803D";
          }
        } catch (e) {
          if (msg) {
            msg.textContent = e.message || "Erro ao salvar perfil.";
            msg.style.color = "#B91C1C";
          }
        }
      });
    }

    function atualizarIdade() {
      if (!idade) return;
      const val = String(nascimento?.value || "").trim();
      if (!val) {
        idade.value = "-";
        return;
      }
      const [y, m, d] = val.split("-").map(Number);
      if (!y || !m || !d) {
        idade.value = "-";
        return;
      }
      const hoje = new Date();
      let anos = hoje.getFullYear() - y;
      const mdiff = hoje.getMonth() + 1 - m;
      if (mdiff < 0 || (mdiff === 0 && hoje.getDate() < d)) anos -= 1;
      idade.value = `${Math.max(0, anos)} anos`;
    }
  }

  async function initPerfilPage() {
    const s = await ensureSession({ redirect: true });
    if (!s) return;
    renderHeader(s.perfil);
    await initPerfilForm(s);
  }

// ---------- Tela de escolha do tipo de usuário (admin) ----------
async function initUsuariosTipos() {
  const s = await ensureSession({ redirect: true });
  if (!s) return;

  const podeEditar = s.perfil === "admin";
  if (s.perfil !== "admin" && s.perfil !== "professor") {
    window.location.href = "dashboard.html";
    return;
  }

  renderHeader(s.perfil);


  const cards = $("cardsTipos");
  if (!cards) return;

  cards.innerHTML = `
    <div class="card card--tone-1" onclick="window.location.href='usuarios.html'">
      <div class="card-icon" aria-hidden="true">
        <svg viewBox="0 0 24 24" class="icon">
          <path d="M16 11a4 4 0 1 0-8 0 4 4 0 0 0 8 0Z" />
          <path d="M4 20a6 6 0 0 1 12 0" />
          <path d="M17 9.5a3.5 3.5 0 1 0-2.3-6.1" />
        </svg>
      </div>
      <div class="card-title">Cadastrar professor</div>
      <div class="card-desc">Gerenciar acesso de docentes</div>
    </div>
    <div class="card card--tone-2" onclick="window.location.href='alunos.html'">
      <div class="card-icon" aria-hidden="true">
        <svg viewBox="0 0 24 24" class="icon">
          <path d="M12 4 3 8l9 4 9-4-9-4Z" />
          <path d="M7 12v5a5 5 0 0 0 10 0v-5" />
        </svg>
      </div>
      <div class="card-title">Cadastrar alunos</div>
      <div class="card-desc">Adicionar ou importar turmas</div>
    </div>
   
  `;
}

// ---------- Usuários (Admin/Professor) ----------
async function initUsuarios() {
  const s = await ensureSession({ redirect: true });
  if (!s) return;

  if (s.perfil !== "admin") {
    window.location.href = "dashboard.html";
    return;
  }

  renderHeader(s.perfil);

  const tbody = document.querySelector("#tabelaUsuarios tbody");
  if (!tbody) return;

  // Modal (mantém estilo e lógica que já funcionava)
  function garantirModal() {
    if ($("modalBackdrop")) return;

    const backdrop = document.createElement("div");
    backdrop.className = "modal-backdrop";
    backdrop.id = "modalBackdrop";
    backdrop.innerHTML = `
      <div class="modal">
        <div class="modal-header">
          <span id="modalTitulo">Novo Usuário</span>
          <button class="btn-sm" id="btnFecharModal" type="button">X</button>
        </div>
        <div class="modal-body">
          <div class="form-grid">
            <div class="field">
              <label>Matrícula (Login)</label>
              <input id="mMatricula" placeholder="Ex: 20260001" />
            </div>
            <div class="field">
              <label>Perfil</label>
              <select id="mPerfil">
                <option value="admin">admin</option>
                <option value="professor">professor</option>
              </select>
            </div>
            <div class="field" style="grid-column: 1 / -1;">
              <label>Nome</label>
              <input id="mNome" placeholder="Nome completo" />
            </div>
          </div>

          <div class="modal-actions">
            <button class="btn btn-secondary" id="btnCancelar" type="button">Cancelar</button>
            <button class="btn" id="btnSalvar" type="button">Salvar</button>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(backdrop);

    $("btnFecharModal").addEventListener("click", fecharModal);
    $("btnCancelar").addEventListener("click", fecharModal);
    $("btnSalvar").addEventListener("click", salvarModal);
  }

  let editMat = null;

  function abrirModal(titulo) {
    garantirModal();
    $("modalTitulo").innerText = titulo;
    $("modalBackdrop").style.display = "flex";
  }

  function fecharModal() {
    $("modalBackdrop").style.display = "none";
    $("mMatricula").value = "";
    $("mNome").value = "";
    $("mPerfil").value = "professor";
    editMat = null;
  }

  async function carregarLista() {
    const r = await api("/api/admin/users-admin-prof");
    return r.rows || [];
  }

  async function renderTabela() {
    const usuarios = await carregarLista();
    tbody.innerHTML = "";

    usuarios.forEach((u) => {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${u.matricula}</td>
        <td>${u.nome}</td>
        <td>${u.perfil}</td>
        <td>${u.primeiro_acesso ? "Sim" : "Não"}</td>
        <td>
          <button class="btn-sm" onclick="editarUsuario('${u.matricula}')">Editar</button>
          <button class="btn-sm" onclick="resetarSenha('${u.matricula}')">Resetar senha</button>
          <button class="btn-sm" onclick="removerUsuario('${u.matricula}')">Remover</button>
        </td>
      `;
      tbody.appendChild(tr);
    });
  }

  async function salvarModal() {
    const matricula = $("mMatricula").value.trim();
    const nome = $("mNome").value.trim();
    const perfil = $("mPerfil").value;

    if (!matricula || !nome) return alert("Preencha matrícula e nome.");
    if (perfil !== "admin" && perfil !== "professor") return alert("Perfil inválido.");

    try {
      if (!editMat) {
        // criar
        await api("/api/admin/users-admin-prof", {
          method: "POST",
          body: { matricula, nome, perfil },
        });
      } else {
        // editar
        await api(`/api/admin/users-admin-prof/${encodeURIComponent(editMat)}`, {
          method: "PUT",
          body: { matricula, nome, perfil },
        });

        // se você editou o próprio admin logado, atualiza cache
        const cache = getSessao();
        if (cache?.matricula === editMat) {
          cache.matricula = matricula;
          cache.nome = nome;
          cache.perfil = perfil;
          setSessaoCache(cache);
          renderHeader(cache.perfil);
        }
      }

      fecharModal();
      await renderTabela();
    } catch (e) {
      alert(e.message || "Erro ao salvar usuário.");
    }
  }

  // Expor ações globais (para onclick do HTML)
  window.editarUsuario = async (mat) => {
    garantirModal();
    try {
      const lista = await carregarLista();
      const u = lista.find(x => x.matricula === mat);
      if (!u) return;

      editMat = u.matricula;
      $("mMatricula").value = u.matricula;
      $("mNome").value = u.nome;
      $("mPerfil").value = u.perfil;

      abrirModal("Editar Usuário");
    } catch (e) {
      alert(e.message || "Erro ao carregar usuário.");
    }
  };

  window.resetarSenha = async (mat) => {
    if (!confirm("Resetar a senha para a matrícula e obrigar 1º acesso?")) return;
    try {
      await api("/api/admin/reset-senha", { method: "POST", body: { matricula: mat } });
      alert("Senha resetada! Agora a senha é a matrícula.");
      await renderTabela();
    } catch (e) {
      alert(e.message || "Erro ao resetar senha.");
    }
  };

  window.removerUsuario = async (mat) => {
    if (!confirm("Remover usuário?")) return;
    try {
      await api(`/api/admin/users-admin-prof/${encodeURIComponent(mat)}`, { method: "DELETE" });
      await renderTabela();
    } catch (e) {
      alert(e.message || "Erro ao remover usuário.");
    }
  };

  // Botão Novo
  $("btnNovoUsuario")?.addEventListener("click", () => abrirModal("Novo Usuário"));

  await renderTabela();
}

// ---------- Importação de alunos (CSV do Excel) ----------
function detectarSeparador(csvText) {
  const primeira = (csvText.split(/\r?\n/)[0] || "");
  const nPV = (primeira.match(/;/g) || []).length;
  const nV = (primeira.match(/,/g) || []).length;
  return (nPV > nV) ? ";" : ",";
}

function parseCSVAlunos(csvText) {
  const sep = detectarSeparador(csvText);
  const linhas = csvText.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  if (linhas.length < 2) return [];

  const header = linhas[0].split(sep).map(h => h.trim().toLowerCase());
  const idxMat = header.indexOf("matricula");
  const idxNome = header.indexOf("nome");
  const idxSerie = header.indexOf("serie");

  if (idxMat === -1 || idxNome === -1 || idxSerie === -1) {
    alert("CSV inválido. Use as colunas: matricula, nome, serie");
    return [];
  }

  const dados = [];
  for (let i = 1; i < linhas.length; i++) {
    const cols = linhas[i].split(sep).map(c => c.trim());
    const matricula = (cols[idxMat] || "");
    const nome = (cols[idxNome] || "");
    const serie = (cols[idxSerie] || "");
    if (!matricula || !nome || !serie) continue;
    dados.push({ matricula, nome, serie });
  }
  return dados;
}

async function importarAlunosCSV(csvText) {
  const alunos = parseCSVAlunos(csvText);
  if (alunos.length === 0) return null;

  const r = await api("/api/admin/importar-alunos", {
    method: "POST",
    body: { alunos },
  });

  alert(`Importação concluída (${r.ano}): ${r.novos} novos, ${r.atualizados} atualizados.`);
  return r;
}

// ---------- Alunos (Admin/Professor) ----------
async function initAlunos() {
  const s = await ensureSession({ redirect: true });
  if (!s) return;

  const podeEditar = s.perfil === "admin";
  if (s.perfil !== "admin" && s.perfil !== "professor") {
    window.location.href = "dashboard.html";
    return;
  }

  renderHeader(s.perfil);

  const ano = anoAtual();

  const panelTitle = $("panelTitle");
  if (panelTitle) panelTitle.innerText = `ALUNOS (ANO ${ano})`;

  const tbody = document.querySelector("#tabelaAlunos tbody");
  if (!tbody) return;

  // ---------- BUSCA + PAGINAÇÃO ----------
  let alunosCache = [];          // lista completa vinda da API
  let alunosFiltrados = [];      // lista após aplicar busca
  let pagina = 1;
  let porPagina = Number(document.getElementById("selectPorPagina")?.value || 20);
  let termoBusca = "";

  function normalizar(str) {
    return String(str || "")
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "");
  }

  async function carregarAlunosDaApi() {
    const r = await api("/api/admin/alunos-ano-atual");
    alunosCache = r.rows || [];
    aplicarFiltro(); // já recalcula filtrados e renderiza
  }

  function aplicarFiltro() {
    const t = normalizar(termoBusca);

    if (!t) {
      alunosFiltrados = [...alunosCache];
    } else {
      alunosFiltrados = alunosCache.filter(a => {
        const mat = normalizar(a.matricula);
        const nome = normalizar(a.nome);
        const serie = normalizar(a.serie);
        return mat.includes(t) || nome.includes(t) || serie.includes(t);
      });
    }

    pagina = 1; // sempre que filtrar, volta para primeira página
    atualizarInfoTotal();
    renderTabela();
  }

  function atualizarInfoTotal() {
    const el = document.getElementById("infoTotalAlunos");
    if (el) el.innerText = `Total: ${alunosFiltrados.length}`;
  }

  function totalPaginas() {
    return Math.max(1, Math.ceil(alunosFiltrados.length / porPagina));
  }

  function atualizarPaginacaoUI() {
    const total = totalPaginas();

    // corrige pagina caso o total mude
    if (pagina > total) pagina = total;
    if (pagina < 1) pagina = 1;

    const info = document.getElementById("infoPagina");
    if (info) info.innerText = `Página ${pagina} de ${total}`;

    const btnPrimeira = document.getElementById("btnPrimeira");
    const btnPrev = document.getElementById("btnPrev");
    const btnNext = document.getElementById("btnNext");
    const btnUltima = document.getElementById("btnUltima");

    if (btnPrimeira) btnPrimeira.disabled = pagina === 1;
    if (btnPrev) btnPrev.disabled = pagina === 1;
    if (btnNext) btnNext.disabled = pagina === total;
    if (btnUltima) btnUltima.disabled = pagina === total;
  }

  function renderTabela() {
    tbody.innerHTML = "";

    const inicio = (pagina - 1) * porPagina;
    const fim = inicio + porPagina;
    const paginaItens = alunosFiltrados.slice(inicio, fim);

    paginaItens.forEach(a => {
      const tr = document.createElement("tr");
      const acoesExtras = podeEditar ? `
          <button class="btn-sm" onclick="editarAluno('${a.matricula}')">Editar</button>
          <button class="btn-sm" onclick="resetarSenhaAluno('${a.matricula}')">Resetar senha</button>
          <button class="btn-sm" onclick="removerAluno('${a.matricula}')">Remover</button>
        ` : "";
      tr.innerHTML = `
        <td>${a.matricula}</td>
        <td>${a.nome}</td>
        <td>${a.serie}</td>
        <td>${a.ano}</td>
        <td>
          <button class="btn-sm" onclick="verPerfilAluno('${a.matricula}')">Ver perfil</button>
          ${acoesExtras}
        </td>
      `;
      tbody.appendChild(tr);
    });

    atualizarPaginacaoUI();
  }

  // ---------- Modal do aluno (mantém seu padrão) ----------
  function garantirModalAluno() {
    if ($("modalBackdropAluno")) return;

    const backdrop = document.createElement("div");
    backdrop.className = "modal-backdrop";
    backdrop.id = "modalBackdropAluno";
    backdrop.innerHTML = `
      <div class="modal">
        <div class="modal-header">
          <span id="modalTituloAluno">Editar Aluno</span>
          <button class="btn-sm" id="btnFecharModalAluno" type="button">X</button>
        </div>
        <div class="modal-body">
          <div class="form-grid">
            <div class="field">
              <label>Matrícula</label>
              <input id="aMatricula" />
            </div>
            <div class="field">
              <label>Ano</label>
              <input id="aAno" readonly />
            </div>
            <div class="field" style="grid-column: 1 / -1;">
              <label>Nome</label>
              <input id="aNome" placeholder="Nome completo" />
            </div>
            <div class="field" style="grid-column: 1 / -1;">
              <label>Série (Ano Atual)</label>
              <input id="aSerie" placeholder="Ex: 3º INFO B" />
            </div>
          </div>

          <div class="modal-actions">
            <button class="btn btn-secondary" id="btnCancelarAluno" type="button">Cancelar</button>
            <button class="btn" id="btnSalvarAluno" type="button">Salvar</button>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(backdrop);

    $("btnFecharModalAluno").addEventListener("click", fecharModalAluno);
    $("btnCancelarAluno").addEventListener("click", fecharModalAluno);
    $("btnSalvarAluno").addEventListener("click", salvarAlunoModal);
  }

  function garantirModalPerfilAluno() {
    if ($("modalBackdropPerfilAluno")) return;

    const backdrop = document.createElement("div");
    backdrop.className = "modal-backdrop";
    backdrop.id = "modalBackdropPerfilAluno";
    backdrop.innerHTML = `
      <div class="modal">
        <div class="modal-header">
          <span>Perfil do aluno</span>
          <button class="btn-sm" id="btnFecharPerfilAluno" type="button">X</button>
        </div>
        <div class="modal-body">
          <div class="form-grid">
            <div class="field">
              <label>Matrícula</label>
              <input id="pMatricula" readonly />
            </div>
            <div class="field">
              <label>Ano</label>
              <input id="pAno" readonly />
            </div>
            <div class="field" style="grid-column: 1 / -1;">
              <label>Nome</label>
              <input id="pNome" readonly />
            </div>
            <div class="field">
              <label>Turma</label>
              <input id="pTurma" readonly />
            </div>
            <div class="field">
              <label>Data de nascimento</label>
              <input id="pNascimento" readonly />
            </div>
            <div class="field">
              <label>Idade</label>
              <input id="pIdade" readonly />
            </div>
            <div class="field">
              <label>Email</label>
              <input id="pEmail" readonly />
            </div>
            <div class="field">
              <label>Telefone</label>
              <input id="pTelefone" readonly />
            </div>
            <div class="field">
              <label>Estado</label>
              <input id="pEstado" readonly />
            </div>
            <div class="field">
              <label>Cidade</label>
              <input id="pCidade" readonly />
            </div>
            <div class="field" style="grid-column: 1 / -1;">
              <label>Endereço</label>
              <input id="pEndereco" readonly />
            </div>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(backdrop);
    $("btnFecharPerfilAluno").addEventListener("click", () => {
      $("modalBackdropPerfilAluno").style.display = "none";
    });
  }

  function abrirModalAluno() {
    garantirModalAluno();
    $("aAno").value = String(ano);
    $("modalBackdropAluno").style.display = "flex";
  }

  function fecharModalAluno() {
    $("modalBackdropAluno").style.display = "none";
  }

  let modoEdicaoMatricula = null;

  async function salvarAlunoModal() {
    const matricula = $("aMatricula").value.trim();
    const nome = $("aNome").value.trim();
    const serie = $("aSerie").value.trim();

    if (!matricula) return alert("Preencha a matrícula.");
    if (!nome || !serie) return alert("Preencha nome e série.");

    try {
      if (!modoEdicaoMatricula) {
        // NOVO ALUNO: usa sua rota de importação (1 registro)
        await api("/api/admin/importar-alunos", {
          method: "POST",
          body: { alunos: [{ matricula, nome, serie }] },
        });
      } else {
        // EDITAR: mantém matrícula travada, mas atualiza nome/série
        await api(`/api/admin/alunos/${encodeURIComponent(modoEdicaoMatricula)}`, {
          method: "PUT",
          body: { nome, serie },
        });
      }

      fecharModalAluno();
      await carregarAlunosDaApi();

      // reaplica busca atual (mantém filtro do usuário)
      aplicarFiltro();
    } catch (e) {
      alert(e.message || "Erro ao salvar aluno.");
    }
  }

  // Expor ações globais
  window.editarAluno = (mat) => {
    if (!podeEditar) return alert("Somente ADMIN pode editar alunos.");
    garantirModalAluno();

    const a = alunosCache.find(x => x.matricula === mat);
    if (!a) return;

    modoEdicaoMatricula = a.matricula;

    $("aMatricula").readOnly = true;     // trava matrícula no editar
    $("aMatricula").value = a.matricula;
    $("aNome").value = a.nome;
    $("aSerie").value = a.serie;

    $("modalTituloAluno").innerText = "Editar Aluno";
    abrirModalAluno();
  };

  window.resetarSenhaAluno = async (mat) => {
    if (!podeEditar) return alert("Somente ADMIN pode resetar senha.");
    if (!confirm("Resetar senha do aluno para matrícula?")) return;
    try {
      await api("/api/admin/reset-senha", { method: "POST", body: { matricula: mat } });
      alert("Senha resetada!");
    } catch (e) {
      alert(e.message || "Erro ao resetar senha.");
    }
  };

  window.removerAluno = async (mat) => {
    if (!podeEditar) return alert("Somente ADMIN pode remover alunos.");
    if (!confirm("Remover aluno?")) return;
    try {
      await api(`/api/admin/alunos/${encodeURIComponent(mat)}`, { method: "DELETE" });

      // remove do cache sem depender da API novamente (mais rápido)
      alunosCache = alunosCache.filter(a => a.matricula !== mat);
      aplicarFiltro(); // mantém busca/página consistentes
    } catch (e) {
      alert(e.message || "Erro ao remover aluno.");
    }
  };

  window.verPerfilAluno = async (mat) => {
    garantirModalPerfilAluno();
    try {
      const r = await api(`/api/admin/alunos/${encodeURIComponent(mat)}/perfil`);
      const p = r.perfil || {};
      $("pMatricula").value = p.matricula || "-";
      $("pAno").value = p.ano || anoAtual();
      $("pNome").value = p.nome || "-";
      $("pTurma").value = p.turma || "-";
      $("pNascimento").value = p.data_nascimento ? fmtDataBr(p.data_nascimento) : "-";
      $("pIdade").value = calcIdade(p.data_nascimento);
      $("pEmail").value = p.email || "-";
      $("pTelefone").value = p.telefone || "-";
      $("pEstado").value = p.estado || "-";
      $("pCidade").value = p.cidade || "-";
      $("pEndereco").value = p.endereco || "-";
      $("modalBackdropPerfilAluno").style.display = "flex";
    } catch (e) {
      alert(e.message || "Erro ao carregar perfil.");
    }
  };

  function calcIdade(dataStr) {
    if (!dataStr) return "-";
    const s = String(dataStr).slice(0, 10);
    const parts = s.split("-").map(Number);
    if (parts.length !== 3 || parts.some(n => Number.isNaN(n))) return "-";
    const [y, m, d] = parts;
    const hoje = new Date();
    let anos = hoje.getFullYear() - y;
    const mdiff = (hoje.getMonth() + 1) - m;
    if (mdiff < 0 || (mdiff === 0 && hoje.getDate() < d)) anos -= 1;
    return `${Math.max(0, anos)} anos`;
  }

  if (podeEditar) {
    // Botão Novo aluno
    $("btnNovoAluno")?.addEventListener("click", () => {
      garantirModalAluno();
      modoEdicaoMatricula = null;

      $("aMatricula").readOnly = false;   // libera matrícula no novo
      $("aMatricula").value = "";
      $("aNome").value = "";
      $("aSerie").value = "";
      $("modalTituloAluno").innerText = "Novo Aluno";

      abrirModalAluno();
      setTimeout(() => $("aMatricula")?.focus(), 0);
    });

    // Importar CSV
    $("btnImportarCSV")?.addEventListener("click", () => $("fileCSV")?.click());
    $("fileCSV")?.addEventListener("change", async (e) => {
      const file = e.target.files?.[0];
      if (!file) return;

      try {
        const csvText = await file.text();
        await importarAlunosCSV(csvText);
        await carregarAlunosDaApi();
        aplicarFiltro();
      } catch (err) {
        alert(err.message || "Falha na importação.");
      } finally {
        e.target.value = "";
      }
    });
  } else {
    $("btnNovoAluno")?.setAttribute("style", "display:none;");
    $("btnImportarCSV")?.setAttribute("style", "display:none;");
    $("fileCSV")?.setAttribute("style", "display:none;");
  }

  // BUSCA (com debounce)
  const inputBusca = document.getElementById("buscaAluno");
  let tmr = null;
  inputBusca?.addEventListener("input", () => {
    clearTimeout(tmr);
    tmr = setTimeout(() => {
      termoBusca = inputBusca.value || "";
      aplicarFiltro();
    }, 200);
  });

  // Itens por página
  document.getElementById("selectPorPagina")?.addEventListener("change", (e) => {
    porPagina = Number(e.target.value || 20);
    pagina = 1;
    renderTabela();
  });

  // Paginação
  document.getElementById("btnPrimeira")?.addEventListener("click", () => {
    pagina = 1;
    renderTabela();
  });
  document.getElementById("btnPrev")?.addEventListener("click", () => {
    pagina--;
    renderTabela();
  });
  document.getElementById("btnNext")?.addEventListener("click", () => {
    pagina++;
    renderTabela();
  });
  document.getElementById("btnUltima")?.addEventListener("click", () => {
    pagina = totalPaginas();
    renderTabela();
  });

  // Inicializa
  await carregarAlunosDaApi();
}


// ---------- Init por página ----------
document.addEventListener("DOMContentLoaded", () => {
  (async () => {
    // aplica bloqueio do primeiro acesso antes de inicializar telas
    await bloquearSePrimeiroAcesso();

    const p = paginaAtual();
  if (p === "dashboard.html") await initDashboard();
  if (p === "perfil.html") await initPerfilPage();
  if (p === "graficos.html") await initGraficos();
    if (p === "usuarios-tipos.html") await initUsuariosTipos();
    if (p === "usuarios.html") await initUsuarios();
    if (p === "alunos.html") await initAlunos();
    if (p === "alterar-senha.html") await initAlterarSenha();
    if (p === "resultados.html") await initResultados();
  if (p === "questoes.html") await initQuestoes();
  if (p === "simulados-criar.html") await initSimulados();
  if (p === "simulado-detalhe.html") await initSimuladoDetalhe();
  if (p === "simulados-aluno.html") await initSimuladosAluno();
  if (p === "liberacoes.html") await initLiberacoes();
  if (p === "simulado-realizar.html") await initSimuladoRealizar();
  })();

  enableMobileTables();

  async function initResultados(){
  const s = await ensureSession({ redirect:true });
  if (!s) return;

  renderHeader(s.perfil);

  // ------------------------------
  // ALUNO — MINHAS NOTAS
  // ------------------------------
  const alunoWrap = document.getElementById("resultadosAlunoWrap");
  const adminWrap = document.getElementById("resultadosAdminWrap");

  if (s.perfil === "aluno"){
    if (alunoWrap) alunoWrap.style.display = "block";
    if (adminWrap) adminWrap.style.display = "none";

    const tabelaAluno = document.getElementById("tabelaResultadosAluno");
    if (tabelaAluno) tabelaAluno.classList.add("table-mobile");

    const tbody = document.querySelector("#tabelaResultadosAluno tbody");
    const info = document.getElementById("infoTotalResultadosAluno");
    const infoAno = document.getElementById("infoAnoResultadosAluno");
    if (!tbody) return;

    async function carregar(){
      tbody.innerHTML = `<tr><td colspan="5">Carregando...</td></tr>`;
      try{
        const data = await api("/api/aluno/resultados");
        const rows = data.rows || [];

        if (info) info.textContent = `Total: ${rows.length}`;
        if (infoAno) infoAno.textContent = data.ano ? `Ano: ${data.ano}` : "";

        if (!rows.length){
          tbody.innerHTML = `<tr><td colspan="5">Nenhum resultado encontrado.</td></tr>`;
          return;
        }

        tbody.innerHTML = rows.map(r => {
          const dt = r.realizado_em ? String(r.realizado_em).replace("T"," ").slice(0,16) : "-";
          const ac = (r.acertos ?? 0);
          const tot = (r.total ?? 0);
          const nota = Number(r.nota ?? 0).toFixed(1).replace(".", ",");
          return `
            <tr>
              <td data-label="Simulado">${escapeHtml(r.titulo)}</td>
              <td data-label="Unidade">${escapeHtml(r.unidade)}</td>
              <td data-label="Data realizada">${escapeHtml(dt)}</td>
              <td data-label="Acertos">${escapeHtml(ac)}/${escapeHtml(tot)}</td>
              <td data-label="Nota">${escapeHtml(nota)}</td>
            </tr>
          `;
        }).join("");
      }catch(e){
        tbody.innerHTML = `<tr><td colspan="5">${escapeHtml(e.message || "Erro ao carregar")}</td></tr>`;
      }
    }

    await carregar();
    return;
  }

  // ------------------------------
  // ADMIN/PROF — RELATÓRIOS
  // ------------------------------
  if (alunoWrap) alunoWrap.style.display = "none";
  if (adminWrap) adminWrap.style.display = "block";

  const selUnidade = document.getElementById("fRelUnidade");
  const selTurma = document.getElementById("fRelTurma");
  const selSimulado = document.getElementById("fRelSimulado");
  const resumo = document.getElementById("relResumo");
  const btnPdf = document.getElementById("btnExportarPdf");
  const printHeader = document.getElementById("relatorioPrintHeader");
  const printSim = document.getElementById("relPrintSimulado");
  const printTurma = document.getElementById("relPrintTurma");
  const printData = document.getElementById("relPrintData");
  const printRealizaram = document.getElementById("relPrintRealizaram");
  const printNaoRealizaram = document.getElementById("relPrintNaoRealizaram");

  const tbody = document.querySelector("#tabelaRelatorio tbody");
  const tabelaRelatorio = document.getElementById("tabelaRelatorio");
  if (tabelaRelatorio) tabelaRelatorio.classList.add("table-mobile");
  const grafico = document.getElementById("graficoSerie");
  const tabBtns = Array.from(document.querySelectorAll(".tab-btn"));
  const tbodyRanking = document.getElementById("tbodyRanking");
  const relColspan = 4;
  const selDiscUnidade = document.getElementById("fDiscUnidade");
  const selDiscTurma = document.getElementById("fDiscTurma");
  const selDiscDisciplina = document.getElementById("fDiscDisciplina");
  const tbodyDiscAlunos = document.querySelector("#tabelaDisciplinaAlunos tbody");
  const tabelaDisc = document.getElementById("tabelaDisciplinaAlunos");
  if (tabelaDisc) tabelaDisc.classList.add("table-mobile");
  const btnDiscPdf = document.getElementById("btnExportarDiscPdf");
  const relDiscPrintUnidade = document.getElementById("relDiscPrintUnidade");
  const relDiscPrintTurma = document.getElementById("relDiscPrintTurma");
  const relDiscPrintDisciplina = document.getElementById("relDiscPrintDisciplina");

  const ano = anoAtual();

  function setLoadingSelect(sel, msg){
    if (!sel) return;
    sel.innerHTML = `<option value="">${msg || "Carregando..."}</option>`;
  }

  function setEmptyTable(msg){
    if (!tbody) return;
    tbody.innerHTML = `<tr><td colspan="${relColspan}">${escapeHtml(msg || "Sem dados.")}</td></tr>`;
  }

  function setEmptyTableDiscAlunos(msg){
    if (!tbodyDiscAlunos) return;
    tbodyDiscAlunos.innerHTML = `<tr><td colspan="4">${escapeHtml(msg || "Sem dados.")}</td></tr>`;
  }

  function fmtData(dt){
    if (!dt) return "-";
    const s = String(dt).replace("T"," ");
    return s.slice(0,16);
  }

  function fmtDataBr(dataStr){
    if (!dataStr) return "-";
    const s = String(dataStr).slice(0,10);
    if (s.length !== 10 || s.indexOf("-") === -1) return s;
    return `${s.slice(8,10)}/${s.slice(5,7)}/${s.slice(0,4)}`;
  }

  function fmtDataHoraBr(dtStr){
    if (!dtStr) return "-";
    const s = String(dtStr).replace("T"," ");
    const [d, t] = s.split(" ");
    if (!d) return "-";
    const data = fmtDataBr(d);
    const hora = (t || "").slice(0,5);
    return hora ? `${data} ${hora}` : data;
  }

  function fmtNota(n){
    const v = Number(n || 0);
    return v.toFixed(1).replace(".", ",");
  }

  function setPrintHeader(sim, stats){
    if (!printHeader) return;
    if (!sim) {
      printHeader.style.display = "none";
      return;
    }

    const dataSim = sim.inicio_em ? String(sim.inicio_em).slice(0,10) : "-";
    if (printSim) printSim.textContent = sim.titulo || "-";
    if (printTurma) printTurma.textContent = sim.turma || "-";
    if (printData) printData.textContent = fmtDataBr(dataSim);
    if (printRealizaram) printRealizaram.textContent = String(stats?.realizaram ?? 0);
    if (printNaoRealizaram) printNaoRealizaram.textContent = String(stats?.nao_realizaram ?? 0);

    printHeader.style.display = "block";
  }

  async function carregarUnidades(){
    setLoadingSelect(selUnidade, "Carregando...");
    if (selTurma){ selTurma.disabled = true; selTurma.innerHTML = `<option value="">Selecione a unidade</option>`; }
    if (selSimulado){ selSimulado.disabled = true; selSimulado.innerHTML = `<option value="">Selecione a turma</option>`; }
    setEmptyTable("Selecione um simulado para visualizar.");
    if (resumo) resumo.style.display = "none";

    try{
      const r = await api(`/api/admin/relatorios/unidades?ano=${encodeURIComponent(ano)}`);
      const unidades = r.unidades || [];
      selUnidade.innerHTML = `<option value="">Selecione...</option>` + unidades.map(u => `<option value="${escapeHtml(u)}">${escapeHtml(u)}</option>`).join("");
    }catch(e){
      selUnidade.innerHTML = `<option value="">Erro ao carregar</option>`;
    }
  }

  async function carregarDisciplinasRelatorioAlunos(){
    if (!selDiscDisciplina) return;
    selDiscDisciplina.innerHTML = `<option value="">Selecione...</option>`;
    try{
      const r = await api(`/api/disciplinas`);
      const list = (r && Array.isArray(r.disciplinas)) ? r.disciplinas : [];
      list.forEach(d => {
        const opt = document.createElement("option");
        opt.value = String(d.id);
        opt.textContent = d.nome;
        selDiscDisciplina.appendChild(opt);
      });
    }catch(e){
      // mantém apenas o placeholder
    }
  }

  async function carregarUnidadesRelatorioAlunos(){
    if (!selDiscUnidade) return;
    selDiscUnidade.innerHTML = `<option value="">Selecione...</option>`;
    try{
      const r = await api(`/api/admin/relatorios/unidades?ano=${encodeURIComponent(ano)}`);
      const unidades = r.unidades || [];
      selDiscUnidade.innerHTML = `<option value="">Selecione...</option>` +
        unidades.map(u => `<option value="${escapeHtml(u)}">${escapeHtml(u)}</option>`).join("");
    }catch(e){
      selDiscUnidade.innerHTML = `<option value="">Erro ao carregar</option>`;
    }
  }

  async function carregarTurmasRelatorioAlunos(){
    if (!selDiscTurma) return;
    const unidade = String(selDiscUnidade?.value || "").trim();
    if (!unidade){
      selDiscTurma.disabled = true;
      selDiscTurma.innerHTML = `<option value="">Selecione...</option>`;
      setEmptyTableDiscAlunos("Selecione Unidade, Turma e Disciplina.");
      return;
    }
    selDiscTurma.disabled = true;
    selDiscTurma.innerHTML = `<option value="">Carregando...</option>`;
    try{
      const r = await api(`/api/admin/relatorios/turmas?ano=${encodeURIComponent(ano)}&unidade=${encodeURIComponent(unidade)}`);
      const turmas = r.turmas || [];
      selDiscTurma.innerHTML = `<option value="">Selecione...</option>` + turmas.map(t => `<option value="${escapeHtml(t)}">${escapeHtml(t)}</option>`).join("");
      selDiscTurma.disabled = false;
    }catch(e){
      selDiscTurma.innerHTML = `<option value="">Erro ao carregar</option>`;
      selDiscTurma.disabled = true;
    }
  }

  async function carregarDesempenhoDisciplinaAlunos(){
    if (!tbodyDiscAlunos) return;
    const unidade = String(selDiscUnidade?.value || "").trim();
    const turma = String(selDiscTurma?.value || "").trim();
    const disciplinaId = String(selDiscDisciplina?.value || "").trim();

    if (!unidade || !turma || !disciplinaId){
      setEmptyTableDiscAlunos("Selecione Unidade, Turma e Disciplina.");
      return;
    }

    setEmptyTableDiscAlunos("Carregando...");
    if (relDiscPrintUnidade) relDiscPrintUnidade.textContent = unidade || "-";
    if (relDiscPrintTurma) relDiscPrintTurma.textContent = turma || "-";
    if (relDiscPrintDisciplina) {
      const selText = selDiscDisciplina?.options?.[selDiscDisciplina.selectedIndex]?.textContent || "-";
      relDiscPrintDisciplina.textContent = selText;
    }
    const qs = new URLSearchParams({
      ano: String(ano),
      unidade,
      turma,
      disciplina_id: disciplinaId
    });
    try{
      const r = await api(`/api/admin/relatorios/desempenho-disciplina-alunos?${qs.toString()}`);
      const rows = r.rows || [];
      if (!rows.length){
        setEmptyTableDiscAlunos("Nenhum dado encontrado.");
        return;
      }
      tbodyDiscAlunos.innerHTML = rows.map(x => `
        <tr>
          <td data-label="Aluno">${escapeHtml(x.aluno || "-")}</td>
          <td data-label="Acertos">${escapeHtml(x.acertos ?? 0)}</td>
          <td data-label="Total">${escapeHtml(x.total ?? 0)}</td>
          <td data-label="Aproveitamento">${escapeHtml(String(x.aproveitamento ?? 0).replace(".", ","))}%</td>
        </tr>
      `).join("");
    }catch(e){
      setEmptyTableDiscAlunos(e.message || "Erro ao carregar.");
    }
  }
  async function carregarTurmas(){
    const unidade = String(selUnidade?.value || "").trim();
    if (!unidade){
      if (selTurma){ selTurma.disabled = true; selTurma.innerHTML = `<option value="">Selecione a unidade</option>`; }
      if (selSimulado){ selSimulado.disabled = true; selSimulado.innerHTML = `<option value="">Selecione a turma</option>`; }
      setEmptyTable("Selecione um simulado para visualizar.");
      if (resumo) resumo.style.display = "none";
      if (grafico || tbodyRanking) {
        await carregarComparativo(); // ainda permite comparar "todas" sem unidade
        await carregarRanking();
      }
      return;
    }

    setLoadingSelect(selTurma, "Carregando...");
    if (selTurma) selTurma.disabled = true;
    if (selSimulado){ selSimulado.disabled = true; selSimulado.innerHTML = `<option value="">Selecione a turma</option>`; }
    setEmptyTable("Selecione um simulado para visualizar.");
    if (resumo) resumo.style.display = "none";

    try{
      const r = await api(`/api/admin/relatorios/turmas?ano=${encodeURIComponent(ano)}&unidade=${encodeURIComponent(unidade)}`);
      const turmas = r.turmas || [];
      if (selTurma){
        selTurma.innerHTML = `<option value="">Selecione...</option>` + turmas.map(t => `<option value="${escapeHtml(t)}">${escapeHtml(t)}</option>`).join("");
        selTurma.disabled = false;
      }
    }catch(e){
      if (selTurma){
        selTurma.innerHTML = `<option value="">Erro ao carregar</option>`;
        selTurma.disabled = true;
      }
    }

    if (grafico || tbodyRanking) {
      await carregarComparativo();
      await carregarRanking();
    }
  }

  async function carregarSimulados(){
    const unidade = String(selUnidade?.value || "").trim();
    const turma = String(selTurma?.value || "").trim();

    if (!unidade || !turma){
      if (selSimulado){ selSimulado.disabled = true; selSimulado.innerHTML = `<option value="">Selecione a turma</option>`; }
      setEmptyTable("Selecione um simulado para visualizar.");
      if (resumo) resumo.style.display = "none";
      return;
    }

    setLoadingSelect(selSimulado, "Carregando...");
    if (selSimulado) selSimulado.disabled = true;
    setEmptyTable("Selecione um simulado para visualizar.");
    if (resumo) resumo.style.display = "none";

    try{
      const r = await api(`/api/admin/relatorios/simulados?ano=${encodeURIComponent(ano)}&unidade=${encodeURIComponent(unidade)}&turma=${encodeURIComponent(turma)}`);
      const sims = r.simulados || [];
      if (selSimulado){
        selSimulado.innerHTML = `<option value="">Selecione...</option>` + sims.map(sm => {
          const data = sm.inicio_em ? fmtDataBr(sm.inicio_em) : "";
          return `<option value="${sm.id}">${escapeHtml(sm.titulo)}${data ? " — " + escapeHtml(data) : ""}</option>`;
        }).join("");
        selSimulado.disabled = false;
      }
    }catch(e){
      if (selSimulado){
        selSimulado.innerHTML = `<option value="">Erro ao carregar</option>`;
        selSimulado.disabled = true;
      }
    }
  }

  async function carregarRelatorio(){
    const id = Number(selSimulado?.value || 0);
    if (!id){
      setEmptyTable("Selecione um simulado para visualizar.");
      if (resumo) resumo.style.display = "none";
      setPrintHeader(null, null);
      return;
    }

    tbody.innerHTML = `<tr><td colspan="${relColspan}">Carregando...</td></tr>`;
    if (resumo) resumo.style.display = "none";

    try{
      const r = await api(`/api/admin/relatorios/simulado/${id}`);
      const rows = r.rows || [];
      const sim = r.simulado || {};
      const rz = r.resumo || {};
      const totalAlunos = Number(rz.total_alunos ?? rows.length ?? 0);
      const realizaram = Number(rz.realizaram ?? rz.realizados ?? rows.filter(x => x.status === "Realizou").length);
      const naoRealizaram = Number(rz.nao_realizaram ?? rz.nao_realizou ?? (totalAlunos - realizaram));
      const emAndamento = Number(rz.em_andamento ?? 0);
      const mediaNota = (() => {
        if (rz.media_nota !== undefined) return Number(rz.media_nota || 0);
        const notas = rows.map(x => Number(x.nota)).filter(n => !Number.isNaN(n));
        if (!notas.length) return 0;
        return notas.reduce((a, b) => a + b, 0) / notas.length;
      })();
      setPrintHeader(sim, { realizaram, nao_realizaram: naoRealizaram });

      if (resumo){
        resumo.style.display = "flex";
        resumo.innerHTML = `
          <div class="pill">Simulado: <b>${escapeHtml(sim.titulo || "-")}</b></div>
          <div class="pill">Turma: <b>${escapeHtml(sim.turma || "-")}</b></div>
          <div class="pill">Realizaram: <b>${escapeHtml(realizaram)}</b></div>
          <div class="pill">Não realizaram: <b>${escapeHtml(naoRealizaram)}</b></div>
          <div class="pill">Em andamento: <b>${escapeHtml(emAndamento)}</b></div>
          <div class="pill">Média: <b>${escapeHtml(fmtNota(mediaNota))}</b></div>
        `;
      }

      if (!rows.length){
        setEmptyTable("Nenhum aluno encontrado para esta turma/ano.");
        return;
      }

      const totalQuestoes = Number(sim.num_questoes || 0);
      tbody.innerHTML = rows.map(x => {
        const st = x.status || "Não realizou";
        const fez = st === "Realizou" || st === "Enviado";
        const ac = fez ? `${x.acertos ?? 0}/${totalQuestoes}` : "-";
        const nota = fez ? fmtNota(x.nota) : "-";
        const dataRealizada = fez ? fmtDataHoraBr(x.data_realizada) : "-";
        const tempo = fez && x.tempo_gasto_min !== null && x.tempo_gasto_min !== undefined
          ? `${x.tempo_gasto_min} min`
          : "-";
        return `
          <tr>
            <td data-label="Aluno">${escapeHtml(x.nome || x.aluno_nome || "-")}</td>
            <td data-label="Acertos">${escapeHtml(ac)}</td>
            <td data-label="Nota">${escapeHtml(nota)}</td>
            <td data-label="Data">${escapeHtml(dataRealizada)}</td>
            <td data-label="Tempo">${escapeHtml(tempo)}</td>
            <td data-label="Status">${escapeHtml(st)}</td>
          </tr>
        `;
      }).join("");
    }catch(e){
      setEmptyTable(e.message || "Erro ao carregar relatório.");
      setPrintHeader(null, null);
    }
  }

  // ------------------------------
  // Gráfico (sem biblioteca externa)
  // ------------------------------
  let serieAtual = "";

  function setTabAtivo(val){
    tabBtns.forEach(b => b.classList.toggle("ativo", b.dataset.serie === val));
  }

  function renderGrafico(rows){
    if (!grafico) return;
    if (!rows || !rows.length){
      grafico.innerHTML = `<div class="grafico-empty">Sem dados para exibir.</div>`;
      return;
    }

    // escala: barra baseada no maior valor
    const max = Math.max(...rows.map(r => Number(r.media_nota ?? r.media ?? 0)), 0.01);
    const cores = [
      "#1E3A8A",
      "#0F766E",
      "#B45309",
      "#7C3AED",
      "#BE185D",
      "#15803D",
      "#B91C1C",
      "#0369A1",
    ];

    grafico.innerHTML = rows.map((r, idx) => {
      const pct = Math.max(0, Math.min(100, (Number(r.media_nota ?? r.media ?? 0) / max) * 100));
      const cor = cores[idx % cores.length];
      return `
        <div class="bar-row">
          <div class="bar-label">${escapeHtml(r.turma || "-")}</div>
          <div class="bar-track"><div class="bar-fill" style="width:${pct}%; background:${cor};"></div></div>
          <div class="bar-value">${escapeHtml(fmtNota(r.media_nota ?? r.media))}</div>
        </div>
      `;
    }).join("");
  }

  async function carregarComparativo(){
    if (!grafico) return;
    grafico.innerHTML = `<div class="grafico-empty">Carregando...</div>`;

    const unidade = String(selUnidade?.value || "").trim();
    const qs = new URLSearchParams({ ano: String(ano), serie: serieAtual });
    if (unidade) qs.set("unidade", unidade);

    try{
      const r = await api(`/api/admin/relatorios/comparativo-series?${qs.toString()}`);
      renderGrafico((r.rows || []).slice(0, 60)); // evita lista gigante
    }catch(e){
      grafico.innerHTML = `<div class="grafico-empty">${escapeHtml(e.message || "Erro ao carregar gráfico.")}</div>`;
    }
  }

  async function carregarRanking(){
    if (!tbodyRanking) return;
    tbodyRanking.innerHTML = `<tr><td colspan="4">Carregando...</td></tr>`;

    const unidade = String(selUnidade?.value || "").trim();
    const qs = new URLSearchParams({ ano: String(ano), serie: serieAtual });
    if (unidade) qs.set("unidade", unidade);

    try{
      const r = await api(`/api/admin/relatorios/ranking?${qs.toString()}`);
      const rows = r.rows || [];
      if (!rows.length){
        tbodyRanking.innerHTML = `<tr><td colspan="4">Sem dados.</td></tr>`;
        return;
      }
      tbodyRanking.innerHTML = rows.map(x => `
        <tr>
          <td>${escapeHtml(x.nome || "-")}</td>
          <td>${escapeHtml(x.turma || "-")}</td>
          <td>${escapeHtml(x.curso || "-")}</td>
          <td>${escapeHtml(fmtNota(x.media))}</td>
        </tr>
      `).join("");
    }catch(e){
      tbodyRanking.innerHTML = `<tr><td colspan="4">${escapeHtml(e.message || "Erro ao carregar ranking.")}</td></tr>`;
    }
  }

  // binds
  selUnidade?.addEventListener("change", async () => {
    await carregarTurmas();
  });
  selTurma?.addEventListener("change", async () => {
    await carregarSimulados();
  });
  selSimulado?.addEventListener("change", async () => {
    await carregarRelatorio();
  });
  selDiscUnidade?.addEventListener("change", async () => {
    await carregarTurmasRelatorioAlunos();
    await carregarDesempenhoDisciplinaAlunos();
  });
  selDiscTurma?.addEventListener("change", async () => {
    await carregarDesempenhoDisciplinaAlunos();
  });
  selDiscDisciplina?.addEventListener("change", async () => {
    await carregarDesempenhoDisciplinaAlunos();
  });

  if (btnDiscPdf) {
    btnDiscPdf.addEventListener("click", async () => {
      const unidade = String(selDiscUnidade?.value || "").trim();
      const turma = String(selDiscTurma?.value || "").trim();
      const disciplinaId = String(selDiscDisciplina?.value || "").trim();
      if (!unidade || !turma || !disciplinaId) {
        alert("Selecione Unidade, Turma e Disciplina para exportar.");
        return;
      }
      await carregarDesempenhoDisciplinaAlunos();
      document.body.classList.remove("print-relatorio");
      document.body.classList.add("print-disciplina");
      window.print();
      setTimeout(() => {
        document.body.classList.remove("print-disciplina");
      }, 300);
    });
  }

  if (tabBtns.length) {
    tabBtns.forEach(btn => {
      btn.addEventListener("click", async () => {
        serieAtual = btn.dataset.serie || "";
        setTabAtivo(serieAtual);
        await carregarComparativo();
        await carregarRanking();
      });
    });
  }

  if (btnPdf) {
    btnPdf.addEventListener("click", () => {
      const id = Number(selSimulado?.value || 0);
      if (!id) {
        alert("Selecione um simulado para exportar.");
        return;
      }
      document.body.classList.remove("print-disciplina");
      document.body.classList.add("print-relatorio");
      window.print();
      setTimeout(() => {
        document.body.classList.remove("print-relatorio");
      }, 300);
    });
  }

  // init
  setTabAtivo("");
  await carregarUnidades();
  if (grafico || tbodyRanking) {
    await carregarComparativo();
    await carregarRanking();
  }
  await carregarUnidadesRelatorioAlunos();
  await carregarDisciplinasRelatorioAlunos();
  await carregarTurmasRelatorioAlunos();
  await carregarDesempenhoDisciplinaAlunos();
}

  // ==============================
  // ALUNO — LISTA DE SIMULADOS
  // ==============================
async function initSimuladosAluno(){
    const s = await ensureSession({ redirect:true });
    if (!s) return;
    if (s.perfil !== "aluno") return window.location.href = "dashboard.html";

    renderHeader(s.perfil);

    const tbody = document.querySelector("#tabelaSimuladosAluno tbody");
    const tabelaSimuladosAluno = document.getElementById("tabelaSimuladosAluno");
    if (tabelaSimuladosAluno) tabelaSimuladosAluno.classList.add("table-mobile");
    const infoTurma = document.getElementById("infoTurmaAluno");
    if (!tbody) return;

    async function carregar(){
      tbody.innerHTML = `<tr><td colspan="9">Carregando...</td></tr>`;
      try{
        const data = await api("/api/aluno/simulados");
        const rows = data.rows || [];
        if (infoTurma) infoTurma.textContent = data.turma ? `Turma: ${data.turma}` : "Turma: -";

        if (!rows.length){
          tbody.innerHTML = `<tr><td colspan="9">Nenhum simulado disponível.</td></tr>`;
          return;
        }

        tbody.innerHTML = rows.map(r => {
          const status = r.status_simulado || "Agendado";
          const statusClass = status === "Em andamento"
            ? "status-pill status-pill-live"
            : (status === "Finalizado"
              ? "status-pill status-pill-done"
              : (status === "Bloqueado" ? "status-pill status-pill-blocked" : "status-pill status-pill-soon"));
          const podeIniciar = !!r.pode_iniciar || (r.acao === "continuar");
          const acaoLabel = status === "Bloqueado"
            ? "Bloqueado"
            : (r.acao === "continuar" ? "Continuar" : "Iniciar");
          const btnDisabled = podeIniciar ? "" : "disabled";
          const btnTitle = podeIniciar ? "" : (status === "Bloqueado" ? " title=\"Bloqueado\"" : " title=\"Fora do horario\"");
          const tentativaId = r.tentativa?.id || "";
          return `
            <tr>
              <td data-label="Simulado">${escapeHtml(r.titulo)}</td>
              <td data-label="Unidade">${escapeHtml(r.unidade)}</td>
              <td data-label="Início">${escapeHtml(fmtDataHoraBr(r.inicio_em))}</td>
              <td data-label="Fim">${escapeHtml(fmtDataHoraBr(r.fim_em))}</td>
              <td data-label="Duração">${escapeHtml(r.duracao_min || 90)} min</td>
              <td data-label="Questões">${escapeHtml(r.num_questoes)}</td>
              <td data-label="Nota">${escapeHtml(r.valor_total)}</td>
              <td data-label="Status"><span class="${statusClass}">${escapeHtml(status)}</span></td>
              <td>
                <button class="btn" data-simulado="${r.id}" data-tentativa="${tentativaId}" ${btnDisabled}${btnTitle}>${acaoLabel}</button>
              </td>
            </tr>
          `;
        }).join("");

        // binds
        tbody.querySelectorAll("button[data-simulado]").forEach(btn => {
          if (btn.disabled) return;
          btn.addEventListener("click", async () => {
            const simuladoId = btn.getAttribute("data-simulado");
            try{
              const r = await api(`/api/aluno/simulados/${simuladoId}/iniciar`, { method:"POST" });
              if (r.finalizado){
                alert("Este simulado já foi finalizado.");
                await carregar();
                return;
              }
              const tentativaId = r.tentativaId;
              window.location.href = `simulado-realizar.html?tentativa=${encodeURIComponent(tentativaId)}`;
            }catch(e){
              alert(e.message || "Não foi possível iniciar.");
              await carregar();
            }
          });
        });
      }catch(e){
        tbody.innerHTML = `<tr><td colspan="8">${escapeHtml(e.message || "Erro ao carregar")}</td></tr>`;
      }
    }

    await carregar();
  }

  // ==============================
  // ALUNO — REALIZAR SIMULADO
  // ==============================
  async function initSimuladoRealizar(){
    const s = await ensureSession({ redirect:true });
    if (!s) return;
    if (s.perfil !== "aluno") return window.location.href = "dashboard.html";
    renderHeader(s.perfil);

    const params = new URLSearchParams(window.location.search);
    const tentativaId = params.get("tentativa");
    if (!tentativaId) return window.location.href = "simulados-aluno.html";

    const elTitulo = document.getElementById("simTitulo");
    const elUnidade = document.getElementById("simUnidade");
    const elTempo = document.getElementById("simTempo");
    const elAvisos = document.getElementById("simAvisos");
    const elProg = document.getElementById("simProgresso");
    const elQuestao = document.getElementById("boxQuestao");
    const elStart = document.getElementById("startOverlay");
    const elNav = document.getElementById("nav-botoes");

    let total = 0;
    let atual = 1;
    let timerInt = null;
    let iniciou = false;
    let bloqueioAviso = false;
    let bloqueioAntiFuga = false;
    let avisoEncerrado = false;

    function fmtNotaLocal(n){
      const v = Number(n || 0);
      return v.toFixed(1).replace(".", ",");
    }

    function fmt2(n){ return String(n).padStart(2,"0"); }
    function setProgresso(){
      if (!elProg) return;
      elProg.textContent = `${fmt2(atual)}/${fmt2(total)}`;
    }

    async function registrarAviso(motivo){
      if (bloqueioAviso || bloqueioAntiFuga) return;
      bloqueioAviso = true;
      try{
        const r = await api(`/api/aluno/tentativas/${tentativaId}/aviso`, { method:"POST", body:{ motivo } });
        const avisos = r.avisos ?? r.tentativa?.avisos;
        if (elAvisos) elAvisos.textContent = `Avisos: ${avisos}/3`;

        if (r.encerrado){
          finalizarTela(r.tentativa || r.tentativa?.tentativa || r.tentativa);
          if (!avisoEncerrado) {
            avisoEncerrado = true;
            alert("Simulado encerrado por 3 avisos.");
          }
          return;
        }

        alert(`Atenção! Não saia do simulado. Aviso ${avisos}/3.`);
      }catch(e){
        // silencioso
      }finally{
        setTimeout(()=>{ bloqueioAviso = false; }, 800);
      }
    }

    function bindAntiFuga(){
      document.addEventListener("visibilitychange", () => {
        if (!iniciou) return;
        if (document.hidden) registrarAviso("troca_aba");
      });
      window.addEventListener("blur", () => {
        if (!iniciou) return;
        registrarAviso("perdeu_foco");
      });
      window.addEventListener("pagehide", () => {
        if (!iniciou) return;
        registrarAviso("saiu_pagina");
      });
      document.addEventListener("fullscreenchange", () => {
        if (!iniciou) return;
        if (!document.fullscreenElement) registrarAviso("saiu_tela_cheia");
      });
      window.addEventListener("beforeunload", (e) => {
        if (!iniciou) return;
        e.preventDefault();
        e.returnValue = "";
      });
    }

    function startTimer(terminaEm){
      if (!elTempo) return;
      const end = new Date(terminaEm.replace(" ","T"));
      if (Number.isNaN(end.getTime())) return;

      if (timerInt) clearInterval(timerInt);
      function tick(){
        const now = new Date();
        const diff = Math.floor((end - now) / 1000);
        if (diff <= 0){
          elTempo.textContent = "00:00";
          clearInterval(timerInt);
          timerInt = null;
          // força envio por tempo
          enviar("tempo");
          return;
        }
        const mm = Math.floor(diff / 60);
        const ss = diff % 60;
        elTempo.textContent = `${fmt2(mm)}:${fmt2(ss)}`;
      }

      tick();
      timerInt = setInterval(tick, 1000);
    }

    async function carregarInfo(){
      const r = await api(`/api/aluno/tentativas/${tentativaId}`);
      const t = r.tentativa;
      if (r.finalizado){
        finalizarTela(r.tentativa || r.tentativa?.tentativa || r.tentativa);
        return null;
      }
      total = t.total;
      if (elTitulo) elTitulo.textContent = t.titulo || "Simulado";
      if (elUnidade) elUnidade.textContent = t.unidade || "";
      if (elAvisos) elAvisos.textContent = `Avisos: ${t.avisos}/3`;
      setProgresso();
      return t;
    }

    function finalizarTela(tent){
      const sess = getSessao() || {};
      bloqueioAntiFuga = true;
      if (timerInt) {
        clearInterval(timerInt);
        timerInt = null;
      }
      // tent pode vir de diferentes formatos
      const acertos = tent?.acertos ?? tent?.tentativa?.acertos;
      const nota = tent?.nota ?? tent?.tentativa?.nota;
      const status = tent?.status ?? tent?.tentativa?.status;
      const box = document.getElementById("finalBox");
      if (box){
        box.style.display = "block";
        box.innerHTML = `
          <div class="sim-final-card">
            <div class="sim-final-head">
              <div class="sim-final-title">Resultado do Simulado</div>
              <div class="sim-final-sub">Simulado: <b>${escapeHtml(document.getElementById("simTitulo")?.textContent || "-")}</b></div>
              <div class="sim-final-sub">Aluno: <b>${escapeHtml(sess.nome || "-")}</b></div>
              <div class="sim-final-status">Status: <b>${escapeHtml(status || "-")}</b></div>
            </div>

            <div class="sim-final-metrics">
              <div class="sim-final-box">
                <div class="sim-final-label">Acertos</div>
                <div class="sim-final-value">${escapeHtml(acertos ?? 0)}/${escapeHtml(total)}</div>
              </div>
              <div class="sim-final-box sim-final-box--nota">
                <div class="sim-final-label">Nota Final</div>
                <div class="sim-final-value">${escapeHtml(fmtNotaLocal(nota ?? 0))}</div>
              </div>
            </div>

            <div class="sim-final-disc" id="simFinalDisc"></div>

            <div class="sim-final-actions">
              <a class="btn btn-secondary" href="simulados-aluno.html" style="text-decoration:none;">Voltar aos simulados</a>
              <a class="btn" href="dashboard.html" style="text-decoration:none;">Início</a>
            </div>
          </div>
        `;
      }
      if (elQuestao) elQuestao.style.display = "none";
      if (elNav) elNav.style.display = "none";
      document.getElementById("btnPrevQ")?.setAttribute("disabled","disabled");
      document.getElementById("btnNextQ")?.setAttribute("disabled","disabled");
      document.getElementById("btnEnviar")?.setAttribute("disabled","disabled");
      if (elStart) elStart.style.display = "none";
      carregarAcertosPorDisciplina();
    }

    async function carregarAcertosPorDisciplina(){
      const box = document.getElementById("simFinalDisc");
      if (!box) return;
      try{
        const r = await api(`/api/aluno/tentativas/${tentativaId}/disciplinas`);
        const rows = r.rows || [];
        if (!rows.length){
          box.innerHTML = "";
          return;
        }
        box.innerHTML = `
          <div class="sim-final-disc-title">Acertos por disciplina</div>
          <div class="sim-final-disc-list">
            ${rows.map(x => `
              <div class="sim-final-disc-item">
                <span class="sim-final-disc-name">${escapeHtml(x.disciplina || "-")}</span>
                <span class="sim-final-disc-value">${escapeHtml(x.acertos ?? 0)}/${escapeHtml(x.total ?? 0)}</span>
              </div>
            `).join("")}
          </div>
        `;
      }catch(e){
        box.innerHTML = "";
      }
    }

    async function carregarQuestao(n){
      const r = await api(`/api/aluno/tentativas/${tentativaId}/questoes/${n}`);
      if (r.finalizado){
        finalizarTela(r.tentativa);
        return;
      }

      total = r.progresso.total;
      atual = r.progresso.atual;
      setProgresso();
      const btnEnviar = document.getElementById("btnEnviar");
      const btnNext = document.getElementById("btnNextQ");
      if (btnEnviar) {
        btnEnviar.style.display = (atual === total) ? "inline-flex" : "none";
      }
      if (btnNext) {
        btnNext.style.display = (atual === total) ? "none" : "inline-flex";
      }

      const q = r.questao;
      const disc = q.disciplina_nome || q.materia || "";
      const discHtml = disc ? `<div class="q-meta">Disciplina: <b>${escapeHtml(disc)}</b></div>` : "";
      const img = q.imagem_url ? `<div class="q-img"><img src="${escapeHtml(q.imagem_url)}" alt="Imagem da questão" /></div>` : "";

      elQuestao.innerHTML = `
        ${discHtml}
        <div class="q-enunciado">${escapeHtml(q.enunciado)}</div>
        ${img}
        <div class="q-opcoes">
          ${renderOpcao(q, 'A', q.alternativa_a)}
          ${renderOpcao(q, 'B', q.alternativa_b)}
          ${renderOpcao(q, 'C', q.alternativa_c)}
          ${renderOpcao(q, 'D', q.alternativa_d)}
          ${q.alternativa_e ? renderOpcao(q, 'E', q.alternativa_e) : ''}
        </div>
      `;

      elQuestao.querySelectorAll("input[name='opt']").forEach(inp => {
        inp.addEventListener("change", async () => {
          const marcada = inp.value;
          try{
            await api(`/api/aluno/tentativas/${tentativaId}/responder`, {
              method:"POST",
              body:{ questao_id: q.id, marcada }
            });
          }catch(e){
            alert(e.message || "Erro ao salvar resposta");
          }
        });
      });
    }

    function renderOpcao(q, letra, texto){
      const checked = q.marcada === letra ? "checked" : "";
      return `
        <label class="q-opt">
          <input type="radio" name="opt" value="${letra}" ${checked} />
          <span><b>${letra})</b> ${escapeHtml(texto)}</span>
        </label>
      `;
    }

    async function enviar(motivo){
      if (!confirm("Deseja enviar o simulado agora?")) {
        if (motivo === "tempo") {
          // se acabou o tempo, envia sem confirmação
        } else {
          return;
        }
      }
      try{
        bloqueioAntiFuga = true;
        if (timerInt) {
          clearInterval(timerInt);
          timerInt = null;
        }
        const r = await api(`/api/aluno/tentativas/${tentativaId}/enviar`, { method:"POST" });
        finalizarTela(r.tentativa);
      }catch(e){
        alert(e.message || "Erro ao enviar");
      }
    }

    // Botões navegação
    document.getElementById("btnPrevQ")?.addEventListener("click", async () => {
      if (atual > 1) {
        atual -= 1;
        await carregarQuestao(atual);
      }
    });
    document.getElementById("btnNextQ")?.addEventListener("click", async () => {
      if (atual < total) {
        atual += 1;
        await carregarQuestao(atual);
      }
    });
    document.getElementById("btnEnviar")?.addEventListener("click", async () => {
      await enviar("manual");
    });

    // Overlay iniciar (tela cheia)
    document.getElementById("btnStart")?.addEventListener("click", async () => {
      try{
        if (document.documentElement.requestFullscreen) {
          await document.documentElement.requestFullscreen();
        }
      }catch(_){ /* navegador pode bloquear */ }
      iniciou = true;
      if (elStart) elStart.style.display = "none";
      if (elQuestao) elQuestao.style.display = "block";
      if (elNav) elNav.style.display = "flex";

      const info = await carregarInfo();
      if (!info) return;
      startTimer(info.termina_em);
      bindAntiFuga();
      document.getElementById("btnPrevQ")?.removeAttribute("disabled");
      document.getElementById("btnNextQ")?.removeAttribute("disabled");
      document.getElementById("btnEnviar")?.removeAttribute("disabled");
      await carregarQuestao(1);
    });

    // Carrega informações iniciais (sem iniciar)
    await carregarInfo();
    setProgresso();
    if (elNav) elNav.style.display = "none";
    document.getElementById("btnPrevQ")?.setAttribute("disabled","disabled");
    document.getElementById("btnNextQ")?.setAttribute("disabled","disabled");
    document.getElementById("btnEnviar")?.setAttribute("disabled","disabled");
  }
async function initQuestoes(){
  const s = await ensureSession({ redirect:true });
  if (!s) return;
  if (s.perfil !== "admin" && s.perfil !== "professor") return window.location.href="dashboard.html";

  renderHeader(s.perfil);

  const tbody = document.querySelector("#tabelaQuestoes tbody");
  if (!tbody) return;
function garantirModalQuestao(){
  if (document.getElementById("modalBackdropQuestao")) return;

  const backdrop = document.createElement("div");
  backdrop.className = "modal-backdrop";
  backdrop.id = "modalBackdropQuestao";
  backdrop.innerHTML = `
    <div class="modal" style="max-width:880px;">
      <div class="modal-header">
        <span id="tituloModalQuestao">Nova Questão</span>
        <button class="btn-sm" id="fecharModalQuestao" type="button">X</button>
      </div>

      <div class="modal-body">
        <div class="form-grid">
          <div class="field" style="grid-column:1/-1;">
            <label>Enunciado</label>
            <textarea id="qEnunciado" rows="4" placeholder="Digite o enunciado..."></textarea>
          </div>

          <div class="field" style="grid-column:1/-1;">
            <label>Disciplina</label>
            <select id="qDisciplinaModal">
              <option value="">Carregando...</option>
            </select>
          </div>

          <div class="field">
            <label>Série</label>
            <select id="qSerieModal">
              <option value="">Carregando...</option>
            </select>
          </div>

          <div class="field">
            <label>Unidade</label>
            <select id="qUnidadeModal">
              <option value="">Carregando...</option>
            </select>
          </div>

          <div class="field">
            <label>Alternativa A</label>
            <input id="qA" />
          </div>
          <div class="field">
            <label>Alternativa B</label>
            <input id="qB" />
          </div>
          <div class="field">
            <label>Alternativa C</label>
            <input id="qC" />
          </div>
          <div class="field">
            <label>Alternativa D</label>
            <input id="qD" />
          </div>
          <div class="field">
            <label>Alternativa E (opcional)</label>
            <input id="qE" />
          </div>

          <div class="field">
            <label>Correta</label>
            <select id="qCorreta">
              <option value="A">A</option>
              <option value="B">B</option>
              <option value="C">C</option>
              <option value="D">D</option>
              <option value="E">E</option>
            </select>
          </div>

          <div class="field">
            <label>Ano</label>
            <input id="qAno" readonly />
          </div>
        </div>

        <div class="modal-actions">
          <button class="btn btn-secondary" id="cancelarModalQuestao" type="button">Cancelar</button>
          <button class="btn" id="salvarModalQuestao" type="button">Salvar</button>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(backdrop);

  document.getElementById("fecharModalQuestao").onclick = fecharModalQuestao;
  document.getElementById("cancelarModalQuestao").onclick = fecharModalQuestao;
  document.getElementById("salvarModalQuestao").onclick = salvarQuestaoModal;
  carregarDisciplinasModal();
  carregarSeriesModal();
  carregarUnidadesModal();
}

function abrirModalQuestao(titulo){
  garantirModalQuestao();
  document.getElementById("tituloModalQuestao").innerText = titulo;
  document.getElementById("modalBackdropQuestao").style.display = "flex";
}

function fecharModalQuestao(){
  const bd = document.getElementById("modalBackdropQuestao");
  if (bd) bd.style.display = "none";
}
let editQuestaoId = null;

async function carregarDisciplinasModal(){
  const sel = document.getElementById("qDisciplinaModal");
  if (!sel) return;
  sel.innerHTML = `<option value="">Carregando...</option>`;
  try{
    const r = await api("/api/disciplinas");
    const list = (r && Array.isArray(r.disciplinas)) ? r.disciplinas : [];
    if (!list.length){
      sel.innerHTML = `<option value="">Nenhuma cadastrada</option>`;
      return;
    }
    sel.innerHTML = `<option value="">Selecione...</option>` +
      list.map(d => `<option value="${d.id}">${escapeHtml(d.nome)}</option>`).join("");
  }catch(e){
    sel.innerHTML = `<option value="">Erro ao carregar</option>`;
  }
}

async function carregarSeriesModal(){
  const sel = document.getElementById("qSerieModal");
  if (!sel) return;
  sel.innerHTML = `<option value="">Carregando...</option>`;
  try{
    const r = await api("/api/admin/turmas-ano-atual");
    const turmas = r.turmas || [];
    if (!turmas.length){
      sel.innerHTML = `<option value="">Nenhuma turma</option>`;
      return;
    }
    sel.innerHTML = `<option value="">Selecione...</option>` +
      turmas.map(t => `<option value="${escapeHtml(t)}">${escapeHtml(t)}</option>`).join("");
  }catch(e){
    sel.innerHTML = `<option value="">Erro ao carregar</option>`;
  }
}

async function carregarUnidadesModal(){
  const sel = document.getElementById("qUnidadeModal");
  if (!sel) return;
  sel.innerHTML = `<option value="">Carregando...</option>`;
  try{
    const ano = Number(document.getElementById("qAno")?.value || anoAtual());
    const r = await api(`/api/admin/relatorios/unidades?ano=${encodeURIComponent(ano)}`);
    const unidades = r.unidades || [];
    if (!unidades.length){
      sel.innerHTML = `<option value="">Nenhuma unidade</option>`;
      return;
    }
    sel.innerHTML = `<option value="">Selecione...</option>` +
      unidades.map(u => `<option value="${escapeHtml(u)}">${escapeHtml(u)}</option>`).join("");
  }catch(e){
    sel.innerHTML = `<option value="">Erro ao carregar</option>`;
  }
}

function preencherQuestaoForm(q){
  document.getElementById("qAno").value = String(q.ano || anoAtual());
  document.getElementById("qEnunciado").value = q.enunciado || "";
  const selDisc = document.getElementById("qDisciplinaModal");
  if (selDisc) selDisc.value = q.disciplina_id ? String(q.disciplina_id) : "";
  const elSerie = document.getElementById("qSerieModal");
  if (elSerie) elSerie.value = q.serie || "";
  const elUnidade = document.getElementById("qUnidadeModal");
  if (elUnidade) elUnidade.value = q.unidade || "";
  document.getElementById("qA").value = q.alternativa_a || "";
  document.getElementById("qB").value = q.alternativa_b || "";
  document.getElementById("qC").value = q.alternativa_c || "";
  document.getElementById("qD").value = q.alternativa_d || "";
  document.getElementById("qE").value = q.alternativa_e || "";
  document.getElementById("qCorreta").value = (q.correta || "A").toUpperCase();
}

async function salvarQuestaoModal(){
  const ano = Number(document.getElementById("qAno").value || anoAtual());
  const enunciado = document.getElementById("qEnunciado").value.trim();
  const disciplina_id = String(document.getElementById("qDisciplinaModal")?.value || "").trim();
  const serie = String(document.getElementById("qSerieModal")?.value || "").trim();
  const unidade = String(document.getElementById("qUnidadeModal")?.value || "").trim();

  const alternativa_a = document.getElementById("qA").value.trim();
  const alternativa_b = document.getElementById("qB").value.trim();
  const alternativa_c = document.getElementById("qC").value.trim();
  const alternativa_d = document.getElementById("qD").value.trim();
  const alternativa_e = document.getElementById("qE").value.trim();
  const correta = document.getElementById("qCorreta").value;

  if (!enunciado || !alternativa_a || !alternativa_b || !alternativa_c || !alternativa_d) {
    alert("Preencha enunciado e alternativas A-D.");
    return;
  }

  const payload = {
    ano,
    enunciado,
    alternativa_a, alternativa_b, alternativa_c, alternativa_d,
    alternativa_e: alternativa_e || null,
    correta,
    disciplina_id: disciplina_id || null,
    materia: null,
    tags: null,
    serie: serie || null,
    unidade: unidade || null
  };

  try{
    if (!editQuestaoId) {
      await api("/api/questoes", { method:"POST", body: payload });
    } else {
      await api(`/api/questoes/${editQuestaoId}`, { method:"PUT", body: payload });
    }
    fecharModalQuestao();
    page = 1;
    await carregar();
  } catch(e){
    alert(e.message || "Erro ao salvar questão.");
  }
}

  const fAnoQuestoes = document.getElementById("fAnoQuestoes");
  let page = 1;
  let limit = Number(document.getElementById("selectPorPaginaQ")?.value || 20);
  let lastTotalQ = 0;
  let search = "";
  const ano = anoAtual();

  async function carregar(){
    const anoFiltro = String(fAnoQuestoes?.value || "").trim();
    const allAnos = anoFiltro ? "0" : "1";
    const anoParam = anoFiltro || String(ano);
    const r = await api(`/api/questoes?ano=${encodeURIComponent(anoParam)}&all_anos=${allAnos}&search=${encodeURIComponent(search)}&page=${page}&limit=${limit}`);
    lastTotalQ = Number(r.total || 0);
    document.getElementById("infoTotalQuestoes").innerText = `Total: ${lastTotalQ}`;
    renderTabela(r.rows || []);
    atualizarPaginacao(r.total);
  }

  function renderTabela(rows){
    tbody.innerHTML = "";
    rows.forEach(q=>{
      const tr = document.createElement("tr");
      const tabelaQ = document.getElementById("tabelaQuestoes");
      if (tabelaQ) tabelaQ.classList.add("table-mobile");
      tr.innerHTML = `
        <td data-label="Enunciado">${(q.enunciado||"").slice(0,80)}${(q.enunciado||"").length>80?"...":""}</td>
        <td data-label="Correta">${q.correta}</td>
        <td data-label="Matéria">${q.disciplina_nome || q.materia || ""}</td>
        <td data-label="Cadastrada por">${escapeHtml(q.professor_nome || q.criada_por_matricula || "-")}</td>
        <td>
          <button class="btn-sm" onclick="editarQuestao(${q.id})">Editar</button>
          <button class="btn-sm" onclick="excluirQuestao(${q.id})">Excluir</button>
        </td>
      `;
      tbody.appendChild(tr);
    });
  }

  function atualizarPaginacao(total){
    const totalPaginas = Math.max(1, Math.ceil(total/limit));
    document.getElementById("infoPaginaQ").innerText = `Página ${page} de ${totalPaginas}`;
    document.getElementById("btnPrevQ").disabled = page<=1;
    document.getElementById("btnPrimeiraQ").disabled = page<=1;
    document.getElementById("btnNextQ").disabled = page>=totalPaginas;
    document.getElementById("btnUltimaQ").disabled = page>=totalPaginas;
  }

  // busca
  let tmr=null;
  document.getElementById("buscaQuestao")?.addEventListener("input", (e)=>{
    clearTimeout(tmr);
    tmr=setTimeout(()=>{
      search = e.target.value || "";
      page = 1;
      carregar();
    },200);
  });

  async function carregarAnosFiltroQuestoes(){
    if (!fAnoQuestoes) return;
    fAnoQuestoes.innerHTML = `<option value="">Todos os anos</option>`;
    try{
      const r = await api("/api/anos");
      const anos = (r.anos || []).map(Number).filter(n => Number.isFinite(n)).sort((a,b)=>b-a);
      fAnoQuestoes.innerHTML = `<option value="">Todos os anos</option>` +
        anos.map(a => `<option value="${a}">${a}</option>`).join("");
    }catch(_){
      fAnoQuestoes.innerHTML = `<option value="">Todos os anos</option>`;
    }
  }

  fAnoQuestoes?.addEventListener("change", () => {
    page = 1;
    carregar();
  });

  // paginação
  document.getElementById("selectPorPaginaQ")?.addEventListener("change",(e)=>{
    limit = Number(e.target.value||20);
    page=1;
    carregar();
  });
  document.getElementById("btnPrimeiraQ")?.addEventListener("click",()=>{ page=1; carregar(); });
  document.getElementById("btnPrevQ")?.addEventListener("click",()=>{ page--; carregar(); });
  document.getElementById("btnNextQ")?.addEventListener("click",()=>{ page++; carregar(); });
  document.getElementById("btnUltimaQ")?.addEventListener("click",()=>{
    const totalPaginas = Math.max(1, Math.ceil(lastTotalQ / limit));
    page = totalPaginas;
    carregar();
  });

  // placeholders (na próxima mensagem eu te mando o modal completo)
  window.editarQuestao = async (id) => {
  try{
    const r = await api(`/api/questoes/${id}`);
    editQuestaoId = id;
    abrirModalQuestao("Editar Questão"); // cria o modal primeiro
preencherQuestaoForm(r.questao);
  } catch(e){
    alert(e.message || "Erro ao abrir questão.");
  }
};
  window.excluirQuestao = async (id)=> {
    if(!confirm("Excluir questão?")) return;
    await api(`/api/questoes/${id}`, { method:"DELETE" });
    carregar();
  };

  document.getElementById("btnNovaQuestao")?.addEventListener("click", ()=>{
  editQuestaoId = null;
  abrirModalQuestao("Nova Questão"); // cria o modal primeiro
  preencherQuestaoForm({ ano: anoAtual(), correta: "A" });
});

  await carregarAnosFiltroQuestoes();
  await carregarAnosFiltroQuestoes();
  await carregar();
}

// ==============================
// LIBERACOES (ADMIN / PROFESSOR)
// ==============================
async function initLiberacoes(){
  const s = await ensureSession({ redirect:true });
  if (!s) return;
  if (s.perfil !== "admin" && s.perfil !== "professor") {
    return window.location.href = "dashboard.html";
  }

  renderHeader(s.perfil);

  const tbody = document.querySelector("#tabelaLiberacoes tbody");
  if (!tbody) return;

  function motivoLabel(m){
    if (m === "avisos") return "Avisos";
    if (m === "tempo") return "Tempo";
    return m || "-";
  }

  async function carregar(){
    tbody.innerHTML = `<tr><td colspan="7">Carregando...</td></tr>`;
    try{
      const r = await api("/api/admin/liberacoes");
      const rows = r.rows || [];
      if (!rows.length){
        tbody.innerHTML = `<tr><td colspan="7">Nenhuma liberacao pendente.</td></tr>`;
        return;
      }

      tbody.innerHTML = rows.map(x => `
        <tr>
          <td data-label="Aluno">${escapeHtml(x.aluno_nome || "-")}</td>
          <td data-label="Matricula">${escapeHtml(x.aluno_matricula || "-")}</td>
          <td data-label="Simulado">${escapeHtml(x.titulo || "-")}</td>
          <td data-label="Turma">${escapeHtml(x.turma || "-")}</td>
          <td data-label="Motivo">${escapeHtml(motivoLabel(x.bloqueado_motivo))}</td>
          <td data-label="Bloqueado em">${escapeHtml(fmtDataHoraBr(x.bloqueado_em))}</td>
          <td data-label="Acoes">
            <button class="btn-sm" data-id="${x.id}">Liberar</button>
          </td>
        </tr>
      `).join("");

      tbody.querySelectorAll("button[data-id]").forEach(btn => {
        btn.addEventListener("click", async () => {
          const id = btn.getAttribute("data-id");
          if (!id) return;
          if (!confirm("Liberar este aluno para refazer o simulado?")) return;
          try{
            await api(`/api/admin/liberacoes/${id}/liberar`, { method:"POST" });
            await carregar();
          }catch(e){
            alert(e.message || "Erro ao liberar.");
          }
        });
      });
    }catch(e){
      tbody.innerHTML = `<tr><td colspan="7">${escapeHtml(e.message || "Erro ao carregar")}</td></tr>`;
    }
  }

  await carregar();
}

// ==============================
// GRAFICOS (ADMIN / PROFESSOR)
// ==============================
async function initGraficos(){
  const s = await ensureSession({ redirect:true });
  if (!s) return;
  if (s.perfil !== "admin" && s.perfil !== "professor") {
    return window.location.href = "dashboard.html";
  }

  renderHeader(s.perfil);

  const grafico = document.getElementById("graficoSerie");
  const tabBtns = Array.from(document.querySelectorAll(".tab-btn"));
  const tbodyRanking = document.getElementById("tbodyRanking");
  const selUnidade = document.getElementById("fGrafUnidade");
  const pieCanvas = document.getElementById("graficoPizza");
  const pieLegenda = document.getElementById("graficoPizzaLegenda");
    const pieEmpty = document.getElementById("graficoPizzaEmpty");
    const pieTotal = document.getElementById("graficoPizzaTotal");
  const ano = anoAtual();
  let serieAtual = "";

  function setTabAtivo(val){
    tabBtns.forEach(b => b.classList.toggle("ativo", b.dataset.serie === val));
  }

  function fmtNota(n){
    const v = Number(n || 0);
    return v.toFixed(1).replace(".", ",");
  }

  function renderGrafico(rows){
    if (!grafico) return;
    if (!rows || !rows.length){
      grafico.innerHTML = `<div class="grafico-empty">Sem dados para exibir.</div>`;
      return;
    }

    const max = Math.max(...rows.map(r => Number(r.media_nota ?? r.media ?? 0)), 0.01);
    const cores = [
      "#1E3A8A",
      "#0F766E",
      "#B45309",
      "#7C3AED",
      "#BE185D",
      "#15803D",
      "#B91C1C",
      "#0369A1",
    ];

    grafico.innerHTML = rows.map((r, idx) => {
      const pct = Math.max(0, Math.min(100, (Number(r.media_nota ?? r.media ?? 0) / max) * 100));
      const cor = cores[idx % cores.length];
      return `
        <div class="bar-row">
          <div class="bar-label">${escapeHtml(r.turma || "-")}</div>
          <div class="bar-track"><div class="bar-fill" style="width:${pct}%; background:${cor};"></div></div>
          <div class="bar-value">${escapeHtml(fmtNota(r.media_nota ?? r.media))}</div>
        </div>
      `;
    }).join("");
  }

    function renderPizza(rows){
      if (!pieCanvas || !pieLegenda || !pieEmpty) return;
      const ctx = pieCanvas.getContext("2d");
      if (!ctx) return;

      const totalAcertos = rows.reduce((s, r) => s + Number(r.acertos || 0), 0);
      const totalQuestoes = rows.reduce((s, r) => s + Number(r.total || 0), 0);
      if (!rows.length || totalAcertos <= 0) {
        ctx.clearRect(0, 0, pieCanvas.width, pieCanvas.height);
        pieEmpty.textContent = "Sem dados para exibir.";
        pieEmpty.style.display = "block";
        pieLegenda.innerHTML = "";
        if (pieTotal) {
          pieTotal.textContent = "";
          pieTotal.style.display = "none";
        }
        return;
      }

      pieEmpty.style.display = "none";
      ctx.clearRect(0, 0, pieCanvas.width, pieCanvas.height);

    const cores = [
      "#1E3A8A",
      "#0F766E",
      "#B45309",
      "#7C3AED",
      "#BE185D",
      "#15803D",
      "#B91C1C",
      "#0369A1",
    ];

    const cx = pieCanvas.width / 2;
    const cy = pieCanvas.height / 2;
    const r = Math.min(cx, cy) - 4;
    let start = -Math.PI / 2;

    rows.forEach((item, idx) => {
      const val = Number(item.acertos || 0);
      if (val <= 0) return;
      const slice = (val / totalAcertos) * Math.PI * 2;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.arc(cx, cy, r, start, start + slice);
      ctx.closePath();
      ctx.fillStyle = cores[idx % cores.length];
      ctx.fill();
      start += slice;
    });

      if (pieTotal) {
        const pctTotal = totalQuestoes > 0 ? (totalAcertos / totalQuestoes) * 100 : 0;
        pieTotal.style.display = "flex";
        pieTotal.innerHTML = `
          <div class="pie-total-label">Acertos totais</div>
          <div class="pie-total-value">${escapeHtml(String(totalAcertos))}/${escapeHtml(String(totalQuestoes))}</div>
          <div class="pie-total-sub">${pctTotal.toFixed(1)}%</div>
        `;
      }

      pieLegenda.innerHTML = rows.map((item, idx) => {
        const val = Number(item.acertos || 0);
        const total = Number(item.total || 0);
        const pct = total > 0 ? ((val / total) * 100) : 0;
        const cor = cores[idx % cores.length];
        return `
          <div class="pie-legend-item">
            <div class="pie-legend-head">
              <span class="pie-dot" style="background:${cor};"></span>
              <span class="pie-name">${escapeHtml(item.disciplina || "-")}</span>
              <span class="pie-value">${pct.toFixed(1)}%</span>
            </div>
            <div class="pie-legend-bar">
              <span style="width:${pct.toFixed(1)}%; background:${cor};"></span>
            </div>
            <div class="pie-legend-foot">${pct.toFixed(1)}% de acertos</div>
          </div>
        `;
      }).join("");
  }

  async function carregarComparativo(){
    if (!grafico) return;
    grafico.innerHTML = `<div class="grafico-empty">Carregando...</div>`;

    const unidade = String(selUnidade?.value || "").trim();
    const qs = new URLSearchParams({ ano: String(ano), serie: serieAtual });
    if (unidade) qs.set("unidade", unidade);

    try{
      const r = await api(`/api/admin/relatorios/comparativo-series?${qs.toString()}`);
      renderGrafico((r.rows || []).slice(0, 60));
    }catch(e){
      grafico.innerHTML = `<div class="grafico-empty">${escapeHtml(e.message || "Erro ao carregar gráfico.")}</div>`;
    }
  }

  async function carregarRanking(){
    if (!tbodyRanking) return;
    tbodyRanking.innerHTML = `<tr><td colspan="4">Carregando...</td></tr>`;

    const unidade = String(selUnidade?.value || "").trim();
    const qs = new URLSearchParams({ ano: String(ano), serie: serieAtual });
    if (unidade) qs.set("unidade", unidade);

    try{
      const r = await api(`/api/admin/relatorios/ranking?${qs.toString()}`);
      const rows = r.rows || [];
      if (!rows.length){
        tbodyRanking.innerHTML = `<tr><td colspan="4">Sem dados.</td></tr>`;
        return;
      }
      tbodyRanking.innerHTML = rows.map(x => `
        <tr>
          <td>${escapeHtml(x.nome || "-")}</td>
          <td>${escapeHtml(x.turma || "-")}</td>
          <td>${escapeHtml(x.curso || "-")}</td>
          <td>${escapeHtml(fmtNota(x.media))}</td>
        </tr>
      `).join("");
    }catch(e){
      tbodyRanking.innerHTML = `<tr><td colspan="4">${escapeHtml(e.message || "Erro ao carregar ranking.")}</td></tr>`;
    }
  }

  async function carregarPizza(){
    if (!pieCanvas || !pieLegenda || !pieEmpty) return;
    pieEmpty.textContent = "Carregando...";
    pieEmpty.style.display = "block";
    pieLegenda.innerHTML = "";

    const unidade = String(selUnidade?.value || "").trim();
    const qs = new URLSearchParams({ ano: String(ano), serie: serieAtual });
    if (unidade) qs.set("unidade", unidade);

    try{
      const r = await api(`/api/admin/relatorios/desempenho-disciplinas?${qs.toString()}`);
      renderPizza(r.rows || []);
    }catch(e){
      if (pieEmpty) {
        pieEmpty.textContent = e.message || "Erro ao carregar grafico.";
        pieEmpty.style.display = "block";
      }
    }
  }

  async function carregarUnidades(){
    if (!selUnidade) return;
    selUnidade.innerHTML = `<option value="">Carregando...</option>`;
    try{
      const r = await api(`/api/admin/relatorios/unidades?ano=${encodeURIComponent(ano)}`);
      const unidades = r.unidades || [];
      selUnidade.innerHTML = `<option value="">Todas</option>` +
        unidades.map(u => `<option value="${escapeHtml(u)}">${escapeHtml(u)}</option>`).join("");
    }catch(e){
      selUnidade.innerHTML = `<option value="">Erro ao carregar</option>`;
    }
  }

  selUnidade?.addEventListener("change", async () => {
    await carregarComparativo();
    await carregarRanking();
    await carregarPizza();
  });

  if (tabBtns.length) {
    tabBtns.forEach(btn => {
      btn.addEventListener("click", async () => {
        serieAtual = btn.dataset.serie || "";
        setTabAtivo(serieAtual);
        await carregarComparativo();
        await carregarRanking();
        await carregarPizza();
      });
    });
  }

  setTabAtivo("");
  await carregarUnidades();
  await carregarComparativo();
  await carregarRanking();
  await carregarPizza();
}
async function initSimulados(){
  const s = await ensureSession({ redirect:true });
  if (!s) return;

  if (s.perfil !== "admin" && s.perfil !== "professor") {
    window.location.href = "dashboard.html";
    return;
  }

  renderHeader(s.perfil);

  const tbody = document.querySelector("#tabelaSimulados tbody");
  if (!tbody) return;

  // cache da lista (pra editar sem rota GET por id)
  let simuladosCache = [];

  // ---------- Replicar (modal) ----------
  function ensureModalReplicar(){
    if (document.getElementById("modalBackdropReplicar")) return;

    const backdrop = document.createElement("div");
    backdrop.id = "modalBackdropReplicar";
    backdrop.className = "modal-backdrop";
    backdrop.innerHTML = `
      <div class="modal" role="dialog" aria-modal="true">
        <div class="modal-header">
          <span>REPLICAR SIMULADO</span>
          <button class="btn-sm" id="btnFecharReplicar" style="padding:6px 10px;border-radius:10px;border:0;background:#ffffff;color:#1E3A8A;font-weight:900;cursor:pointer;">X</button>
        </div>
        <div class="modal-body">
          <div id="replicarErro" style="display:none; padding:10px; border-radius:10px; background:#FEE2E2; border:1px solid #FCA5A5; color:#991B1B; font-weight:800; margin-bottom:12px;"></div>

          <div style="padding:10px; border-radius:10px; background:#EEF2FF; border:1px solid #D6E0FF; margin-bottom:12px;">
            <div><b>Simulado:</b> <span id="replicarTitulo"></span></div>
            <div><b>Turma atual:</b> <span id="replicarTurmaAtual"></span></div>
          </div>

          <div class="field">
            <label for="replicarTurma">Selecione a nova turma</label>
            <select id="replicarTurma" style="width:100%; padding:10px; border-radius:10px; border:1px solid #D6E0FF;"></select>
            <small style="display:block; margin-top:6px; opacity:.85;">
              As turmas são buscadas automaticamente do cadastro de alunos (ano atual).
            </small>
          </div>

          <div style="display:flex; gap:10px; justify-content:flex-end; margin-top:16px;">
            <button class="btn-sm" id="btnCancelarReplicar">Cancelar</button>
            <button class="btn-sm" id="btnConfirmarReplicar" style="background:#1E3A8A;color:#fff;border:1px solid #1E3A8A;">Replicar</button>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(backdrop);

    function fechar(){
      backdrop.style.display = "none";
    }
    backdrop.addEventListener("click", (e) => {
      if (e.target === backdrop) fechar();
    });
    backdrop.querySelector("#btnFecharReplicar").addEventListener("click", fechar);
    backdrop.querySelector("#btnCancelarReplicar").addEventListener("click", fechar);
  }

  async function abrirModalReplicar(simuladoId){
    ensureModalReplicar();

    const backdrop = document.getElementById("modalBackdropReplicar");
    const elErro = document.getElementById("replicarErro");
    const elTitulo = document.getElementById("replicarTitulo");
    const elTurmaAtual = document.getElementById("replicarTurmaAtual");
    const selTurma = document.getElementById("replicarTurma");
    const btnOk = document.getElementById("btnConfirmarReplicar");

    // reset UI
    elErro.style.display = "none";
    elErro.textContent = "";
    selTurma.innerHTML = `<option value="">Carregando...</option>`;
    btnOk.disabled = true;

    const sm = simuladosCache.find(x => Number(x.id) === Number(simuladoId));
    elTitulo.textContent = sm ? sm.titulo : `#${simuladoId}`;
    elTurmaAtual.textContent = sm ? (sm.turma || "-") : "-";

    backdrop.style.display = "flex";

    try{
      const r = await api("/api/admin/turmas-ano-atual");
      const turmas = (r.turmas || []).map(t => String(t).trim()).filter(Boolean);

      const atual = sm ? String(sm.turma || "").trim() : "";
      const options = turmas
        .filter(t => t !== atual)
        .map(t => `<option value="${escapeHtml(t)}">${escapeHtml(t)}</option>`)
        .join("");

      selTurma.innerHTML = `<option value="">Selecione...</option>` + (options || "");
      btnOk.disabled = false;

    }catch(e){
      elErro.style.display = "block";
      elErro.textContent = e.message || "Erro ao carregar turmas.";
      selTurma.innerHTML = `<option value="">Erro ao carregar</option>`;
      btnOk.disabled = true;
      return;
    }

    btnOk.onclick = async () => {
      const novaTurma = String(selTurma.value || "").trim();
      if (!novaTurma){
        elErro.style.display = "block";
        elErro.textContent = "Selecione a nova turma.";
        return;
      }

      elErro.style.display = "none";
      elErro.textContent = "";
      btnOk.disabled = true;

      try{
        await api(`/api/admin/simulados/${simuladoId}/replicar`, {
          method: "POST",
          body: { turma: novaTurma }
        });

        backdrop.style.display = "none";
        page = 1;
        await carregar();
      }catch(e){
        elErro.style.display = "block";
        elErro.textContent = e.message || "Erro ao replicar simulado.";
        btnOk.disabled = false;
      }
    };
  }

  // expõe implementação real para o handler global do botão
  window.__replicarSimuladoImpl = (id) => abrirModalReplicar(id);


  // paginação/busca no front (server atual não pagina)
  let page = 1;
  let limit = Number(document.getElementById("selectPorPaginaS")?.value || 5);
  let search = "";
  let lastTotalS = 0;

  // ---------- utils ----------
  function isoParaInputs(dt){
    if (!dt) return { d:"", t:"" };
    const ss = String(dt).replace("T"," ");
    const [datePart, timePart] = ss.split(" ");
    return { d: datePart || "", t: (timePart || "").slice(0,5) };
  }

  // ---------- modal ----------
  async function carregarTurmasNoModal(){
    const r = await api("/api/admin/turmas-ano-atual");
    const sel = document.getElementById("sTurma");
    if (!sel) return;
    if (sel.tagName !== "SELECT") return;

    const atual = sel.value;

    sel.innerHTML = "";
    const op0 = document.createElement("option");
    op0.value = "";
    op0.textContent = "Selecione...";
    sel.appendChild(op0);

    (r.turmas || []).forEach(t => {
      const op = document.createElement("option");
      op.value = t;
      op.textContent = t;
      sel.appendChild(op);
    });

    // tenta manter seleção
    if (atual) sel.value = atual;
  }

  // ✅ função global (de verdade) para fechar modal
  window.fecharModalSimulado = function(){
    const bd = document.getElementById("modalBackdropSimulado");
    if (bd) bd.style.display = "none";
  };

  function garantirModalSimulado(){
    if (document.getElementById("modalBackdropSimulado")) return;

    const bd = document.createElement("div");
    bd.className = "modal-backdrop";
    bd.id = "modalBackdropSimulado";
    bd.innerHTML = `
      <div class="modal" style="max-width:900px;">
        <div class="modal-header">
          <span id="tituloModalSimulado">Novo Simulado</span>
          <button class="btn-sm" id="fecharModalSimuladoBtn" type="button">X</button>
        </div>

        <div class="modal-body">
          <div class="form-grid">
            <div class="field" style="grid-column:1/-1;">
              <label>Título</label>
              <input id="sTitulo" placeholder="Ex: Simulado 1 - Redes" />
            </div>

            <div class="field">
              <label>Unidade</label>
              <select id="sUnidade">
                <option value="I UNIDADE">I UNIDADE</option>
                <option value="II UNIDADE">II UNIDADE</option>
                <option value="III UNIDADE">III UNIDADE</option>
                <option value="RECUPERAÇÃO">RECUPERAÇÃO</option>
              </select>
            </div>

            <div class="field">
              <label>Curso</label>
              <select id="sCurso">
                <option value="">Selecione...</option>
                <option value="AGRONEGOCIO">AGRONEGOCIO</option>
                <option value="AGROPECURA">AGROPECURA</option>
                <option value="AGROECOLOGIA">AGROECOLOGIA</option>
                <option value="ADMINISTRAÇÃO">ADMINISTRAÇÃO</option>
                <option value="INFORMATICA">INFORMATICA</option>
                <option value="MARLKENTIG">MARLKENTIG</option>
                <option value="REDES DE COMPUTADORES">REDES DE COMPUTADORES</option>
              </select>
            </div>

            <div class="field">
              <label>Turma (Série do ano)</label>
              <select id="sTurma"></select>
            </div>

            <div class="field">
              <label>Data de aplicação</label>
              <input id="sDataIni" type="date" />
            </div>

            <div class="field">
              <label>Hora de aplicação</label>
              <input id="sHoraIni" type="time" />
            </div>

            <div class="field">
              <label>Duração (minutos)</label>
              <input id="sDuracao" type="number" min="10" step="5" value="90" />
            </div>

            <div class="field">
              <label>Nº questões</label>
              <input id="sNum" type="number" min="1" />
            </div>

            <div class="field">
              <label>Nota total</label>
              <input id="sValor" type="number" min="0.1" step="0.1" />
            </div>

            <div class="field" style="grid-column:1/-1;">
              <small id="sInfoCalc" style="opacity:.9;"></small>
            </div>
          </div>

          <div class="modal-actions">
            <button class="btn btn-secondary" id="cancelarModalSimulado" type="button">Cancelar</button>
            <button class="btn" id="salvarModalSimulado" type="button">Salvar</button>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(bd);

    document.getElementById("fecharModalSimuladoBtn").onclick = window.fecharModalSimulado;
    document.getElementById("cancelarModalSimulado").onclick = window.fecharModalSimulado;
    document.getElementById("salvarModalSimulado").onclick = salvarSimuladoModal;

    // cálculo automático: nota / questões
    const atualizarCalc = () => {
      const n = Number(document.getElementById("sNum").value || 0);
      const v = Number(document.getElementById("sValor").value || 0);
      const info = document.getElementById("sInfoCalc");
      if (!info) return;
      if (n > 0 && v > 0) {
        const porQ = v / n;
        info.innerText = `Cada questão vale: ${porQ.toFixed(2)} ponto(s). (${v} / ${n})`;
      } else {
        info.innerText = "";
      }
    };

    document.getElementById("sNum").addEventListener("input", atualizarCalc);
    document.getElementById("sValor").addEventListener("input", atualizarCalc);
  }

  async function abrirModalSimulado(titulo){
    garantirModalSimulado();
    document.getElementById("tituloModalSimulado").innerText = titulo;
    document.getElementById("modalBackdropSimulado").style.display = "flex";
    await carregarTurmasNoModal();
  }

  let editSimuladoId = null;

  function preencherSimuladoForm(sx){
    document.getElementById("sTitulo").value = sx.titulo || "";
    document.getElementById("sUnidade").value = sx.unidade || "I UNIDADE";
    document.getElementById("sCurso").value = sx.curso || "";
    document.getElementById("sTurma").value = sx.turma || "";

    const ini = isoParaInputs(sx.inicio_em);
    document.getElementById("sDataIni").value = ini.d || "";
    document.getElementById("sHoraIni").value = ini.t || "";

    document.getElementById("sDuracao").value = String(sx.duracao_min || 90);

    document.getElementById("sNum").value =
      (sx.num_questoes !== undefined && sx.num_questoes !== null) ? String(sx.num_questoes) : "";

    document.getElementById("sValor").value =
      (sx.valor_total !== undefined && sx.valor_total !== null) ? String(sx.valor_total) : "";

    document.getElementById("sNum").dispatchEvent(new Event("input"));
  }

  async function salvarSimuladoModal(){
    const titulo = document.getElementById("sTitulo").value.trim();
    const unidade = document.getElementById("sUnidade").value;
    const curso = document.getElementById("sCurso").value;
    const turma = String(document.getElementById("sTurma").value || "").trim();

    const data = document.getElementById("sDataIni").value;
    const hora = document.getElementById("sHoraIni").value;

    const duracao_min = Number(document.getElementById("sDuracao").value || 90);
    const num_questoes = Number(document.getElementById("sNum").value || 0);
    const valor_total  = Number(document.getElementById("sValor").value || 0);

    if (!titulo || !unidade || !turma) return alert("Preencha título, unidade e turma.");
    if (!curso) return alert("Selecione o curso.");
    if (!data) return alert("Preencha a data de aplicação.");
    if (!hora) return alert("Preencha a hora de aplicação.");
    if (!(duracao_min > 0)) return alert("Informe a duração (minutos).");
    if (!(num_questoes > 0)) return alert("Número de questões deve ser > 0.");
    if (!(valor_total > 0)) return alert("Nota total deve ser > 0.");

    const inicio_em = `${data} ${hora}:00`;

    const dtIni = new Date(`${data}T${hora}:00`);
    dtIni.setMinutes(dtIni.getMinutes() + duracao_min);

    const pad = (n) => String(n).padStart(2, "0");
    const fim_em = `${dtIni.getFullYear()}-${pad(dtIni.getMonth()+1)}-${pad(dtIni.getDate())} ${pad(dtIni.getHours())}:${pad(dtIni.getMinutes())}:00`;

    const payload = {
      ano: anoAtual(),
      titulo,
      unidade,
      curso,
      turma,
      inicio_em,
      fim_em,
      duracao_min,
      num_questoes,
      valor_total
    };

    try {
      if (!editSimuladoId) {
        await api("/api/admin/simulados", { method:"POST", body: payload });
      } else {
        await api(`/api/admin/simulados/${editSimuladoId}`, { method:"PUT", body: payload });
      }

      window.fecharModalSimulado();
      page = 1;
      await carregar();
    } catch (e) {
      alert(e.message || "Erro ao salvar simulado.");
    }
  }

  // ---------- listagem ----------
  function atualizarPag(total){
    const totalPaginas = Math.max(1, Math.ceil(total / limit));
    const info = document.getElementById("infoPaginaS");
    if (info) info.innerText = `Página ${page} de ${totalPaginas}`;

    const bPrev = document.getElementById("btnPrevS");
    const bPri  = document.getElementById("btnPrimeiraS");
    const bNext = document.getElementById("btnNextS");
    const bUlt  = document.getElementById("btnUltimaS");

    if (bPrev) bPrev.disabled = page <= 1;
    if (bPri)  bPri.disabled  = page <= 1;
    if (bNext) bNext.disabled = page >= totalPaginas;
    if (bUlt)  bUlt.disabled  = page >= totalPaginas;
  }

  function statusDoSimulado(inicio_em, fim_em){
  if (!inicio_em || !fim_em) return "Agendado";

  // inicio_em e fim_em: "YYYY-MM-DD HH:MM:SS"
  const ini = new Date(String(inicio_em).replace(" ", "T"));
  const fim = new Date(String(fim_em).replace(" ", "T"));
  const agora = new Date();

  if (Number.isNaN(ini.getTime()) || Number.isNaN(fim.getTime())) return "Agendado";

  if (agora < ini) return "Agendado";
  if (agora >= ini && agora <= fim) return "Em andamento";
  return "Finalizado";
}

function dataHoraFormat(inicio_em, fim_em){
  const ini = String(inicio_em || "");
  const fim = String(fim_em || "");

  // Data (usa a data do início)
  const data = ini ? ini.slice(0, 10) : "";

  // Horário (HH:MM - HH:MM)
  const hIni = ini ? ini.slice(11, 16) : "";
  const hFim = fim ? fim.slice(11, 16) : "";
  const horario = (hIni && hFim) ? `${hIni} - ${hFim}` : (hIni || "");

  return { data, horario };
}

  function renderTabela(rows){
    tbody.innerHTML = "";

    rows.forEach(sm => {
      const tr = document.createElement("tr");

      const { data, horario } = dataHoraFormat(sm.inicio_em, sm.fim_em);
      const status = statusDoSimulado(sm.inicio_em, sm.fim_em);
      const podeAdmin = s.perfil === "admin";
      const btnReplicar = podeAdmin ? `<button class="btn-sm btn-acao" onclick="replicarSimulado(${sm.id})">Replicar</button>` : "";
      const btnReaplicar = (podeAdmin || s.perfil === "professor") ? `<button class="btn-sm btn-acao btn-reaplicar" onclick="reaplicarSimulado(${sm.id})">Reaplicar</button>` : "";
      const btnEditar = podeAdmin ? `<button class="btn-sm btn-acao" onclick="editarSimulado(${sm.id})">Editar</button>` : "";
      const btnExcluir = podeAdmin ? `<button class="btn-sm btn-acao btn-excluir" onclick="excluirSimulado(${sm.id})">Excluir</button>` : "";

      const tabelaSim = document.getElementById("tabelaSimulados");
      if (tabelaSim) tabelaSim.classList.add("table-mobile");

      tr.innerHTML = `
      <td data-label="Título" style="min-width:220px;">${escapeHtml(sm.titulo || "")}</td>
      <td data-label="Unidade">${escapeHtml(sm.unidade || "")}</td>
      <td data-label="Turma">${escapeHtml(sm.turma || "")}</td>
      <td data-label="Data">${escapeHtml(data)}</td>
      <td data-label="Horário">${escapeHtml(horario)}</td>
      <td data-label="Status">${escapeHtml(status)}</td>
      <td data-label="Questões">${sm.num_questoes ?? ""}</td>
      <td data-label="Nota">${sm.valor_total ?? ""}</td>
<td class="acoes-cell">
  <button class="btn-sm btn-acao" onclick="abrirSimulado(${sm.id})">Abrir</button>
  ${btnEditar}
  ${btnReplicar}
  ${btnReaplicar}
  ${btnExcluir}
</td>


    `;

      tbody.appendChild(tr);
    });
  }

  async function carregar(){
    const r = await api(`/api/admin/simulados`);
    simuladosCache = r.simulados || [];

    const filtro = (search || "").toLowerCase().trim();
    const filtrados = simuladosCache.filter(sm => {
      const t = String(sm.titulo || "").toLowerCase();
      const tur = String(sm.turma || "").toLowerCase();
      const curso = String(sm.curso || "").toLowerCase();
      return !filtro || t.includes(filtro) || tur.includes(filtro) || curso.includes(filtro);
    });

    const total = filtrados.length;
    lastTotalS = total;
    const infoTotal = document.getElementById("infoTotalSimulados");
    if (infoTotal) infoTotal.innerText = `Total: ${total}`;

    const inicio = (page - 1) * limit;
    const pageRows = filtrados.slice(inicio, inicio + limit);

    renderTabela(pageRows);
    atualizarPag(total);
  }

  // ---------- ações globais ----------

  // ---------- replicar (implantação) ----------
  let repSimId = null;

  function garantirModalReplicar() {
    if (document.getElementById("modalBackdropReplicar")) return;

    const bd = document.createElement("div");
    bd.className = "modal-backdrop";
    bd.id = "modalBackdropReplicar";
    bd.style.display = "none";

    bd.innerHTML = `
      <div class="modal">
        <div class="modal-header">
          <h3 id="tituloModalReplicar">REPLICAR SIMULADO</h3>
          <button class="modal-close" id="fecharModalReplicarBtn">×</button>
        </div>

        <div class="modal-body">
          <div id="repMsgErro" class="alert-erro" style="display:none; margin-bottom:12px;"></div>

          <div class="box-info" style="margin-bottom:12px;">
            <div><b>Simulado:</b> <span id="repSimTitulo">-</span></div>
            <div><b>Turma atual:</b> <span id="repTurmaAtual">-</span></div>
          </div>

          <div class="field" style="margin-top:10px;">
            <label>Selecione a nova turma</label>
            <select id="repNovaTurma"></select>
            <small style="opacity:.8;">As turmas são buscadas automaticamente do cadastro de alunos (ano atual).</small>
          </div>

          <div class="modal-actions">
            <button class="btn btn-secondary" id="cancelarModalReplicar" type="button">Cancelar</button>
            <button class="btn" id="confirmarReplicar" type="button">Replicar</button>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(bd);

    const fechar = () => {
      document.getElementById("modalBackdropReplicar").style.display = "none";
      document.getElementById("repMsgErro").style.display = "none";
      document.getElementById("repMsgErro").innerText = "";
      repSimId = null;
    };

    document.getElementById("fecharModalReplicarBtn").onclick = fechar;
    document.getElementById("cancelarModalReplicar").onclick = fechar;

    document.getElementById("confirmarReplicar").onclick = async () => {
      const sel = document.getElementById("repNovaTurma");
      const turma = String(sel.value || "").trim();
      if (!repSimId) return;
      if (!turma) return mostrarErroReplicar("Selecione a nova turma.");

      try {
        await api(`/api/admin/simulados/${repSimId}/replicar`, {
          method: "POST",
          body: { turma }
        });
        fechar();
        page = 1;
        await carregar();
        alert("Simulado replicado com sucesso!");
      } catch (e) {
        mostrarErroReplicar(e.message || "Erro ao replicar simulado.");
      }
    };
  }

  function mostrarErroReplicar(msg) {
    const box = document.getElementById("repMsgErro");
    if (!box) return alert(msg);
    box.innerText = msg;
    box.style.display = "block";
  }

  async function abrirModalReplicar(id) {
    garantirModalReplicar();

    const sm = simuladosCache.find(x => Number(x.id) === Number(id));
    if (!sm) return alert("Simulado não encontrado.");

    repSimId = Number(id);

    document.getElementById("repSimTitulo").innerText = sm.titulo || "-";
    document.getElementById("repTurmaAtual").innerText = sm.turma || "-";

    // carregar turmas do ano atual
    let turmas = [];
    try {
      const r = await api("/api/admin/turmas-ano-atual");
      turmas = (r.turmas || []).map(t => String(t).trim()).filter(Boolean);
    } catch (e) {
      turmas = [];
    }

    // remove turma atual
    turmas = turmas.filter(t => t !== String(sm.turma || "").trim());

    const sel = document.getElementById("repNovaTurma");
    sel.innerHTML = "";
    if (!turmas.length) {
      const opt = document.createElement("option");
      opt.value = "";
      opt.innerText = "Nenhuma turma disponível";
      sel.appendChild(opt);
    } else {
      for (const t of turmas) {
        const opt = document.createElement("option");
        opt.value = t;
        opt.innerText = t;
        sel.appendChild(opt);
      }
    }

    document.getElementById("modalBackdropReplicar").style.display = "flex";
  }

  // ---------- reaplicar (reabrir para não realizados) ----------
  let reapSimId = null;

  function toInputDateTime(valor) {
    if (!valor) return "";
    return String(valor).replace(" ", "T").slice(0, 16);
  }

  function nowInputDateTime() {
    const d = new Date();
    const pad = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  function formatLocalInput(dt) {
    const pad = (n) => String(n).padStart(2, "0");
    return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}T${pad(dt.getHours())}:${pad(dt.getMinutes())}`;
  }

  function addMinutesInput(baseInput, minutos) {
    try {
      const dt = new Date(baseInput);
      if (Number.isNaN(dt.getTime())) return baseInput;
      dt.setMinutes(dt.getMinutes() + minutos);
      return formatLocalInput(dt);
    } catch (_) {
      return baseInput;
    }
  }

  function garantirModalReaplicar() {
    if (document.getElementById("modalBackdropReaplicar")) return;

    const bd = document.createElement("div");
    bd.className = "modal-backdrop";
    bd.id = "modalBackdropReaplicar";
    bd.style.display = "none";

    bd.innerHTML = `
      <div class="modal">
        <div class="modal-header">
          <h3 id="tituloModalReaplicar">REAPLICAR SIMULADO</h3>
          <button class="modal-close" id="fecharModalReaplicarBtn">×</button>
        </div>

        <div class="modal-body">
          <div id="reapMsgErro" class="alert-erro" style="display:none; margin-bottom:12px;"></div>

          <div class="box-info" style="margin-bottom:12px;">
            <div><b>Simulado:</b> <span id="reapSimTitulo">-</span></div>
            <div><b>Turma:</b> <span id="reapTurmaAtual">-</span></div>
            <div style="opacity:.85;margin-top:6px;">Reabre apenas para quem <b>não realizou</b>.</div>
          </div>

          <div class="form-grid">
            <div class="field">
              <label>Novo início</label>
              <input id="reapInicio" type="datetime-local" />
            </div>
            <div class="field">
              <label>Novo fim</label>
              <input id="reapFim" type="datetime-local" />
            </div>
          </div>

          <div class="modal-actions">
            <button class="btn btn-secondary" id="cancelarModalReaplicar" type="button">Cancelar</button>
            <button class="btn" id="confirmarReaplicar" type="button">Reaplicar</button>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(bd);

    const fechar = () => {
      document.getElementById("modalBackdropReaplicar").style.display = "none";
      document.getElementById("reapMsgErro").style.display = "none";
      document.getElementById("reapMsgErro").innerText = "";
      reapSimId = null;
    };

    document.getElementById("fecharModalReaplicarBtn").onclick = fechar;
    document.getElementById("cancelarModalReaplicar").onclick = fechar;

    document.getElementById("confirmarReaplicar").onclick = async () => {
      const inicio = String(document.getElementById("reapInicio").value || "").trim();
      const fim = String(document.getElementById("reapFim").value || "").trim();
      if (!reapSimId) return;
      if (!inicio || !fim) return mostrarErroReaplicar("Informe início e fim.");
      if (inicio >= fim) return mostrarErroReaplicar("O fim deve ser maior que o início.");

      try {
        await api(`/api/admin/simulados/${reapSimId}/reaplicar`, {
          method: "POST",
          body: { inicio_em: inicio.replace("T", " "), fim_em: fim.replace("T", " ") }
        });
        fechar();
        await carregar();
        alert("Simulado reaplicado com sucesso!");
      } catch (e) {
        mostrarErroReaplicar(e.message || "Erro ao reaplicar simulado.");
      }
    };
  }

  function mostrarErroReaplicar(msg) {
    const box = document.getElementById("reapMsgErro");
    if (!box) return alert(msg);
    box.innerText = msg;
    box.style.display = "block";
  }

  async function abrirModalReaplicar(id) {
    garantirModalReaplicar();

    const sm = simuladosCache.find(x => Number(x.id) === Number(id));
    if (!sm) return alert("Simulado não encontrado.");

    reapSimId = Number(id);

    document.getElementById("reapSimTitulo").innerText = sm.titulo || "-";
    document.getElementById("reapTurmaAtual").innerText = sm.turma || "-";

    const inicioPadrao = toInputDateTime(sm.inicio_em) || nowInputDateTime();
    const dur = Number(sm.duracao_min || 90);
    const fimPadrao = toInputDateTime(sm.fim_em) || addMinutesInput(inicioPadrao, dur);

    document.getElementById("reapInicio").value = inicioPadrao;
    document.getElementById("reapFim").value = fimPadrao;

    document.getElementById("modalBackdropReaplicar").style.display = "flex";
  }

  window.abrirSimulado = (id) => {
    window.location.href = `simulado-detalhe.html?id=${id}`;
  };

  window.replicarSimulado = (id) => {
  // Implementação real é definida dentro do initSimulados() (onde temos acesso ao cache da lista).
  if (typeof window.__replicarSimuladoImpl === "function") {
    return window.__replicarSimuladoImpl(id);
  }
  alert("Replicar: carregando...");
};

window.reaplicarSimulado = (id) => {
  abrirModalReaplicar(id);
};


  window.editarSimulado = async (id) => {
    if (s.perfil !== "admin") return alert("Somente ADMIN pode editar simulados.");

    const sm = simuladosCache.find(x => Number(x.id) === Number(id));
    if (!sm) return alert("Simulado não encontrado.");

    editSimuladoId = Number(id);
    await abrirModalSimulado("Editar Simulado");

    preencherSimuladoForm({
      titulo: sm.titulo,
      unidade: sm.unidade,
      curso: sm.curso,
      turma: sm.turma,
      inicio_em: sm.inicio_em,
      duracao_min: sm.duracao_min || 90,
      num_questoes: sm.num_questoes,
      valor_total: sm.valor_total
    });
  };

  window.excluirSimulado = async (id) => {
    if (s.perfil !== "admin") return alert("Somente ADMIN pode excluir simulados.");
    if (!confirm("Excluir simulado?")) return;

    try {
      await api(`/api/admin/simulados/${id}`, { method:"DELETE" });
      await carregar();
    } catch (e) {
      alert(e.message || "Erro ao excluir.");
    }
  };

  // ---------- eventos de UI ----------
  document.getElementById("btnNovoSimulado")?.addEventListener("click", async () => {
    if (s.perfil !== "admin") {
      alert("Somente ADMIN pode criar simulados.");
      return;
    }

    editSimuladoId = null;
    await abrirModalSimulado("Novo Simulado");

    preencherSimuladoForm({
      titulo: "",
      unidade: "I UNIDADE",
      curso: "",
      turma: "",
      inicio_em: "",
      duracao_min: 90,
      num_questoes: null,
      valor_total: null
    });
  });

  // busca
  let tmr = null;
  document.getElementById("buscaSimulado")?.addEventListener("input",(e)=>{
    clearTimeout(tmr);
    tmr = setTimeout(()=>{
      search = e.target.value || "";
      page = 1;
      carregar();
    }, 200);
  });

  // paginação
  document.getElementById("selectPorPaginaS")?.addEventListener("change",(e)=>{
    limit = Number(e.target.value || 5);
    page = 1;
    carregar();
  });
  document.getElementById("btnPrimeiraS")?.addEventListener("click",()=>{ page = 1; carregar(); });
  document.getElementById("btnPrevS")?.addEventListener("click",()=>{ page--; carregar(); });
  document.getElementById("btnNextS")?.addEventListener("click",()=>{ page++; carregar(); });
  document.getElementById("btnUltimaS")?.addEventListener("click",()=>{
    const totalPaginas = Math.max(1, Math.ceil(lastTotalS / limit));
    page = totalPaginas;
    carregar();
  });

  // init
  await carregar();
}
});
let simuladoAtual = null;
window.initSimuladoDetalhe = async function () {
  const s = await ensureSession({ redirect: true });
  if (!s) return;
  renderHeader(s.perfil);

  const params = new URLSearchParams(window.location.search);
  const simuladoId = Number(params.get("id"));
  if (!simuladoId) {
    alert("Simulado inválido.");
    return;
  }
  let ctxAtual = null;

  const simInfo = document.getElementById("simInfo");
  const tbody = document.querySelector("#tabelaQuestoesSimulado tbody");
  const qCount = document.getElementById("qCount");
  const qMax = document.getElementById("qMax");

  const btnCriar = document.getElementById("btnCriarQuestao");
  const btnBanco = document.getElementById("btnAdicionarBanco");
  let modalVerQuestao = null;

  function garantirModalVerQuestao(){
    if (modalVerQuestao) return;
    const bd = document.createElement("div");
    bd.className = "modal-backdrop";
    bd.id = "modalVerQuestao";
    bd.style.display = "none";
    bd.innerHTML = `
      <div class="modal" style="max-width:860px;">
        <div class="modal-header">
          <span>Visualizar questão</span>
          <button class="btn-sm" id="fecharVerQuestao">X</button>
        </div>
        <div class="modal-body" id="verQuestaoBody"></div>
      </div>
    `;
    document.body.appendChild(bd);
    bd.querySelector("#fecharVerQuestao").addEventListener("click", () => {
      bd.style.display = "none";
    });
    modalVerQuestao = bd;
  }

  function abrirModalVerQuestao(q){
    garantirModalVerQuestao();
    const body = modalVerQuestao.querySelector("#verQuestaoBody");
    if (body){
      const img = q.imagem_url ? `<div class="q-img"><img src="${escapeHtml(q.imagem_url)}" alt="Imagem da questão" /></div>` : "";
      body.innerHTML = `
        <div class="field" style="margin-bottom:10px;">
          <label>Enunciado</label>
          <div>${escapeHtml(q.enunciado || "")}</div>
        </div>
        ${img}
        <div class="form-grid">
          <div class="field"><label>A</label><div>${escapeHtml(q.alternativa_a || "")}</div></div>
          <div class="field"><label>B</label><div>${escapeHtml(q.alternativa_b || "")}</div></div>
          <div class="field"><label>C</label><div>${escapeHtml(q.alternativa_c || "")}</div></div>
          <div class="field"><label>D</label><div>${escapeHtml(q.alternativa_d || "")}</div></div>
          <div class="field"><label>E</label><div>${escapeHtml(q.alternativa_e || "")}</div></div>
          <div class="field"><label>Correta</label><div>${escapeHtml(q.correta || "")}</div></div>
          <div class="field"><label>Disciplina</label><div>${escapeHtml(q.disciplina_nome || q.materia || "-")}</div></div>
        </div>
      `;
    }
    modalVerQuestao.style.display = "flex";
  }

  async function carregar() {
    const r = await api(`/api/simulados/${simuladoId}`);
    if (!r.ok) {
      alert(r.msg || "Erro ao carregar simulado.");
      return;
    }

    const s = r.simulado;
    simuladoAtual = s;
const ctx = {
  curso: simuladoAtual?.curso || "",
  serie: simuladoAtual?.turma || "",
  unidade: simuladoAtual?.unidade || "",
  ano: anoAtual()
};

await carregarDisciplinas(ctx);


    simInfo.innerHTML = `
      <div style="display:grid; grid-template-columns: 1fr 1fr; gap:10px;">
        <div><b>Título:</b> ${escapeHtml(s.titulo)}</div>
        <div><b>Status:</b> ${escapeHtml(s.status)}</div>
        <div><b>Curso:</b> ${escapeHtml(s.curso || "-")}</div>
        <div><b>Turma:</b> ${escapeHtml(s.turma || "-")}</div>
        <div><b>Unidade:</b> ${escapeHtml(s.unidade || "-")}</div>
        <div><b>Data/Hora:</b> ${escapeHtml(s.inicio_em || "-")} → ${escapeHtml(s.fim_em || "-")}</div>
        <div><b>Duração:</b> ${Number(s.duracao_min || 90)} min</div>
        <div><b>Limite questões:</b> ${Number(s.num_questoes || 0)}</div>
      </div>
    `;

    qCount.textContent = String(r.total_questoes || 0);
    qMax.textContent = String(s.num_questoes || 0);

    const atingiu = Number(r.total_questoes || 0) >= Number(s.num_questoes || 0);
    btnCriar.disabled = atingiu;
    btnBanco.disabled = atingiu;
    const limiteMsg = document.getElementById("limiteMsg");
    if (limiteMsg) {
      limiteMsg.style.display = atingiu ? "block" : "none";
    }

    tbody.innerHTML = "";
    for (const q of r.questoes) {
      const tr = document.createElement("tr");
      const tabelaSimQ = document.getElementById("tabelaQuestoesSimulado");
      if (tabelaSimQ) tabelaSimQ.classList.add("table-mobile");
      tr.innerHTML = `
        <td data-label="Enunciado">${escapeHtml(q.enunciado || "")}</td>
        <td data-label="Correta">${escapeHtml(q.correta || "")}</td>
        <td data-label="Matéria">${escapeHtml(q.disciplina_nome || q.materia || "")}</td>
        <td data-label="Cadastrada por">${escapeHtml(q.professor_nome || q.criada_por_matricula || "-")}</td>
        <td>
          <button class="btn-sm" data-acao="ver" data-qid="${q.id}">Ver</button>
          <button class="btn-sm" data-acao="editar" data-qid="${q.id}">Editar</button>
          <button class="btn-sm" data-acao="remover" data-qid="${q.id}">Remover</button>
        </td>
      `;
      tbody.appendChild(tr);
    }
  }

  // remover questão
  tbody.addEventListener("click", async (e) => {
    const b = e.target.closest("button[data-acao]");
    if (!b) return;
    const acao = b.dataset.acao;
    const qid = Number(b.dataset.qid);

    if (acao === "ver") {
      try {
        const r = await api(`/api/questoes/${qid}`);
        if (!r.ok) return alert(r.msg || "Questao nao encontrada.");
        abrirModalVerQuestao(r.questao || {});
      } catch (err) {
        alert(err.message || "Erro ao carregar questao.");
      }
      return;
    }

    if (acao === "editar") {
      try {
        await abrirEditarQuestao(qid);
      } catch (err) {
        alert(err.message || "Erro ao abrir edicao.");
      }
      return;
    }

    if (acao === "remover") {
      const ok = confirm("Remover esta questão do simulado?");
      if (!ok) return;
      const r = await api(`/api/simulados/${simuladoId}/questoes/${qid}`, { method: "DELETE" });
      if (!r.ok) alert(r.msg || "Erro ao remover.");
      await carregar();
    }
  });

  // por enquanto: criar questão (simples via prompt) — já já a gente troca por modal igual padrão
    // ============================
  // MODAL: CRIAR QUESTÃO (COM IMAGEM)
  // ============================
  const modalCQ = document.getElementById("modalCriarQuestao");
  const fecharCQ = document.getElementById("fecharCriarQuestao");
  const cancelarCQ = document.getElementById("cancelarCriarQuestao");
  const salvarCQ = document.getElementById("salvarCriarQuestao");
  const erroCQ = document.getElementById("erroCriarQuestao");

  const cqSerie = document.getElementById("cqSerie");
  const cqCurso = document.getElementById("cqCurso");
  const cqUnidade = document.getElementById("cqUnidade");

  const cqEnunciado = document.getElementById("cqEnunciado");
  const cqImagem = document.getElementById("cqImagem");
  const cqPreviewWrap = document.getElementById("cqPreviewWrap");
  const cqPreview = document.getElementById("cqPreview");

  // ============================
  // LIGHTBOX (clicar para ampliar)
  // ============================
  function garantirLightbox() {
    if (document.getElementById("imgLightbox")) return;

    const lb = document.createElement("div");
    lb.className = "img-lightbox";
    lb.id = "imgLightbox";
    lb.innerHTML = `
      <div class="box">
        <div class="top">
          <span>Imagem da questão</span>
          <button type="button" id="lbFechar">Fechar</button>
        </div>
        <div class="content">
          <img id="lbImg" alt="Imagem ampliada"/>
        </div>
      </div>
    `;
    document.body.appendChild(lb);

    const fechar = () => (lb.style.display = "none");
    lb.addEventListener("click", (e) => {
      if (e.target === lb) fechar();
    });
    document.getElementById("lbFechar").addEventListener("click", fechar);

    // ESC fecha
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") fechar();
    });
  }

  function abrirLightbox(src) {
    garantirLightbox();
    const lb = document.getElementById("imgLightbox");
    const img = document.getElementById("lbImg");
    img.src = src;
    lb.style.display = "flex";
  }

  // ao clicar no thumbnail abre grande
  if (cqPreview) {
    cqPreview.addEventListener("click", () => {
      const src = cqPreview.src;
      if (src) abrirLightbox(src);
    });
  }


  const cqA = document.getElementById("cqA");
  const cqB = document.getElementById("cqB");
  const cqC = document.getElementById("cqC");
  const cqD = document.getElementById("cqD");
  const cqE = document.getElementById("cqE");
  const cqCorreta = document.getElementById("cqCorreta");
  const cqDisciplina = document.getElementById("cqDisciplina");
  const colarAlternativas = document.getElementById("colarAlternativas");

  function showErroCQ(msg) {
    if (!erroCQ) return alert(msg);
    erroCQ.style.display = "block";
    erroCQ.textContent = msg;
  }

  function limparCQ() {
    // sempre que abrimos em modo "criar"
    cqModo = "criar";
    cqEditId = null;
    cqImagemAtualUrl = null;

    // UI
    const titulo = document.querySelector("#modalCriarQuestao .modal-header span");
    if (titulo) titulo.textContent = "Criar questão";
    if (salvarCQ) salvarCQ.textContent = "Salvar";
    if (erroCQ) {
      erroCQ.style.display = "none";
      erroCQ.textContent = "";
    }

    if (cqSerie) cqSerie.textContent = simuladoAtual?.turma || "-";
    if (cqCurso) cqCurso.textContent = simuladoAtual?.curso || "-";
    if (cqUnidade) cqUnidade.textContent = simuladoAtual?.unidade || "-";

    if (cqEnunciado) cqEnunciado.value = "";
    if (cqImagem) cqImagem.value = "";

    if (cqPreviewWrap) cqPreviewWrap.style.display = "none";
    if (cqPreview) cqPreview.src = "";

    if (cqA) cqA.value = "";
    if (cqB) cqB.value = "";
    if (cqC) cqC.value = "";
    if (cqD) cqD.value = "";
    if (cqE) cqE.value = "";
    if (cqCorreta) cqCorreta.value = "";
    if (cqDisciplina) cqDisciplina.value = "";
    if (colarAlternativas) colarAlternativas.value = "";
  }

  function abrirModalCQ() {
    if (!modalCQ) {
      alert("Modal 'Criar Questão' não encontrado no HTML.");
      return;
    }
    limparCQ();
    modalCQ.style.display = "flex";
  }

  function fecharModalCQ() {
    if (modalCQ) modalCQ.style.display = "none";
  }

  // Preview da imagem
  if (cqImagem) {
  cqImagem.addEventListener("change", () => {
    const file = cqImagem.files?.[0];
    if (!file) {
      if (cqPreviewWrap) cqPreviewWrap.style.display = "none";
      if (cqPreview) cqPreview.src = "";
      return;
    }

    const url = URL.createObjectURL(file);
    if (cqPreview) cqPreview.src = url;
    if (cqPreviewWrap) cqPreviewWrap.style.display = "block";
  });
}


  // Botões do modal
  if (fecharCQ) fecharCQ.addEventListener("click", fecharModalCQ);
  if (cancelarCQ) cancelarCQ.addEventListener("click", fecharModalCQ);
  const btnNovaDisc = document.getElementById("btnNovaDisciplina");
if (btnNovaDisc) {
  btnNovaDisc.onclick = async () => {
    if (!simuladoAtual) return alert("Simulado ainda não carregou.");
  
    await cadastrarDisciplina(ctx);
  };
}


  // SUBSTITUI O PROMPT: botão Criar Questão abre modal
  btnCriar.addEventListener("click", () => {
    abrirModalCQ();
  });


  // Salvar questão (com upload opcional)
  async function salvarQuestaoDoModal() {
    if (!simuladoAtual) {
      alert("Simulado ainda não carregou.");
      return;
    }

    const enunciado = (document.getElementById("cqEnunciado")?.value || "").trim();
    const alternativa_a = (document.getElementById("cqA")?.value || "").trim();
    const alternativa_b = (document.getElementById("cqB")?.value || "").trim();
    const alternativa_c = (document.getElementById("cqC")?.value || "").trim();
    const alternativa_d = (document.getElementById("cqD")?.value || "").trim();
    const alternativa_e = (document.getElementById("cqE")?.value || "").trim();
    const correta = (document.getElementById("cqCorreta")?.value || "").trim();

    const disciplina_id = (document.getElementById("cqDisciplina")?.value || "").trim();

    if (!enunciado || !alternativa_a || !alternativa_b || !alternativa_c || !alternativa_d || !correta || !disciplina_id) {
      showErroCQ("Preencha enunciado, alternativas A-D, a alternativa correta e a disciplina.");
      return;
    }

    // 1) upload imagem (se houver)
    let imagem_url = (cqModo === "editar") ? (cqImagemAtualUrl || null) : null;
    const file = document.getElementById("cqImagem")?.files?.[0];
    if (file) {
      const fd = new FormData();
      fd.append("imagem", file);
      const up = await fetch("/api/upload/questao-imagem", { method: "POST", body: fd });
      const upData = await up.json().catch(() => ({}));
      if (!up.ok || upData.ok === false) {
        showErroCQ(upData.msg || "Erro ao enviar imagem.");
        return;
      }
      imagem_url = upData.url;
    }

    try {
      // 2) dependendo do modo: CRIAR ou EDITAR
      if (cqModo === "editar" && cqEditId) {
        const payload = {
          enunciado,
          alternativa_a,
          alternativa_b,
          alternativa_c,
          alternativa_d,
          alternativa_e: alternativa_e || null,
          correta,
          disciplina_id: disciplina_id || null,
          imagem_url,
          // campos legados não usados na UI (mantemos nulos)
          materia: null,
          tags: null,
        };

        const r = await api(`/api/questoes/${cqEditId}`, { method: "PUT", body: payload });
        if (!r.ok) {
          showErroCQ(r.msg || "Erro ao atualizar questão.");
          return;
        }

        fecharModalCQ();
        await carregar();
        // Atualiza a listagem do Banco de Questões no curso atualmente selecionado
        const ctx = { curso: (fCurso?.value || simuladoAtual.curso), serie: simuladoAtual.turma, unidade: simuladoAtual.unidade, ano: anoAtual() };
        await listarBanco(ctx);
        alert("Questão atualizada!");
        return;
      }

      // CRIAR: cria questão no contexto do simulado (já vincula e respeita limite)
      const payload = {
        enunciado,
        alternativa_a,
        alternativa_b,
        alternativa_c,
        alternativa_d,
        alternativa_e: alternativa_e || null,
        correta,
        disciplina_id: disciplina_id || null,
        imagem_url
      };

      const r = await api(`/api/simulados/${simuladoId}/questoes/criar`, { method: "POST", body: payload });
      if (!r.ok) {
        showErroCQ(r.msg || "Erro ao salvar questão.");
        return;
      }

      fecharModalCQ();
      await carregar();
      alert("Questão cadastrada e adicionada ao simulado!");
    } catch (e) {
      console.error(e);
      showErroCQ(e.message || "Erro ao salvar questão.");
    }
  }

  if (salvarCQ) salvarCQ.addEventListener("click", salvarQuestaoDoModal);


  // adicionar do banco (simples agora)
  
  // ============================
  // BANCO DE QUESTÕES (modal + filtros)
  // ============================
  const modalBQ = document.getElementById("modalBancoQuestoes");
  const fecharBQ = document.getElementById("fecharBancoQuestoes");
  const tbodyBQ = document.getElementById("tbodyBancoQuestoes");

  const fCurso = document.getElementById("fCurso");
  const fUnidade = document.getElementById("fUnidade");
  const fAnoBanco = document.getElementById("fAnoBanco");
  const fDisciplina = document.getElementById("fDisciplina");
  const fBusca = document.getElementById("fBusca");

  const bqPrev = document.getElementById("bqPrev");
  const bqNext = document.getElementById("bqNext");
  const bqInfo = document.getElementById("bqInfo");

  let bqPage = 1;
  // No Banco de Questões (modal) mostramos no máximo 5 por página
  const bqLimit = 5;
  let bqTotal = 0;
  let bqDebounce = null;

function abrirBQ() { modalBQ.classList.add("show"); }
function fecharBQModal() { modalBQ.classList.remove("show"); }

  if (fecharBQ) fecharBQ.addEventListener("click", fecharBQModal);
  if (modalBQ) {
    modalBQ.addEventListener("click", (e) => {
      // fecha clicando fora (na área escura do modal)
      if (e.target === modalBQ) fecharBQModal();
    });
  }

  async function carregarDisciplinasFiltro(ctx) {
    if (!fDisciplina) return;
    fDisciplina.innerHTML = `<option value="">Todas</option>`;

    // Se o curso não estiver definido, não chama a API (evita modal quebrar)
    if (!ctx?.curso) return;

    try {
      const data = await api(`/api/disciplinas?curso=${encodeURIComponent(ctx.curso)}&serie=${encodeURIComponent(ctx.serie)}&unidade=${encodeURIComponent(ctx.unidade)}&ano=${encodeURIComponent(ctx.ano)}`);
      const list = (data && data.ok && Array.isArray(data.disciplinas)) ? data.disciplinas : [];
      for (const d of list) {
        const opt = document.createElement("option");
        opt.value = String(d.id);
        opt.textContent = d.nome;
        fDisciplina.appendChild(opt);
      }
    } catch (e) {
      console.error("Erro ao carregar disciplinas (filtro):", e);
    }
  }

  async function listarBanco(ctx) {
    if (!tbodyBQ) return;

    const disciplina_id = fDisciplina?.value || "";
    const search = (fBusca?.value || "").trim();
    const anoFiltro = String(fAnoBanco?.value || "").trim();

    const cursoSel = (fCurso?.value || ctx.curso || "").trim();

    const qs = new URLSearchParams({
      ano: String(anoFiltro || ctx.ano),
      curso: cursoSel,
      unidade: ctx.unidade,
      serie: ctx.serie,
      page: String(bqPage),
      limit: String(bqLimit),
    });
    if (!anoFiltro) qs.set("all_anos", "1");
    if (simuladoId) qs.set("simulado_id", String(simuladoId));

    if (disciplina_id) qs.set("disciplina_id", disciplina_id);
    if (search) qs.set("search", search);

    try {
      const r = await api(`/api/questoes?${qs.toString()}`);

      if (!r || r.ok !== true) {
        tbodyBQ.innerHTML = `<tr><td colspan="6">Erro ao carregar.</td></tr>`;
        return;
      }

      bqTotal = Number(r.total || 0);
      const totalPag = Math.max(1, Math.ceil(bqTotal / bqLimit));
      if (bqInfo) bqInfo.textContent = `Página ${bqPage} de ${totalPag} — Total: ${bqTotal}`;

      const rows = Array.isArray(r.rows) ? r.rows : [];
      if (rows.length === 0) {
        tbodyBQ.innerHTML = `<tr><td colspan="5">Nenhuma questão encontrada.</td></tr>`;
      } else {
        const tabelaBQ = tbodyBQ.closest("table");
        if (tabelaBQ) tabelaBQ.classList.add("table-mobile");
        tbodyBQ.innerHTML = rows.map(q => `
          <tr>
            <td data-label="Enunciado">${escapeHtml(q.enunciado || "")}</td>
            <td data-label="Correta">${escapeHtml(q.correta || "")}</td>
            <td data-label="Disciplina">${escapeHtml(q.disciplina_nome || q.materia || "")}</td>
            <td data-label="Cadastrada por">${escapeHtml(q.professor_nome || q.criada_por_matricula || "-")}</td>
            <td data-label="Ações" style="display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end;">
              <button class="btn-sm" data-add="${q.id}">Adicionar</button>
              <button class="btn-sm" data-edit="${q.id}">Editar</button>
              <button class="btn-sm" data-del="${q.id}">Excluir</button>
            </td>
          </tr>
        `).join("");
      }

      if (bqPrev) bqPrev.disabled = bqPage <= 1;
      if (bqNext) bqNext.disabled = bqPage >= totalPag;

    } catch (e) {
      console.error("Erro ao listar banco:", e);
      tbodyBQ.innerHTML = `<tr><td colspan="6">Erro ao carregar.</td></tr>`;
    }
  }

  // ----------------------------
  // Editar questão usando o MESMO modal de criação (modo edição)
  // ----------------------------
  let cqModo = "criar"; // criar | editar
  let cqEditId = null;
  let cqImagemAtualUrl = null; // usada no modo editar, caso não escolha nova imagem

  async function abrirEditarQuestao(qid) {
    try {
      const r = await api(`/api/questoes/${qid}`);
      if (!r.ok) throw new Error(r.msg || "Questão não encontrada");
      const q = r.questao;

      cqModo = "editar";
      cqEditId = Number(q.id);
      cqImagemAtualUrl = q.imagem_url || null;

      // Atualiza "contexto" mostrado no topo do modal (agora reflete a questão, não o simulado)
      if (cqSerie) cqSerie.textContent = q.serie || "-";
      if (cqCurso) cqCurso.textContent = q.curso || "-";
      if (cqUnidade) cqUnidade.textContent = q.unidade || "-";

      // Campos
      if (cqEnunciado) cqEnunciado.value = q.enunciado || "";
      if (cqA) cqA.value = q.alternativa_a || "";
      if (cqB) cqB.value = q.alternativa_b || "";
      if (cqC) cqC.value = q.alternativa_c || "";
      if (cqD) cqD.value = q.alternativa_d || "";
      if (cqE) cqE.value = q.alternativa_e || "";
      if (cqCorreta) cqCorreta.value = (q.correta || "").toUpperCase();

      // Imagem: mostra preview se existir
      if (cqImagem) cqImagem.value = "";
      if (cqPreviewWrap && cqPreview) {
        if (cqImagemAtualUrl) {
          cqPreview.src = cqImagemAtualUrl;
          cqPreviewWrap.style.display = "block";
        } else {
          cqPreview.src = "";
          cqPreviewWrap.style.display = "none";
        }
      }

      // Disciplinas (carrega pela "identidade" da questão)
      const ctxQ = {
        curso: q.curso,
        serie: q.serie,
        unidade: q.unidade,
        ano: q.ano || anoAtual(),
      };
      await carregarDisciplinas(ctxQ);
      const sel = document.getElementById("cqDisciplina");
      if (sel) sel.value = q.disciplina_id ? String(q.disciplina_id) : "";

      // UI
      const titulo = document.querySelector("#modalCriarQuestao .modal-header span");
      if (titulo) titulo.textContent = "Editar questão";
      if (salvarCQ) salvarCQ.textContent = "Atualizar";

      if (modalBQ) modalBQ.style.zIndex = "10000";
      if (modalCQ) modalCQ.style.zIndex = "10050";
      if (modalCQ) modalCQ.style.display = "flex";
    } catch (e) {
      console.error(e);
      alert(e.message || "Erro ao abrir edição");
    }
  }

  if (tbodyBQ) {
    tbodyBQ.addEventListener("click", async (e) => {
      const bAdd = e.target.closest("button[data-add]");
      const bEdit = e.target.closest("button[data-edit]");
      const bDel = e.target.closest("button[data-del]");

      // ADICIONAR AO SIMULADO
      if (bAdd) {
        const qid = Number(bAdd.dataset.add);
        if (!qid) return;

        const r = await api(`/api/simulados/${simuladoId}/questoes`, {
          method: "POST",
          body: { questao_id: qid }
        });

        if (!r.ok) {
          alert(r.msg || "Erro ao adicionar.");
          return;
        }

        await carregar();
        // Atualiza o banco para refletir mudanças (ex.: se você decidir não listar repetidas depois)
        const ctx = { curso: (fCurso?.value || simuladoAtual.curso), serie: simuladoAtual.turma, unidade: simuladoAtual.unidade, ano: anoAtual() };
        await listarBanco(ctx);
        alert("Questão adicionada ao simulado!");
        return;
      }

      // EDITAR
      if (bEdit) {
        const qid = Number(bEdit.dataset.edit);
        if (!qid) return;
        await abrirEditarQuestao(qid);
        return;
      }

      // EXCLUIR
      if (bDel) {
        const qid = Number(bDel.dataset.del);
        if (!qid) return;
        const ok = confirm("Excluir esta questão do Banco de Questões?\n\nObs.: ela poderá ser removida dos simulados em que estiver vinculada.");
        if (!ok) return;

        const r = await api(`/api/questoes/${qid}`, { method: "DELETE" });
        if (!r.ok) {
          alert(r.msg || "Erro ao excluir.");
          return;
        }

        const ctx = { curso: simuladoAtual.curso, serie: simuladoAtual.turma, unidade: simuladoAtual.unidade, ano: anoAtual() };
        await listarBanco(ctx);
        await carregar();
        alert("Questão excluída.");
      }
    });
  }

  if (bqPrev) bqPrev.addEventListener("click", async () => {
    bqPage = Math.max(1, bqPage - 1);
    const ctx = { curso: (fCurso?.value || simuladoAtual.curso), serie: simuladoAtual.turma, unidade: simuladoAtual.unidade, ano: simuladoAtual.ano || anoAtual() };
    await listarBanco(ctx);
  });

  if (bqNext) bqNext.addEventListener("click", async () => {
    bqPage += 1;
    const ctx = { curso: (fCurso?.value || simuladoAtual.curso), serie: simuladoAtual.turma, unidade: simuladoAtual.unidade, ano: simuladoAtual.ano || anoAtual() };
    await listarBanco(ctx);
  });

  if (fCurso) fCurso.addEventListener("change", async () => {
    // Permite selecionar questões de outro curso (unidade permanece fixa)
    bqPage = 1;
    const ctx = { curso: fCurso.value || simuladoAtual.curso, serie: simuladoAtual.turma, unidade: simuladoAtual.unidade, ano: simuladoAtual.ano || anoAtual() };
    // Recarrega disciplinas de acordo com o curso escolhido
    await carregarDisciplinasFiltro(ctx);
    await listarBanco(ctx);
  });

  if (fDisciplina) fDisciplina.addEventListener("change", async () => {
    bqPage = 1;
    const ctx = { curso: (fCurso?.value || simuladoAtual.curso), serie: simuladoAtual.turma, unidade: simuladoAtual.unidade, ano: simuladoAtual.ano || anoAtual() };
    await listarBanco(ctx);
  });

  if (fAnoBanco) fAnoBanco.addEventListener("change", async () => {
    bqPage = 1;
    const ctx = { curso: (fCurso?.value || simuladoAtual.curso), serie: simuladoAtual.turma, unidade: simuladoAtual.unidade, ano: simuladoAtual.ano || anoAtual() };
    await listarBanco(ctx);
  });

  if (fBusca) fBusca.addEventListener("input", () => {
    clearTimeout(bqDebounce);
    bqDebounce = setTimeout(async () => {
      bqPage = 1;
      const ctx = { curso: (fCurso?.value || simuladoAtual.curso), serie: simuladoAtual.turma, unidade: simuladoAtual.unidade, ano: simuladoAtual.ano || anoAtual() };
      await listarBanco(ctx);
    }, 250);
  });

  // botão "Adicionar do banco" agora abre o modal com lista filtrada
  btnBanco.addEventListener("click", async () => {
    if (!simuladoAtual) return alert("Simulado ainda não carregou.");

    const ctx = {
      curso: simuladoAtual.curso,
      serie: simuladoAtual.turma,
      unidade: simuladoAtual.unidade,
      ano: simuladoAtual.ano || anoAtual()
    };

    if (fCurso) fCurso.value = ctx.curso;
    if (fUnidade) fUnidade.value = ctx.unidade;
    if (fAnoBanco) fAnoBanco.value = "";

    bqPage = 1;
    await carregarAnosBanco();
    await carregarDisciplinasFiltro(ctx);
    await listarBanco(ctx);
    abrirBQ();
  });

  async function carregarAnosBanco(){
    if (!fAnoBanco) return;
    fAnoBanco.innerHTML = `<option value="">Todos</option>`;
    try{
      const r = await api("/api/anos");
      const anos = (r.anos || []).map(Number).filter(n => Number.isFinite(n)).sort((a,b)=>b-a);
      fAnoBanco.innerHTML = `<option value="">Todos</option>` +
        anos.map(a => `<option value="${a}">${a}</option>`).join("");
    }catch(_){
      fAnoBanco.innerHTML = `<option value="">Todos</option>`;
    }
  }

document.getElementById('btnNovaDisciplina').onclick = async () => {
  try {
    if (!simuladoAtual) {
      alert("Simulado ainda não carregou.");
      return;
    }

    // 1) cadastrar disciplina
    const nome = prompt("Nome da disciplina:");
    if (!nome) return;

    const r = await fetch("/api/disciplinas", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ nome })
    });

    const data = await r.json().catch(() => ({}));

    if (!r.ok || data.ok === false) {
      alert(data.msg || data.erro || "Erro ao cadastrar disciplina.");
      return;
    }

    // 2) recarregar lista e selecionar a nova
    const ctx = {
      curso: simuladoAtual.curso,
      serie: simuladoAtual.turma,
      unidade: simuladoAtual.unidade,
      ano: simuladoAtual.ano || anoAtual()
    };
    await carregarDisciplinas(ctx);

    const sel = document.getElementById("cqDisciplina");
    if (sel && data.id) sel.value = String(data.id);

  } catch (e) {
    console.error(e);
    alert("Erro inesperado ao cadastrar disciplina.");
  }
};

async function carregarDisciplinas(ctx){
  const sel = document.getElementById("cqDisciplina");
  if (!sel) return;

  sel.innerHTML = `<option value="">Carregando...</option>`;

  // se ctx ainda estiver vazio, não chama API (evita curso= vazio)
  if (!ctx?.curso || !ctx?.serie || !ctx?.unidade) {
    sel.innerHTML = `<option value="">Contexto do simulado inválido</option>`;
    return;
  }

  const qs = new URLSearchParams({
    curso: ctx.curso,
    serie: ctx.serie,
    unidade: ctx.unidade,
    ano: String(ctx.ano || anoAtual())
  });

  try {
    const data = await api(`/api/disciplinas?${qs.toString()}`);
    // pode vir como {disciplinas:[...]} ou direto [...]
    const lista = Array.isArray(data) ? data : (data.disciplinas || []);

    if (!Array.isArray(lista) || lista.length === 0) {
      sel.innerHTML = `<option value="">Nenhuma cadastrada</option>`;
      return;
    }

    sel.innerHTML =
      `<option value="">Selecione...</option>` +
      lista.map(d => `<option value="${d.id}">${escapeHtml(d.nome)}</option>`).join("");

    if (lista.length === 1) sel.value = String(lista[0].id);

  } catch (e) {
    sel.innerHTML = `<option value="">Erro ao carregar</option>`;
    console.error("Erro ao carregar disciplinas:", e);
  }
}


async function cadastrarDisciplina(ctx){
  const nome = prompt("Nome da disciplina/matéria:");
  if (!nome) return;

  const payload = {
    nome: nome.trim(),
    curso: ctx.curso,
    serie: ctx.serie,
    unidade: ctx.unidade,
    ano: ctx.ano
  };

  const resp = await fetch("/api/disciplinas", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "same-origin",
    body: JSON.stringify(payload)
  });

  const r = await resp.json();
  if (!resp.ok || !r.ok) {
    alert(r.msg || "Erro ao cadastrar disciplina.");
    return;
  }

  await carregarDisciplinas(ctx);

  const sel = document.getElementById("cqDisciplina");
  if (sel) sel.value = String(r.id);
}

  await carregar();
};
