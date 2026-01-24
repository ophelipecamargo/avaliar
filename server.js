require("dotenv").config();
const path = require("path");
const fs = require("fs");
const multer = require("multer");
const express = require("express");
const bcrypt = require("bcrypt");
const nodemailer = require("nodemailer");
const session = require("express-session");
const PgSession = require("connect-pg-simple")(session);

const db = require("./db");

const TENTATIVAS_ALUNO_COL = "aluno_matricula";
function tentativasAlunoCol() {
  return TENTATIVAS_ALUNO_COL;
}
async function insertTentativa(simuladoId, matricula, terminaEm, ordemJson, iniciadoEm = null) {
  const sql = `
    INSERT INTO tentativas
      (simulado_id, aluno_matricula, matricula, iniciado_em, termina_em, ordem_json)
    VALUES (?, ?, ?, ?, ?, ?)
    RETURNING id
  `;
  return db.prepare(sql).get(
    simuladoId,
    matricula,
    matricula,
    iniciadoEm || new Date(),
    terminaEm,
    ordemJson
  );
}


const app = express();
const PORT = process.env.PORT || 3000;


// Middlewares
app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true }));
app.disable("x-powered-by");

app.use(
  session({
    store: new PgSession({ pool: db.pool, createTableIfMissing: true }),
    name: "avalia.sid",
    secret: process.env.SESSION_SECRET || "troque-por-uma-chave-grande-e-secreta",
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      // secure: true, // use true quando tiver HTTPS
      maxAge: 1000 * 60 * 60 * 8, // 8h
    },
  })
);

// Servir front-end
app.use(express.static(path.join(__dirname, "public")));

// Rate limit simples (login)
const loginAttempts = new Map();
const LOGIN_WINDOW_MS = 10 * 60 * 1000;
const LOGIN_MAX = 8;

function isRateLimited(ip) {
  const now = Date.now();
  const entry = loginAttempts.get(ip);
  if (!entry) return false;
  if (now - entry.first > LOGIN_WINDOW_MS) {
    loginAttempts.delete(ip);
    return false;
  }
  return entry.count >= LOGIN_MAX;
}

function registerFailedAttempt(ip) {
  const now = Date.now();
  const entry = loginAttempts.get(ip);
  if (!entry) {
    loginAttempts.set(ip, { count: 1, first: now });
    return;
  }
  if (now - entry.first > LOGIN_WINDOW_MS) {
    loginAttempts.set(ip, { count: 1, first: now });
    return;
  }
  entry.count += 1;
}

function clearFailedAttempts(ip) {
  loginAttempts.delete(ip);
}

// Email (SMTP)
const SMTP_HOST = process.env.SMTP_HOST || "";
const SMTP_PORT = Number(process.env.SMTP_PORT || 0);
const SMTP_USER = process.env.SMTP_USER || "";
const SMTP_PASS = process.env.SMTP_PASS || "";
const SMTP_FROM = process.env.SMTP_FROM || SMTP_USER || "";

const mailer = (SMTP_HOST && SMTP_PORT && SMTP_USER && SMTP_PASS)
  ? nodemailer.createTransport({
      host: SMTP_HOST,
      port: SMTP_PORT,
      secure: SMTP_PORT === 465,
      auth: { user: SMTP_USER, pass: SMTP_PASS },
    })
  : null;

function gerarSenhaTemporaria() {
  const n = Math.floor(100000 + Math.random() * 900000);
  return String(n);
}

async function sendResetEmail({ to, nome, senhaTemp }) {
  if (!mailer) return false;
  const subject = "AvaliaCEEP | Senha redefinida";
  const saudacao = nome ? `Olá ${nome},` : "Olá,";
  const text = [
    saudacao,
    "",
    "Recebemos e validamos sua solicitação de redefinição de senha.",
    `Sua senha temporária é: ${senhaTemp}`,
    "",
    "Por segurança, faça login e altere sua senha no primeiro acesso.",
    "Se você não solicitou esta alteração, entre em contato com nossa equipe.",
    "",
    "Equipe AvaliaCEEP"
  ].join("\n");
  const html = `
    <div style="font-family: Arial, Helvetica, sans-serif; color:#0F172A; line-height:1.5;">
      <p style="margin:0 0 12px;">${saudacao}</p>
      <p style="margin:0 0 12px;">
        Recebemos e validamos sua solicitação de redefinição de senha.
      </p>
      <p style="margin:0 0 12px;">
        Sua senha temporária é:
        <strong style="display:inline-block; padding:2px 6px; background:#EEF2FF; border-radius:6px;">
          ${senhaTemp}
        </strong>
      </p>
      <p style="margin:0 0 12px;">
        Por segurança, faça login e altere sua senha no primeiro acesso.
      </p>
      <p style="margin:0 0 18px; color:#475569; font-size:13px;">
        Se você não solicitou esta alteração, entre em contato com nosso time.
      </p>
      <div style="margin-top:18px; padding-top:12px; border-top:1px solid #E2E8F0;">
        <div style="font-size:16px; font-weight:800; color:#0F172A;">
          Avalia<span style="color:#2563EB;">CEEP</span>
        </div>
        <div style="color:#64748B; font-size:12px;">Time AvaliaCEEP</div>
      </div>
    </div>
  `;

  await mailer.sendMail({
    from: `AvaliaCEEP <${SMTP_FROM || SMTP_USER}>`,
    to,
    subject,
    text,
    html,
  });
  return true;
}

// Uploads (imagens de questões)
const UPLOAD_DIR = path.join(__dirname, "public", "uploads");
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// Auditoria simples (JSONL)
const AUDIT_LOG = path.join(__dirname, "audit.log");
function audit(req, action, meta = {}) {
  const entry = {
    at: new Date().toISOString(),
    ip: req.headers["x-forwarded-for"]?.split(",")[0]?.trim() || req.socket.remoteAddress || "unknown",
    user: req.session?.user?.matricula || null,
    perfil: req.session?.user?.perfil || null,
    action,
    meta
  };
  fs.appendFile(AUDIT_LOG, JSON.stringify(entry) + "\n", () => {});
}


// Multer (upload de imagens)
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname || "");
    cb(null, `q_${Date.now()}${ext}`);
  }
});
const upload = multer({
  storage,
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname || "").toLowerCase();
    const allowed = [".png", ".jpg", ".jpeg", ".gif", ".webp"];
    if (!allowed.includes(ext)) {
      return cb(new Error("Tipo de arquivo não permitido."));
    }
    return cb(null, true);
  }
});


function requireStaff(req, res, next) {
  if (!req.session?.user) return res.status(401).json({ ok:false, msg:"Não autenticado" });
  const p = String(req.session.user.perfil || "").trim().toLowerCase();
  if (p !== "admin" && p !== "professor") return res.status(403).json({ ok:false, msg:"Sem permissão" });
  next();
}

// Helpers
async function requireLogin(req, res, next) {
  if (!req.session?.user) return res.status(401).json({ ok: false, msg: "Não autenticado" });
  // Normaliza perfil e sincroniza com o banco (evita sessão antiga com perfil incorreto)
  try {
    const row = await db.prepare("SELECT perfil FROM users WHERE matricula=?").get(
      req.session.user.matricula
    );
    if (row?.perfil) {
      req.session.user.perfil = String(row.perfil).trim().toLowerCase();
    } else {
      req.session.user.perfil = String(req.session.user.perfil || "").trim().toLowerCase();
    }
  } catch (_) {
    req.session.user.perfil = String(req.session.user.perfil || "").trim().toLowerCase();
  }
  req.user = req.session.user;
  next();
}
function requireAdmin(req, res, next) {
  const p = String(req.session?.user?.perfil || "").trim().toLowerCase();
  if (p !== "admin") return res.status(403).json({ ok: false, msg: "Sem permissão" });
  next();
}


function requireAdminOrProfessor(req, res, next) {
  if (!req.session || !req.session.user) return res.status(401).json({ ok: false, msg: "Não autenticado." });
  const p = String(req.session.user.perfil || "").trim().toLowerCase();
  if (p !== "admin" && p !== "professor") return res.status(403).json({ ok: false, msg: "Acesso negado." });
  next();
}

// Ano do sistema (preferir o ano exibido no portal via sessão)
function anoSistema(req) {
  const ano = Number(req.session?.user?.ano) || new Date().getFullYear();
  if (req.session?.user) req.session.user.ano = ano;
  return ano;
}


function addMinutes(dtStr, minutes) {
  // dtStr: "YYYY-MM-DD HH:MM:SS" ou "YYYY-MM-DDTHH:MM"
  const s = String(dtStr || "").replace("T", " ").trim();
  if (!s) return null;

  const parts = s.split(" ");
  const d = parts[0];
  const t = parts[1] || "00:00:00";

  const dParts = d.split("-").map(Number);
  if (dParts.length !== 3 || dParts.some(n => Number.isNaN(n))) return null;
  const Y = dParts[0];
  const M = dParts[1];
  const D = dParts[2];

  const tParts = t.split(":").map(Number);
  const hh = tParts[0] || 0;
  const mm = tParts[1] || 0;
  const ss = tParts[2] || 0;

  const dt = new Date(Y, M - 1, D, hh, mm, ss);
  if (Number.isNaN(dt.getTime())) return null;

  dt.setMinutes(dt.getMinutes() + Number(minutes || 0));
  const pad = (n) => String(n).padStart(2, "0");
  return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())} ${pad(dt.getHours())}:${pad(dt.getMinutes())}:00`;
}

// Seed (cria admin/prof/aluno se não existir)
async function seed() {
  const countRow = await db.prepare("SELECT COUNT(*) as c FROM users").get();
  if ((countRow?.c || 0) > 0) return;

  const insert = db.prepare(`
    INSERT INTO users (matricula, nome, perfil, senha_hash, primeiro_acesso)
    VALUES (?, ?, ?, ?, ?)
  `);

  const seedUsers = [
    { m: "0001", n: "Administrador", p: "admin", first: 1 },
    { m: "1001", n: "Prof. Ana", p: "professor", first: 1 },
    { m: "2001", n: "Aluno João", p: "aluno", first: 1 },
  ];

  for (const u of seedUsers) {
    const hash = bcrypt.hashSync(u.m, 10); // senha inicial = matrícula
    await insert.run(u.m, u.n, u.p, hash, u.first);
  }
}

// ===== API =====

// Login
app.post("/api/login", async (req, res) => {
  const ip = req.headers["x-forwarded-for"]?.split(",")[0]?.trim() || req.socket.remoteAddress || "unknown";
  if (isRateLimited(ip)) {
    audit(req, "login.rate_limited");
    return res.status(429).json({ ok: false, msg: "Muitas tentativas. Aguarde alguns minutos." });
  }

  const matricula = String(req.body.matricula || "").trim();
  const senha = String(req.body.senha || "").trim();

  const u = await db
    .prepare("SELECT matricula, nome, perfil, senha_hash, primeiro_acesso FROM users WHERE matricula=?")
    .get(matricula);

  if (!u || !bcrypt.compareSync(senha, u.senha_hash)) {
    registerFailedAttempt(ip);
    audit(req, "login.failed", { matricula });
    return res.status(401).json({ ok: false, msg: "Matrícula ou senha inválidos" });
  }

  req.session.regenerate((err) => {
    if (err) return res.status(500).json({ ok: false, msg: "Falha ao iniciar sessão." });

    req.session.user = {
      matricula: u.matricula,
      nome: u.nome,
      perfil: String(u.perfil || "").trim().toLowerCase(),
      ano: new Date().getFullYear()
    };
    clearFailedAttempts(ip);
    audit(req, "login.success", { matricula: u.matricula });

    return res.json({
      ok: true,
      user: req.session.user,
      primeiroAcesso: u.primeiro_acesso === 1,
      primeiroAcessoTipo: u.primeiro_acesso || 0,
    });
  });
});

// Quem sou eu
app.get("/api/me", async (req, res) => {
  if (!req.session?.user) {
    return res.json({ ok: true, logged: false });
  }

  // Busca flag no banco (fonte da verdade)
  const row = await db
    .prepare("SELECT primeiro_acesso FROM users WHERE matricula=?")
    .get(req.session.user.matricula);

  return res.json({
    ok: true,
    logged: true,
    user: req.session.user,
    primeiroAcesso: row ? row.primeiro_acesso === 1 : false,
    primeiroAcessoTipo: row ? (row.primeiro_acesso || 0) : 0,
    ano: anoSistema(req),
  });
});

app.get("/api/ano", requireLogin, (req, res) => {
  return res.json({ ok: true, ano: anoSistema(req) });
});

app.put("/api/ano", requireLogin, (req, res) => {
  const ano = Number(req.body.ano || 0);
  if (!Number.isFinite(ano) || ano < 2000 || ano > 2100) {
    return res.status(400).json({ ok: false, msg: "Ano inválido." });
  }
  req.session.user = { ...req.session.user, ano };
  return res.json({ ok: true, ano });
});

app.get("/api/anos", requireLogin, async (req, res) => {
  const current = new Date().getFullYear();
  const anos = new Set([current]);
  const rows1 = await db.prepare("SELECT DISTINCT ano FROM aluno_ano").all();
  const rows2 = await db.prepare("SELECT DISTINCT ano FROM simulados").all();
  rows1.forEach(r => anos.add(Number(r.ano)));
  rows2.forEach(r => anos.add(Number(r.ano)));
  const list = Array.from(anos).filter(n => Number.isFinite(n)).sort((a, b) => b - a);
  return res.json({ ok: true, anos: list });
});

app.get("/api/perfil", requireLogin, async (req, res) => {
  const row = await db.prepare(`
    SELECT u.nome, u.matricula, u.perfil, u.data_nascimento, u.email, u.estado, u.cidade, u.endereco, u.telefone,
           a.serie AS turma
    FROM users u
    LEFT JOIN aluno_ano a
      ON a.matricula = u.matricula AND a.ano = ?
    WHERE u.matricula = ?
  `).get(anoSistema(req), req.session.user.matricula);
  return res.json({ ok: true, perfil: row || {} });
});

app.put("/api/perfil", requireLogin, async (req, res) => {
  const rawData = String(req.body.data_nascimento || "").trim();
  if (rawData && !/^\d{4}-\d{2}-\d{2}$/.test(rawData)) {
    return res.status(400).json({ ok: false, msg: "Data de nascimento inválida." });
  }

  const normalizar = (val, max) => {
    const s = String(val || "").trim();
    if (!s) return null;
    return s.slice(0, max);
  };

  const dataNascimento = rawData || null;
  const email = normalizar(req.body.email, 120);
  const estado = normalizar(req.body.estado, 2);
  const cidade = normalizar(req.body.cidade, 80);
  const endereco = normalizar(req.body.endereco, 160);
  const telefone = normalizar(req.body.telefone, 40);
  if (!dataNascimento || !email || !telefone || !estado || !cidade || !endereco) {
    return res.status(400).json({ ok: false, msg: "Preencha todos os campos obrigatórios." });
  }

  await db.prepare(`
    UPDATE users
    SET data_nascimento = ?, email = ?, estado = ?, cidade = ?, endereco = ?, telefone = ?
    WHERE matricula = ?
  `).run(dataNascimento, email, estado, cidade, endereco, telefone, req.session.user.matricula);

  return res.json({ ok: true });
});


// Logout
app.post("/api/logout", (req, res) => {
  audit(req, "logout");
  req.session.destroy(() => {
    res.clearCookie("avalia.sid");
    res.json({ ok: true });
  });
});

// Trocar senha (admin/prof obrigatório no 1º acesso)
app.post("/api/alterar-senha", requireLogin, async (req, res) => {
  const nova = String(req.body.nova || "").trim();
  if (nova.length < 4) return res.status(400).json({ ok: false, msg: "Senha muito curta" });

  const hash = bcrypt.hashSync(nova, 10);

  await db.prepare("UPDATE users SET senha_hash=?, primeiro_acesso=0 WHERE matricula=?").run(
    hash,
    req.session.user.matricula
  );

  return res.json({ ok: true });
});

// Solicitar redefinição de senha (público)
app.post("/api/password-requests", async (req, res) => {
  const matricula = String(req.body.matricula || "").trim();
  const email = String(req.body.email || "").trim();
  const perfilRaw = String(req.body.perfil || "").trim().toLowerCase();
  const perfil = (perfilRaw === "admin" || perfilRaw === "professor" || perfilRaw === "aluno") ? perfilRaw : null;

  if (!matricula || !email) {
    return res.status(400).json({ ok: false, msg: "Informe matrícula e e-mail." });
  }

  const norm = (v) => String(v || "").toLowerCase().replace(/\s+/g, " ").trim();

  const ip = req.headers["x-forwarded-for"]?.split(",")[0]?.trim() || req.socket.remoteAddress || "unknown";

  const user = await db.prepare(`
    SELECT matricula, nome, perfil, email
    FROM users
    WHERE matricula = ?
  `).get(matricula);

  const emailOk = !!user && norm(user.email) === norm(email);
  const perfilOk = !perfil || (user && String(user.perfil).toLowerCase() === perfil);
  const autoElegivel = !!user && emailOk && perfilOk;
  const smtpOk = !!mailer;
  const temEmail = !!(user && user.email);

  const statusInicial = (autoElegivel && smtpOk && temEmail) ? "resolvido" : "pendente";
  const perfilGravar = perfil || (user ? String(user.perfil).toLowerCase() : null);
  const nomeGravar = (user && user.nome) ? user.nome : "N/A";

  const insert = await db.prepare(`
    INSERT INTO password_reset_requests (nome, matricula, perfil, motivo, status, criado_ip)
    VALUES (?, ?, ?, ?, ?, ?)
    RETURNING id
  `).get(nomeGravar, matricula, perfilGravar, null, statusInicial, ip);

  let autoReset = false;
  if (autoElegivel && smtpOk && temEmail) {
    const senhaTemp = gerarSenhaTemporaria();
    const senhaHash = bcrypt.hashSync(senhaTemp, 10);
    const primeiroAcesso = 2;
    await db.prepare("UPDATE users SET senha_hash=?, primeiro_acesso=? WHERE matricula=?")
      .run(senhaHash, primeiroAcesso, matricula);

    await sendResetEmail({ to: user.email, nome: user.nome, senhaTemp });
    await db.prepare(`
      UPDATE password_reset_requests
      SET atendido_em=NOW(), atendido_por='auto', nota=?
      WHERE id=?
    `).run("Auto-validado e resetado.", insert?.id);

    autoReset = true;
    audit(req, "password_request.auto_reset", { matricula, perfil: user.perfil });
  } else {
    const nota = !autoElegivel
      ? "Dados não conferem com o cadastro (e-mail/perfil)."
      : (!temEmail ? "Sem email cadastrado." : "SMTP não configurado.");
    await db.prepare(`
      UPDATE password_reset_requests
      SET nota=?
      WHERE id=?
    `).run(nota, insert?.id);
    audit(req, "password_request.create", { matricula, perfil: perfilGravar });
  }

  if (autoReset) {
    return res.json({
      ok: true,
      msg: "Solicitação confirmada. Enviamos uma senha temporária para o e-mail cadastrado."
    });
  }

  return res.json({
    ok: true,
    msg: "Solicitação registrada. A equipe irá analisar e responder em breve."
  });
});

// Admin: listar solicitações de redefinição
app.get("/api/admin/password-requests", requireLogin, requireAdmin, async (req, res) => {
  const status = String(req.query.status || "").trim().toLowerCase();
  const filtro = (status === "pendente" || status === "resolvido" || status === "recusado") ? status : null;

  const rows = await db.prepare(`
    SELECT id, nome, matricula, perfil, motivo, status, criado_em, criado_ip, atendido_em, atendido_por, nota
    FROM password_reset_requests
    ${filtro ? "WHERE status = ?" : ""}
    ORDER BY criado_em DESC
  `).all(...(filtro ? [filtro] : []));

  return res.json({ ok: true, rows: rows || [] });
});

// Admin: resolver solicitação (resetar senha, concluir ou recusar)
app.post("/api/admin/password-requests/:id/resolve", requireLogin, requireAdmin, async (req, res) => {
  const id = Number(req.params.id || 0);
  const action = String(req.body.action || "resolver").trim().toLowerCase();
  const nota = String(req.body.nota || "").trim();
  if (!id) return res.status(400).json({ ok: false, msg: "Solicitação inválida." });

  const reqRow = await db.prepare(`
    SELECT id, matricula, perfil, status
    FROM password_reset_requests
    WHERE id = ?
  `).get(id);

  if (!reqRow) return res.status(404).json({ ok: false, msg: "Solicitação não encontrada." });
  if (reqRow.status !== "pendente") {
    return res.status(409).json({ ok: false, msg: "Solicitação já finalizada." });
  }

  let novoStatus = "resolvido";
  if (action === "recusar") novoStatus = "recusado";

  if (action === "reset") {
    const u = await db.prepare("SELECT perfil FROM users WHERE matricula=?").get(reqRow.matricula);
    if (!u) return res.status(404).json({ ok: false, msg: "Usuário não encontrado." });
    const senhaHash = bcrypt.hashSync(reqRow.matricula, 10);
    const primeiroAcesso = 2;
    await db.prepare("UPDATE users SET senha_hash=?, primeiro_acesso=? WHERE matricula=?")
      .run(senhaHash, primeiroAcesso, reqRow.matricula);
    audit(req, "password_request.reset", { matricula: reqRow.matricula });
  }

  await db.prepare(`
    UPDATE password_reset_requests
    SET status=?, atendido_em=NOW(), atendido_por=?, nota=?
    WHERE id=?
  `).run(novoStatus, req.session.user.matricula, nota || null, id);

  audit(req, "password_request.resolve", { id, status: novoStatus, action });
  return res.json({ ok: true });
});

// Admin: listar admins/professores
app.get("/api/admin/users-admin-prof", requireLogin, requireAdmin, async (req, res) => {
  const rows = await db.prepare(`
    SELECT matricula, nome, perfil, primeiro_acesso
    FROM users
    WHERE perfil IN ('admin','professor')
    ORDER BY perfil, nome
  `).all();

  res.json({ ok: true, rows });
});

// ============================================================
// ADMIN/PROF - CRUD (necessário para voltar Editar/Remover/Criar)
// ============================================================

// Admin: criar admin/professor
// Regra: senha inicial = matrícula e primeiro_acesso = 1
app.post("/api/admin/users-admin-prof", requireLogin, requireAdmin, async (req, res) => {
  const matricula = String(req.body.matricula || "").trim();
  const nome = String(req.body.nome || "").trim();
  const perfil = String(req.body.perfil || "").trim();

  if (!matricula || !nome) {
    return res.status(400).json({ ok: false, msg: "Informe matrícula e nome" });
  }
  if (perfil !== "admin" && perfil !== "professor") {
    return res.status(400).json({ ok: false, msg: "Perfil inválido" });
  }

  const existe = await db.prepare("SELECT 1 FROM users WHERE matricula=?").get(matricula);
  if (existe) {
    return res.status(409).json({ ok: false, msg: "Já existe usuário com essa matrícula" });
  }

  const senhaHash = bcrypt.hashSync(matricula, 10);

  await db.prepare(
    `INSERT INTO users (matricula, nome, perfil, senha_hash, primeiro_acesso)
     VALUES (?, ?, ?, ?, 1)`
  ).run(matricula, nome, perfil, senhaHash);

  audit(req, "user.create", { matricula, perfil });
  return res.json({ ok: true });
});

// Admin: editar admin/professor
app.put("/api/admin/users-admin-prof/:matricula", requireLogin, requireAdmin, async (req, res) => {
  const oldMat = String(req.params.matricula || "").trim();
  const matricula = String(req.body.matricula || "").trim();
  const nome = String(req.body.nome || "").trim();
  const perfil = String(req.body.perfil || "").trim();

  if (!oldMat) return res.status(400).json({ ok: false, msg: "Matrícula inválida" });
  if (!matricula || !nome) return res.status(400).json({ ok: false, msg: "Informe matrícula e nome" });
  if (perfil !== "admin" && perfil !== "professor") {
    return res.status(400).json({ ok: false, msg: "Perfil inválido" });
  }

  const atual = await db.prepare("SELECT perfil FROM users WHERE matricula=?").get(oldMat);
  if (!atual) return res.status(404).json({ ok: false, msg: "Usuário não encontrado" });

  if (atual.perfil !== "admin" && atual.perfil !== "professor") {
    return res.status(400).json({ ok: false, msg: "Somente admin/professor podem ser editados aqui" });
  }

  if (matricula !== oldMat) {
    const conflito = await db.prepare("SELECT 1 FROM users WHERE matricula=?").get(matricula);
    if (conflito) {
      return res.status(409).json({ ok: false, msg: "Já existe usuário com essa matrícula" });
    }
  }

  const tx = db.transaction(async () => {
    await db.prepare("UPDATE users SET matricula=?, nome=?, perfil=? WHERE matricula=?")
      .run(matricula, nome, perfil, oldMat);
  });

  await tx();

  // Se editou o usuário logado, atualiza a sessão
  if (req.session?.user?.matricula === oldMat) {
    req.session.user = { ...req.session.user, matricula, nome, perfil };
  }

  audit(req, "user.update", { matricula, perfil, anterior: oldMat });
  return res.json({ ok: true });
});

// Admin: remover admin/professor
// Regra: não permitir remover o último admin
app.delete("/api/admin/users-admin-prof/:matricula", requireLogin, requireAdmin, async (req, res) => {
  const matricula = String(req.params.matricula || "").trim();

  const u = await db.prepare("SELECT perfil FROM users WHERE matricula=?").get(matricula);
  if (!u) return res.status(404).json({ ok: false, msg: "Usuário não encontrado" });

  if (u.perfil !== "admin" && u.perfil !== "professor") {
    return res.status(400).json({ ok: false, msg: "Somente admin/professor podem ser removidos aqui" });
  }

  if (u.perfil === "admin") {
    const adminsRow = await db.prepare("SELECT COUNT(*) AS c FROM users WHERE perfil='admin'").get();
    const admins = adminsRow?.c || 0;
    if (admins <= 1) {
      return res.status(400).json({ ok: false, msg: "Não é possível remover o último admin" });
    }
  }

  // Evita o admin remover a si próprio acidentalmente
  if (req.session?.user?.matricula === matricula) {
    return res.status(400).json({ ok: false, msg: "Você não pode remover o usuário logado" });
  }

  await db.prepare("DELETE FROM users WHERE matricula=?").run(matricula);
  audit(req, "user.delete", { matricula });
  return res.json({ ok: true });
});


// Admin: importar alunos (CSV -> o front manda lista JSON)
app.post("/api/admin/importar-alunos", requireLogin, requireAdmin, async (req, res) => {
  const ano = anoSistema(req);
  const alunos = Array.isArray(req.body.alunos) ? req.body.alunos : [];

  const insUser = db.prepare(`
    INSERT INTO users (matricula, nome, perfil, senha_hash, primeiro_acesso)
    VALUES (?, ?, 'aluno', ?, 1)
    ON CONFLICT(matricula) DO UPDATE SET
      nome=excluded.nome,
      perfil='aluno'
  `);

  const insAno = db.prepare(`
    INSERT INTO aluno_ano (ano, matricula, serie, nome)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(ano, matricula) DO UPDATE SET
      serie=excluded.serie,
      nome=excluded.nome
  `);

  let novos = 0;
  let atualizados = 0;

  const tx = db.transaction(async () => {
    for (const a of alunos) {
      const matricula = String(a.matricula || "").trim();
      const nome = String(a.nome || "").trim();
      const serie = String(a.serie || "").trim();
      if (!matricula || !nome || !serie) continue;

      // se existe user antes?
      const existe = await db.prepare("SELECT 1 FROM users WHERE matricula=?").get(matricula);

      const hash = bcrypt.hashSync(matricula, 10);
      await insUser.run(matricula, nome, hash);

      await insAno.run(ano, matricula, serie, nome);

      if (existe) atualizados++;
      else novos++;
    }
  });

  await tx();
  audit(req, "alunos.import", { total: alunos.length, novos, atualizados, ano });
  res.json({ ok: true, ano, novos, atualizados });
});

// Admin: listar alunos do ano atual
app.get("/api/admin/alunos-ano-atual", requireLogin, requireAdminOrProfessor, async (req, res) => {
  const ano = anoSistema(req);
  const rows = await db.prepare(`
    SELECT matricula, nome, serie, ano
    FROM aluno_ano
    WHERE ano=?
    ORDER BY serie, nome
  `).all(ano);

  res.json({ ok: true, ano, rows });
});

// ===========================================
// ALUNOS - editar/remover (necessário ao front)
// ===========================================

// Admin: editar aluno (nome + série do ano atual)
// Obs: mantém user(perfil='aluno') e atualiza aluno_ano do ano vigente
app.put("/api/admin/alunos/:matricula", requireLogin, requireAdmin, async (req, res) => {
  const matricula = String(req.params.matricula || "").trim();
  const nome = String(req.body.nome || "").trim();
  const serie = String(req.body.serie || "").trim();
  const ano = anoSistema(req);

  if (!matricula) return res.status(400).json({ ok: false, msg: "Matrícula inválida" });
  if (!nome || !serie) return res.status(400).json({ ok: false, msg: "Informe nome e série" });

  const u = await db.prepare("SELECT perfil FROM users WHERE matricula=?").get(matricula);
  if (!u) return res.status(404).json({ ok: false, msg: "Aluno não encontrado" });
  if (u.perfil !== "aluno") return res.status(400).json({ ok: false, msg: "A matrícula informada não é de aluno" });

  const tx = db.transaction(async () => {
    await db.prepare("UPDATE users SET nome=?, perfil='aluno' WHERE matricula=?").run(nome, matricula);

    await db.prepare(
      `INSERT INTO aluno_ano (ano, matricula, serie, nome)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(ano, matricula) DO UPDATE SET
         serie=excluded.serie,
         nome=excluded.nome`
    ).run(ano, matricula, serie, nome);
  });

  await tx();
  return res.json({ ok: true, ano });
});

app.get("/api/admin/alunos/:matricula/perfil", requireLogin, requireAdminOrProfessor, async (req, res) => {
  const matricula = String(req.params.matricula || "").trim();
  if (!matricula) return res.status(400).json({ ok: false, msg: "Matrícula inválida" });

  const row = await db.prepare(`
    SELECT u.matricula, u.nome, u.perfil, u.data_nascimento, u.email, u.estado, u.cidade, u.endereco, u.telefone,
           a.serie AS turma, a.ano
    FROM users u
    LEFT JOIN aluno_ano a
      ON a.matricula = u.matricula AND a.ano = ?
    WHERE u.matricula = ?
  `).get(anoSistema(req), matricula);

  if (!row) return res.status(404).json({ ok: false, msg: "Aluno não encontrado" });
  return res.json({ ok: true, perfil: row });
});

// Admin: remover aluno (remove registro no users e histórico aluno_ano)
// Obs: remove todas as linhas aluno_ano da matrícula (todos os anos)
app.delete("/api/admin/alunos/:matricula", requireLogin, requireAdmin, async (req, res) => {
  const matricula = String(req.params.matricula || "").trim();

  const u = await db.prepare("SELECT perfil FROM users WHERE matricula=?").get(matricula);
  if (!u) return res.status(404).json({ ok: false, msg: "Aluno não encontrado" });
  if (u.perfil !== "aluno") return res.status(400).json({ ok: false, msg: "A matrícula informada não é de aluno" });

  const tx = db.transaction(async () => {
    await db.prepare("DELETE FROM aluno_ano WHERE matricula=?").run(matricula);
    await db.prepare("DELETE FROM users WHERE matricula=?").run(matricula);
  });

  await tx();
  return res.json({ ok: true });
});
app.get("/api/questoes", requireLogin, requireStaff, async (req, res) => {
  const ano = Number(req.query.ano || anoSistema(req));
  const allAnos = String(req.query.all_anos || "").trim() === "1";
  const search = String(req.query.search || "").trim().toLowerCase();
  const page = Math.max(1, Number(req.query.page || 1));
  // Permitimos limites menores (ex.: modal do Banco de Questões usa 5 por página)
  const limit = Math.min(50, Math.max(1, Number(req.query.limit || 20)));
  const offset = (page - 1) * limit;
  const simuladoId = Number(req.query.simulado_id || 0);

  let where = "WHERE 1=1";
  let params = [];
  if (!allAnos) {
    where += " AND q.ano = ?";
    params.push(ano);
  }

  const curso = String(req.query.curso || "").trim();
  const serie = String(req.query.serie || "").trim();
  const unidade = String(req.query.unidade || "").trim();

  if (curso) { where += " AND q.curso = ?"; params.push(curso); }
  if (serie) { where += " AND q.serie = ?"; params.push(serie); }
  if (unidade) { where += " AND q.unidade = ?"; params.push(unidade); }

  // Disciplina (preferimos disciplina_id; mantemos 'materia' por compatibilidade)
  const disciplinaId = String(req.query.disciplina_id || "").trim();
  if (disciplinaId) { where += " AND q.disciplina_id = ?"; params.push(Number(disciplinaId)); }

  const materia = String(req.query.materia || "").trim(); // legado
  if (materia) { where += " AND q.materia = ?"; params.push(materia); }

  if (search) {
    where += " AND (lower(q.enunciado) LIKE ? OR lower(q.materia) LIKE ? OR lower(q.tags) LIKE ? OR lower(d.nome) LIKE ?)";
    const s = `%${search}%`;
    params.push(s, s, s, s);
  }
  if (simuladoId) {
    where += " AND NOT EXISTS (SELECT 1 FROM simulado_questoes sq WHERE sq.simulado_id = ? AND sq.questao_id = q.id)";
    params.push(simuladoId);
  }

  const totalRow = await db.prepare(`
    SELECT COUNT(*) as c
    FROM questoes q
    LEFT JOIN disciplinas d ON d.id = q.disciplina_id
    ${where}
  `).get(...params);
  const total = Number(totalRow?.c || 0);

  const rows = await db.prepare(`
    SELECT
      q.id, q.ano, q.enunciado, q.correta,
      q.materia, q.tags,
      q.curso, q.serie, q.unidade,
      q.disciplina_id,
      d.nome AS disciplina_nome,
      q.imagem_url,
      q.criada_por_matricula,
      u.nome AS professor_nome
    FROM questoes q
    LEFT JOIN users u ON u.matricula = q.criada_por_matricula
    LEFT JOIN disciplinas d ON d.id = q.disciplina_id
    ${where}
    ORDER BY q.id DESC
    LIMIT ? OFFSET ?
  `).all(...params, limit, offset);

  res.json({ ok:true, total, page, limit, rows });
});

app.post("/api/questoes", requireLogin, requireStaff, async (req, res) => {
  const ano = Number(req.body.ano || anoSistema(req));
  const {
    enunciado, alternativa_a, alternativa_b, alternativa_c, alternativa_d, alternativa_e,
    correta, materia, tags,
    curso, serie, unidade,
    imagem_url, disciplina_id
  } = req.body;

  if (!enunciado || !alternativa_a || !alternativa_b || !alternativa_c || !alternativa_d || !correta) {
    return res.status(400).json({ ok:false, msg:"Preencha enunciado, alternativas A-D e correta." });
  }

  const info = await db.prepare(`
    INSERT INTO questoes
      (ano, enunciado, alternativa_a, alternativa_b, alternativa_c, alternativa_d, alternativa_e,
       correta, materia, tags, curso, serie, unidade, imagem_url, disciplina_id, criada_por_matricula)
    VALUES
      (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    RETURNING id
  `).get(
    ano,
    String(enunciado).trim(),
    String(alternativa_a).trim(),
    String(alternativa_b).trim(),
    String(alternativa_c).trim(),
    String(alternativa_d).trim(),
    alternativa_e ? String(alternativa_e).trim() : null,
    String(correta).trim().toUpperCase(),
    materia ? String(materia).trim() : null,
    tags ? String(tags).trim() : null,
    curso ? String(curso).trim() : null,
    serie ? String(serie).trim() : null,
    unidade ? String(unidade).trim() : null,
    imagem_url ? String(imagem_url).trim() : null,
    (disciplina_id !== undefined && disciplina_id !== null && String(disciplina_id).trim() !== "") ? Number(disciplina_id) : null,
    req.session.user.matricula
  );

  audit(req, "questao.create", { id: info?.id });
  res.json({ ok:true, id: info?.id });
});


app.put("/api/questoes/:id", requireLogin, requireStaff, async (req, res) => {
  const id = Number(req.params.id);
  const {
    enunciado, alternativa_a, alternativa_b, alternativa_c, alternativa_d, alternativa_e,
    correta, materia, tags,
    disciplina_id, imagem_url,
    serie, unidade
  } = req.body;

  const ex = await db.prepare("SELECT 1 FROM questoes WHERE id=?").get(id);
  if (!ex) return res.status(404).json({ ok:false, msg:"Questão não encontrada" });

  await db.prepare(`
    UPDATE questoes
    SET enunciado=?, alternativa_a=?, alternativa_b=?, alternativa_c=?, alternativa_d=?, alternativa_e=?,
        correta=?, materia=?, tags=?,
        disciplina_id=?, imagem_url=?, serie=?, unidade=?
    WHERE id=?
  `).run(
    String(enunciado).trim(),
    String(alternativa_a).trim(),
    String(alternativa_b).trim(),
    String(alternativa_c).trim(),
    String(alternativa_d).trim(),
    alternativa_e ? String(alternativa_e).trim() : null,
    String(correta).trim().toUpperCase(),
    materia ? String(materia).trim() : null,
    tags ? String(tags).trim() : null,
    (disciplina_id !== undefined && disciplina_id !== null && String(disciplina_id).trim() !== "") ? Number(disciplina_id) : null,
    imagem_url ? String(imagem_url).trim() : null,
    serie ? String(serie).trim() : null,
    unidade ? String(unidade).trim() : null,
    id
  );

  audit(req, "questao.update", { id });
  res.json({ ok:true });
});

app.delete("/api/questoes/:id", requireLogin, requireStaff, async (req, res) => {
  const id = Number(req.params.id);
  await db.prepare("DELETE FROM questoes WHERE id=?").run(id);
  audit(req, "questao.delete", { id });
  res.json({ ok:true });
});

app.get("/api/questoes/:id", requireLogin, requireStaff, async (req, res) => {
  const id = Number(req.params.id);
  const q = await db.prepare("SELECT * FROM questoes WHERE id=?").get(id);
  if (!q) return res.status(404).json({ ok:false, msg:"Questão não encontrada" });
  res.json({ ok:true, questao: q });
});
// Admin: resetar senha (admin reseta senha de qualquer usuário)
// Regra:
// - senha volta a ser a matrícula
// - primeiro_acesso = 1 (obriga trocar no próximo login)
app.post("/api/admin/reset-senha", requireLogin, requireAdmin, async (req, res) => {
  const matricula = String(req.body.matricula || "").trim();
  if (!matricula) return res.status(400).json({ ok: false, msg: "Informe a matrícula" });

  const u = await db.prepare("SELECT matricula, perfil FROM users WHERE matricula=?").get(matricula);
  if (!u) return res.status(404).json({ ok: false, msg: "Usuário não encontrado" });

  const senhaHash = bcrypt.hashSync(matricula, 10);
  const primeiroAcesso = 2;

  await db.prepare("UPDATE users SET senha_hash=?, primeiro_acesso=? WHERE matricula=?")
    .run(senhaHash, primeiroAcesso, matricula);

  audit(req, "user.reset_password", { matricula, perfil: u.perfil });
  return res.json({ ok: true });
});

//admin/series-disponiveis

app.get("/api/admin/simulados", requireLogin, requireStaff, async (req, res) => {
  const rows = await db.prepare(`SELECT * FROM simulados ORDER BY id DESC`).all();
  res.json({ ok: true, simulados: rows });
});

app.post("/api/admin/simulados", requireLogin, requireAdmin, async (req, res) => {
  const anoAtual = anoSistema(req);

  const {
    titulo, curso, turma, unidade,
    inicio_em, fim_em,
    duracao_min, num_questoes, valor_total
  } = req.body;

  if (!titulo || !unidade || !turma || !inicio_em || !fim_em) {
    return res.status(400).json({ ok: false, msg: "Preencha título, unidade, turma, início e fim." });
  }

  const dur = Number(duracao_min || 90);
  const num = Number(num_questoes);
  const val = Number(valor_total);

  if (!Number.isFinite(num) || num <= 0) {
    return res.status(400).json({ ok: false, msg: "Número de questões inválido." });
  }
  if (!Number.isFinite(val) || val <= 0) {
    return res.status(400).json({ ok: false, msg: "Valor total inválido." });
  }

  const info = await db.prepare(`
    INSERT INTO simulados
      (ano, titulo, unidade, turma, inicio_em, fim_em, valor_total, num_questoes, criado_por_matricula, curso, duracao_min)
    VALUES
      (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    RETURNING id
  `).get(
    anoAtual,
    titulo.trim(),
    unidade,
    turma,
    inicio_em,
    fim_em,
    val,
    num,
    req.session.user.matricula,
    curso || null,
    dur
  );

  audit(req, "simulado.create", { id: info?.id, titulo });
  res.json({ ok: true, id: info?.id });
});


app.put("/api/admin/simulados/:id", requireLogin, requireAdmin, async (req, res) => {
  const id = Number(req.params.id);

  const {
    titulo, curso, turma, unidade,
    inicio_em, fim_em,
    duracao_min, num_questoes, valor_total
  } = req.body;

  if (!titulo || !unidade || !turma || !inicio_em || !fim_em) {
    return res.status(400).json({ ok: false, msg: "Preencha título, unidade, turma, início e fim." });
  }

  const dur = Number(duracao_min || 90);
  const num = Number(num_questoes);
  const val = Number(valor_total);

  if (!Number.isFinite(num) || num <= 0) {
    return res.status(400).json({ ok: false, msg: "Número de questões inválido." });
  }
  if (!Number.isFinite(val) || val <= 0) {
    return res.status(400).json({ ok: false, msg: "Valor total inválido." });
  }

  await db.prepare(`
    UPDATE simulados
    SET titulo=?, unidade=?, turma=?, inicio_em=?, fim_em=?,
        valor_total=?, num_questoes=?, curso=?, duracao_min=?,
        atualizado_em=NOW()
    WHERE id=?
  `).run(
    titulo.trim(),
    unidade,
    turma,
    inicio_em,
    fim_em,
    val,
    num,
    curso || null,
    dur,
    id
  );

  audit(req, "simulado.update", { id, titulo });
  res.json({ ok: true });
});


app.delete("/api/admin/simulados/:id", requireLogin, requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  await db.prepare(`DELETE FROM simulados WHERE id=?`).run(id);
  audit(req, "simulado.delete", { id });
  res.json({ ok: true });
});

// ======================================================
// REPLICAR SIMULADO (Admin) - Implantação
// Regras validadas: (1) evita duplicidade, (2) bloqueia finalizado,
// (3) bloqueia sem questões, (5) sempre cria novo registro independente
// ======================================================
app.post("/api/admin/simulados/:id/replicar", requireLogin, requireAdmin, async (req, res) => {
  try {
    const simuladoId = Number(req.params.id);
    const anoAtual = anoSistema(req);
    const novaTurma = String(req.body?.turma || "").trim();

    if (!novaTurma) {
      return res.status(400).json({ ok: false, msg: "Selecione a nova turma." });
    }

    const sim = await db.prepare(`SELECT * FROM simulados WHERE id=?`).get(simuladoId);
    if (!sim) return res.status(404).json({ ok:false, msg:"Simulado não encontrado" });

    // turma diferente
    if (String(sim.turma || "").trim() === novaTurma) {
      return res.status(400).json({ ok:false, msg:"A nova turma deve ser diferente da turma atual." });
    }

   
    // (3) bloquear sem questões
    const totalRow = await db.prepare(
      `SELECT COUNT(*) AS c FROM simulado_questoes WHERE simulado_id=?`
    ).get(simuladoId);
    const totalQuestoes = Number(totalRow?.c || 0);

    if (totalQuestoes === 0) {
      return res.status(400).json({ ok:false, msg:"Não é permitido replicar um simulado sem questões." });
    }

    // (1) evitar duplicidade: mesmo ano + turma + unidade + título
    const existente = await db.prepare(`
      SELECT id FROM simulados
      WHERE ano=? AND turma=? AND unidade=? AND titulo=?
      LIMIT 1
    `).get(anoAtual, novaTurma, sim.unidade, sim.titulo);

    if (existente) {
      return res.status(400).json({
        ok:false,
        msg:"Já existe um simulado com o mesmo título e unidade para essa turma no ano atual."
      });
    }

    // cria novo simulado (mantendo as mesmas datas; status será calculado por datas)
    const info = await db.prepare(`
      INSERT INTO simulados
        (ano, titulo, unidade, turma, inicio_em, fim_em, valor_total, num_questoes, criado_por_matricula, curso, duracao_min)
      VALUES
        (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      RETURNING id
    `).get(
      anoAtual,
      sim.titulo,
      sim.unidade,
      novaTurma,
      sim.inicio_em,
      sim.fim_em,
      sim.valor_total,
      sim.num_questoes,
      req.session.user.matricula,
      sim.curso || null,
      sim.duracao_min || 90
    );

    const novoId = info?.id;

    // copiar questões mantendo ordem
    const questoes = await db.prepare(`
      SELECT questao_id, ordem
      FROM simulado_questoes
      WHERE simulado_id=?
      ORDER BY ordem ASC
    `).all(simuladoId);

    const stmt = db.prepare(`
      INSERT INTO simulado_questoes (simulado_id, questao_id, adicionada_por_matricula, ordem)
      VALUES (?, ?, ?, ?)
    `);

    for (const q of questoes) {
      await stmt.run(novoId, q.questao_id, req.session.user.matricula, q.ordem);
    }

    audit(req, "simulado.replicar", { id: simuladoId, novoId, turma: novaTurma });
    return res.json({ ok:true, id: novoId });

  } catch (e) {
    console.error("ERRO replicar simulado:", e);
    return res.status(500).json({ ok:false, msg:"Erro ao replicar simulado." });
  }
});

// ======================================================
// REAPLICAR SIMULADO (Admin)
// Reabre o mesmo simulado com novo período, mantendo bloqueio
// para quem já enviou (status = 'enviado').
// ======================================================
app.post("/api/admin/simulados/:id/reaplicar", requireLogin, async (req, res) => {
  try {
    const perfil = String(req.session?.user?.perfil || "").trim().toLowerCase();
    if (perfil !== "admin" && perfil !== "professor") {
      return res.status(403).json({ ok: false, msg: "Sem permissão." });
    }

    const simuladoId = Number(req.params.id);
    const inicio_em = String(req.body?.inicio_em || "").trim();
    const fim_em = String(req.body?.fim_em || "").trim();

    if (!inicio_em || !fim_em) {
      return res.status(400).json({ ok: false, msg: "Informe início e fim." });
    }
    if (inicio_em >= fim_em) {
      return res.status(400).json({ ok: false, msg: "O fim deve ser maior que o início." });
    }

    const sim = await db.prepare("SELECT * FROM simulados WHERE id=?").get(simuladoId);
    if (!sim) return res.status(404).json({ ok: false, msg: "Simulado não encontrado." });

    await db.prepare(`
      UPDATE simulados
      SET inicio_em=?, fim_em=?, atualizado_em=NOW()
      WHERE id=?
    `).run(inicio_em, fim_em, simuladoId);

    audit(req, "simulado.reaplicar", { id: simuladoId, inicio_em, fim_em });
    return res.json({ ok: true });
  } catch (e) {
    console.error("ERRO reaplicar simulado:", e);
    return res.status(500).json({ ok: false, msg: "Erro ao reaplicar simulado." });
  }
});



app.get("/api/admin/turmas-ano-atual", requireLogin, requireStaff, async (req, res) => {
  const anoAtual = anoSistema(req);

  const rows = await db.prepare(`
    SELECT DISTINCT serie
    FROM aluno_ano
    WHERE ano = ?
      AND serie IS NOT NULL
      AND TRIM(serie) <> ''
    ORDER BY serie
  `).all(anoAtual);

  res.json({ ok: true, turmas: rows.map(r => r.serie) });
});
// ======================================================
// SIMULADO (ABRIR) - Detalhe + Questões (Admin/Professor)
// ======================================================

function computeStatus(sim) {
  const now = new Date();
  const ini = sim.inicio_em ? new Date(String(sim.inicio_em).replace(" ", "T")) : null;
  const fim = sim.fim_em ? new Date(String(sim.fim_em).replace(" ", "T")) : null;

  if (ini && now < ini) return "Agendado";
  if (ini && fim && now >= ini && now <= fim) return "Em andamento";
  if (fim && now > fim) return "Finalizado";
  return "Agendado";
}

// Detalhe do simulado + questões vinculadas
app.get("/api/simulados/:id", requireLogin, requireStaff, async (req, res) => {
  const id = Number(req.params.id);

  const sim = await db.prepare(`SELECT * FROM simulados WHERE id=?`).get(id);
  if (!sim) return res.status(404).json({ ok:false, msg:"Simulado não encontrado" });

  const totalRow = await db.prepare(`SELECT COUNT(*) AS c FROM simulado_questoes WHERE simulado_id=?`).get(id);
  const total = Number(totalRow?.c || 0);

  const questoes = await db.prepare(`
    SELECT q.*, d.nome AS disciplina_nome, u.nome AS professor_nome
    FROM simulado_questoes sq
    JOIN questoes q ON q.id = sq.questao_id
    LEFT JOIN disciplinas d ON d.id = q.disciplina_id
    LEFT JOIN users u ON u.matricula = q.criada_por_matricula
    WHERE sq.simulado_id=?
    ORDER BY COALESCE(sq.adicionada_em, '1970-01-01 00:00:00') DESC, sq.ordem DESC
  `).all(id);

  res.json({
    ok: true,
    simulado: { ...sim, status: computeStatus(sim) },
    total_questoes: total,
    questoes
  });
});

// Função central: adiciona questão ao simulado com trava e limite
async function addQuestaoAoSimuladoTx(simuladoId, questaoId, matricula) {
  try {
    const tx = db.transaction(async () => {
      const sim = await db.prepare(
        `SELECT id, num_questoes FROM simulados WHERE id=? FOR UPDATE`
      ).get(simuladoId);
      if (!sim) {
        return { ok:false, status:404, msg:"Simulado não encontrado" };
      }

      const atualRow = await db.prepare(
        `SELECT COUNT(*) AS c FROM simulado_questoes WHERE simulado_id=?`
      ).get(simuladoId);
      const atual = Number(atualRow?.c || 0);

      if (atual >= Number(sim.num_questoes || 0)) {
        return { ok:false, status:409, msg:"Limite de questões atingido neste simulado." };
      }

      // evita duplicar
      const existe = await db.prepare(`
        SELECT 1 FROM simulado_questoes WHERE simulado_id=? AND questao_id=?
      `).get(simuladoId, questaoId);

      if (existe) {
        return { ok:false, status:409, msg:"Esta questão já está no simulado." };
      }

      // ordem: próxima posição (1..N). A tabela tem ordem NOT NULL.
      const proximaOrdem = Number(atual) + 1;

      await db.prepare(`
        INSERT INTO simulado_questoes (simulado_id, questao_id, ordem, adicionada_por_matricula, adicionada_em)
        VALUES (?, ?, ?, ?, NOW())
      `).run(simuladoId, questaoId, proximaOrdem, matricula);

      return { ok:true };
    });

    return await tx();
  } catch (e) {
    return { ok:false, status:500, msg:"Erro ao adicionar questão.", detail: String(e.message || e) };
  }
}

// Adicionar questão EXISTENTE ao simulado
app.post("/api/simulados/:id/questoes", requireLogin, requireStaff, async (req, res) => {
  const simuladoId = Number(req.params.id);
  const questaoId = Number(req.body.questao_id);

  if (!questaoId) return res.status(400).json({ ok:false, msg:"Informe questao_id" });

  const q = await db.prepare(`SELECT id FROM questoes WHERE id=?`).get(questaoId);
  if (!q) return res.status(404).json({ ok:false, msg:"Questão não encontrada" });

  const r = await addQuestaoAoSimuladoTx(simuladoId, questaoId, req.session.user.matricula);
  if (!r.ok) return res.status(r.status || 400).json({ ok:false, msg:r.msg, detail: r.detail });

  audit(req, "simulado.add_questao", { simuladoId, questaoId });
  return res.json({ ok:true });
});

// Remover questão do simulado
app.delete("/api/simulados/:id/questoes/:questaoId", requireLogin, requireStaff, async (req, res) => {
  const simuladoId = Number(req.params.id);
  const questaoId = Number(req.params.questaoId);

  await db.prepare(`DELETE FROM simulado_questoes WHERE simulado_id=? AND questao_id=?`).run(simuladoId, questaoId);
  audit(req, "simulado.remove_questao", { simuladoId, questaoId });
  res.json({ ok:true });
});

// Criar questão DENTRO do simulado (já adiciona automaticamente)
app.post("/api/simulados/:id/questoes/criar", requireLogin, requireStaff, async (req, res) => {
  const simuladoId = Number(req.params.id);

  const sim = await db.prepare(`SELECT * FROM simulados WHERE id=?`).get(simuladoId);
  if (!sim) return res.status(404).json({ ok:false, msg:"Simulado não encontrado" });

  const {
    enunciado, alternativa_a, alternativa_b, alternativa_c, alternativa_d, alternativa_e,
    correta, materia, tags,
    imagem_url, disciplina_id
  } = req.body;

  if (!enunciado || !alternativa_a || !alternativa_b || !alternativa_c || !alternativa_d || !correta) {
    return res.status(400).json({ ok:false, msg:"Preencha enunciado, alternativas A-D e correta." });
  }

  // cria questão com metadados herdados do simulado
  const info = await db.prepare(`
    INSERT INTO questoes
      (ano, enunciado, alternativa_a, alternativa_b, alternativa_c, alternativa_d, alternativa_e,
       correta, materia, tags, curso, serie, unidade, imagem_url, disciplina_id, criada_por_matricula)
    VALUES
      (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    RETURNING id
  `).get(
    sim.ano,
    String(enunciado).trim(),
    String(alternativa_a).trim(),
    String(alternativa_b).trim(),
    String(alternativa_c).trim(),
    String(alternativa_d).trim(),
    alternativa_e ? String(alternativa_e).trim() : null,
    String(correta).trim().toUpperCase(),
    materia ? String(materia).trim() : null,
    tags ? String(tags).trim() : null,
    sim.curso || null,
    sim.turma || null,      // aqui você usa turma como série (1º INFO A etc.)
    sim.unidade || null,
    imagem_url ? String(imagem_url).trim() : null,
    (disciplina_id !== undefined && disciplina_id !== null && String(disciplina_id).trim() !== "") ? Number(disciplina_id) : null,
    req.session.user.matricula
  );

  const questaoId = info?.id;

  const r = await addQuestaoAoSimuladoTx(simuladoId, questaoId, req.session.user.matricula);
  if (!r.ok) return res.status(r.status || 400).json({ ok:false, msg:r.msg, detail:r.detail });

  audit(req, "simulado.create_questao", { simuladoId, questaoId });
  res.json({ ok:true, questao_id: questaoId });
});

// Upload de imagem de questão (admin/professor)
app.post("/api/upload/questao-imagem", requireLogin, requireStaff, upload.single("imagem"), (req, res) => {
  if (!req.file) return res.status(400).json({ ok:false, msg:"Nenhuma imagem enviada." });

  // caminho público acessível pelo front
  const url = `/uploads/${req.file.filename}`;
  res.json({ ok:true, url });
});

// Tratamento de erro do Multer (upload)
app.use((err, req, res, next) => {
  if (err && err.message && err.message.includes("Tipo de arquivo")) {
    return res.status(400).json({ ok: false, msg: err.message });
  }
  if (err && err.code === "LIMIT_FILE_SIZE") {
    return res.status(400).json({ ok: false, msg: "Imagem muito grande. Limite 2MB." });
  }
  return next(err);
});

app.get("/api/disciplinas", requireStaff, async (req, res) => {
  try {
    const curso = String(req.query.curso || "").trim();
    const serie = String(req.query.serie || "").trim();
    const unidade = String(req.query.unidade || "").trim();
    const ano = Number(req.query.ano || anoSistema(req));

    const temContexto = !!(curso && serie && unidade && Number.isFinite(ano));

    if (!temContexto) {
      const rows = await db
        .prepare(`SELECT id, nome FROM disciplinas ORDER BY nome`)
        .all();
      return res.json({ ok: true, disciplinas: rows });
    }

    const rows = await db
      .prepare(
        `SELECT id, nome
         FROM disciplinas
         WHERE (curso = ? AND serie = ? AND unidade = ? AND ano = ?)
            OR (curso = '*' AND serie = '*' AND unidade = '*' AND ano = 0)
         ORDER BY nome`
      )
      .all(curso, serie, unidade, ano);

    return res.json({ ok: true, disciplinas: rows });
  } catch (e) {
    console.error("Erro ao listar disciplinas:", e);
    return res.status(500).json({ ok: false, erro: "Erro ao listar disciplinas" });
  }
});

app.post("/api/disciplinas", requireStaff, async (req, res) => {
  try {
    const nome = String(req.body.nome || "").trim();
    if (!nome) {
      return res.status(400).json({ ok: false, erro: "Informe o nome da disciplina." });
    }

    // Disciplinas globais: válidas para todas as turmas/cursos
    const info = await db
      .prepare(
        `INSERT INTO disciplinas (nome, curso, serie, unidade, ano)
         VALUES (?, '*', '*', '*', 0)
         RETURNING id`
      )
      .get(nome);

    return res.json({ ok: true, id: info?.id, nome });
  } catch (e) {
    console.error("Erro ao cadastrar disciplina:", e);
    return res.status(500).json({ ok: false, erro: "Erro ao cadastrar disciplina" });
  }
});

// Migração simples: transforma disciplinas antigas em globais
app.post("/api/admin/disciplinas/migrar-global", requireLogin, requireAdmin, async (req, res) => {
  try {
    const r = await db.prepare(`
      UPDATE disciplinas
      SET curso='*', serie='*', unidade='*', ano=0
      WHERE curso <> '*' OR serie <> '*' OR unidade <> '*' OR ano <> 0
    `).run();
    res.json({ ok: true, updated: r.rowCount || 0 });
  } catch (e) {
    console.error("Erro ao migrar disciplinas:", e);
    res.status(500).json({ ok: false, msg: "Erro ao migrar disciplinas." });
  }
});

// ==========================================================
// ALUNO — SIMULADOS (implantação)
// Regras:
// - só aparece no horário agendado (inicio_em <= agora <= fim_em)
// - questões embaralhadas por tentativa
// - 1 questão por vez
// - registrar avisos (troca de aba/janela/sair) e encerrar com 3 avisos
// ==========================================================

function nowSql() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function shuffleArray(arr) {
  // Fisher-Yates
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

async function finalizeTentativa(tentativaId, motivo) {
  const t = await db
    .prepare(
      `SELECT t.*, s.valor_total, s.num_questoes
       FROM tentativas t
       JOIN simulados s ON s.id = t.simulado_id
       WHERE t.id = ?`
    )
    .get(tentativaId);

  if (!t) return { ok: false, status: 404, msg: "Tentativa não encontrada" };
  if (t.status !== 'em_andamento') {
    return {
      ok: true,
      tentativa: {
        id: t.id,
        status: t.status,
        acertos: t.acertos || 0,
        nota: t.nota || 0,
      },
    };
  }

  const row = await db
    .prepare(
      `SELECT COALESCE(SUM(correta), 0) AS acertos
       FROM tentativa_respostas
       WHERE tentativa_id = ?`
    )
    .get(tentativaId);

  const acertos = Number(row?.acertos || 0);
  const total = Number(t.num_questoes || 0) || 1;
  const valorTotal = Number(t.valor_total || 0);
  const nota = Number(((acertos / total) * valorTotal).toFixed(2));

  const statusFinal = (motivo === 'envio') ? 'enviado' : 'expirado';
  await db.prepare(
    `UPDATE tentativas
     SET status = ?, acertos = ?, nota = ?, finalizado_em = NOW()
     WHERE id = ?`
  ).run(statusFinal, acertos, nota, tentativaId);

  if (motivo !== 'envio') {
    await db.prepare(
      `UPDATE tentativas
       SET bloqueado = 1, bloqueado_motivo = ?, bloqueado_em = NOW()
       WHERE id = ?`
    ).run(motivo, tentativaId);
  }

  return {
    ok: true,
    tentativa: { id: tentativaId, status: statusFinal, acertos, nota },
  };
}

// Lista simulados disponíveis para o aluno (somente no horário)
app.get('/api/aluno/simulados', requireLogin, async (req, res) => {
  try {
    if (req.session.user.perfil !== 'aluno') {
      return res.status(403).json({ ok: false, msg: 'Sem permissão' });
    }

    const ano = anoSistema(req);
    const matricula = req.session.user.matricula;

    const aluno = await db
      .prepare('SELECT serie FROM aluno_ano WHERE ano = ? AND matricula = ?')
      .get(ano, matricula);

    const turma = aluno?.serie;
    if (!turma) return res.json({ ok: true, rows: [], turma: null });

    const agora = nowSql();

    const rows = await db.prepare(`
      SELECT s.id, s.titulo, s.unidade, s.curso, s.turma, s.inicio_em, s.fim_em,
             s.duracao_min, s.num_questoes, s.valor_total
      FROM simulados s
      WHERE s.ano = ?
        AND s.turma = ?
      ORDER BY s.inicio_em DESC, s.id DESC
    `).all(ano, turma);

    const out = [];
    for (const s of rows) {
      let t = null;
      let bloqueado = null;

      // Se a tabela tentativas ainda não existir, não pode quebrar o sistema.
      try {
        t = await db.prepare(`
          SELECT id, status, termina_em, avisos
          FROM tentativas
          WHERE simulado_id = ? AND ${tentativasAlunoCol()} = ?
          ORDER BY id DESC
          LIMIT 1
        `).get(s.id, matricula);
        bloqueado = await db.prepare(`
          SELECT 1
          FROM tentativas
          WHERE simulado_id = ? AND ${tentativasAlunoCol()} = ? AND bloqueado = 1 AND liberado_em IS NULL
          LIMIT 1
        `).get(s.id, matricula);
      } catch (e) {
        // ignora: banco ainda sem tentativas
        t = null;
        bloqueado = null;
      }

      const temAndamento = t && t.status === 'em_andamento';
      const ini = s.inicio_em;
      const fim = s.fim_em;
      const agendado = ini && agora < ini;
      const emAndamento = ini && fim && agora >= ini && agora <= fim;
      const finalizado = fim && agora > fim;
      const statusSimulado = bloqueado ? "Bloqueado" : (emAndamento ? "Em andamento" : (agendado ? "Agendado" : (finalizado ? "Finalizado" : "Agendado")));
      const podeIniciar = !bloqueado && emAndamento;

      out.push({
        ...s,
        tentativa: t ? { id: t.id, status: t.status, termina_em: t.termina_em, avisos: t.avisos } : null,
        acao: temAndamento ? 'continuar' : (podeIniciar ? 'iniciar' : 'indisponivel'),
        status_simulado: statusSimulado,
        pode_iniciar: podeIniciar,
      });
    }

    return res.json({ ok: true, rows: out, turma });
  } catch (e) {
    console.error('ERRO /api/aluno/simulados:', e);
    return res.status(500).json({ ok: false, msg: 'Erro ao carregar simulados.' });
  }
});


// Iniciar ou continuar uma tentativa
app.post('/api/aluno/simulados/:id/iniciar', requireLogin, async (req, res) => {
  try {
    if (req.session.user.perfil !== 'aluno') {
      return res.status(403).json({ ok: false, msg: 'Sem permissão' });
    }

    const simuladoId = Number(req.params.id);
    const matricula = req.session.user.matricula;

    // 🔒 Se está bloqueado, não pode iniciar
    const bloqueado = await db.prepare(`
      SELECT 1
      FROM tentativas
      WHERE simulado_id = ? AND ${tentativasAlunoCol()} = ? AND bloqueado = 1 AND liberado_em IS NULL
      LIMIT 1
    `).get(simuladoId, matricula);

    if (bloqueado) {
      return res.status(403).json({
        ok: false,
        error: "SIMULADO_BLOQUEADO",
        msg: "Você está bloqueado neste simulado. Aguarde liberação do professor."
      });
    }

    // 🔒 Se já enviou este simulado, não pode refazer
    const jaEnviado = await db.prepare(`
      SELECT id
      FROM tentativas
      WHERE simulado_id = ? AND ${tentativasAlunoCol()} = ? AND status = 'enviado'
      LIMIT 1
    `).get(simuladoId, matricula);

    if (jaEnviado) {
      return res.status(409).json({
        ok: false,
        error: "SIMULADO_JA_CONCLUIDO",
        msg: "Você já concluiu este simulado e não pode refazer."
      });
    }


    // ✅ Ano letivo real do aluno (não depende do relógio do PC)
    const rowAno = await db.prepare(`
      SELECT MAX(ano) AS ano
      FROM aluno_ano
      WHERE matricula = ?
    `).get(matricula);

    const ano = Number(rowAno?.ano || 0);
    if (!ano) {
      return res.status(400).json({ ok: false, msg: 'Aluno sem ano letivo cadastrado.' });
    }

    const aluno = await db
      .prepare('SELECT serie FROM aluno_ano WHERE ano = ? AND matricula = ?')
      .get(ano, matricula);

    const turma = aluno?.serie;
    if (!turma) {
      return res.status(400).json({ ok: false, msg: 'Aluno sem turma no ano atual.' });
    }

    const simulado = await db.prepare(`
      SELECT *
      FROM simulados
      WHERE id = ? AND ano = ? AND turma = ?
    `).get(simuladoId, ano, turma);

    if (!simulado) {
      return res.status(404).json({ ok: false, msg: 'Simulado não encontrado para sua turma.' });
    }

    const agora = nowSql();
    if (!(simulado.inicio_em <= agora && simulado.fim_em >= agora)) {
      return res.status(400).json({ ok: false, msg: 'Simulado fora do horário agendado.' });
    }

    // ✅ Se já existe tentativa em andamento e dentro do tempo: continuar
    const existente = await db.prepare(`
      SELECT *
      FROM tentativas
      WHERE simulado_id = ? AND ${tentativasAlunoCol()} = ?
      ORDER BY id DESC
      LIMIT 1
    `).get(simuladoId, matricula);

    if (existente && existente.status === 'em_andamento') {
      if (agora > existente.termina_em) {
        const fin = await finalizeTentativa(existente.id, 'tempo');
        return res.json({ ok: true, finalizado: true, ...fin });
      }
      return res.json({ ok: true, tentativaId: existente.id, continuar: true });
    }

    // ✅ Busca questões do simulado
    const questoesRows = await db.prepare(`
      SELECT questao_id
      FROM simulado_questoes
      WHERE simulado_id = ?
      ORDER BY ordem ASC
    `).all(simuladoId);
    const questoes = questoesRows.map(r => r.questao_id);

    if (!questoes.length) {
      return res.status(400).json({ ok: false, msg: 'Este simulado não possui questões.' });
    }

    const embaralhadas = shuffleArray(questoes);
    const terminaEm = addMinutes(agora, Number(simulado.duracao_min || 90));

    if (!terminaEm) {
      return res.status(500).json({ ok: false, msg: 'Erro ao calcular tempo do simulado.' });
    }

    const info = await insertTentativa(simuladoId, matricula, terminaEm, JSON.stringify(embaralhadas), agora);

    return res.json({ ok: true, tentativaId: info?.id, continuar: false });

  } catch (e) {
    console.error('ERRO /api/aluno/simulados/:id/iniciar:', e);
    return res.status(500).json({ ok: false, msg: 'Erro ao iniciar simulado.' });
  }
});



// Info da tentativa (contador, progresso)
app.get('/api/aluno/tentativas/:id', requireLogin, async (req, res) => {
  if (req.session.user.perfil !== 'aluno') {
    return res.status(403).json({ ok: false, msg: 'Sem permissão' });
  }
  const tentativaId = Number(req.params.id);
  const matricula = req.session.user.matricula;

  const t = await db
    .prepare(
      `SELECT t.*, s.titulo, s.unidade, s.valor_total, s.num_questoes, s.duracao_min
       FROM tentativas t
       JOIN simulados s ON s.id = t.simulado_id
       WHERE t.id = ? AND t.${tentativasAlunoCol()} = ?`
    )
    .get(tentativaId, matricula);

  if (!t) return res.status(404).json({ ok: false, msg: 'Tentativa não encontrada' });

  const agora = nowSql();
  if (t.status === 'em_andamento' && agora > t.termina_em) {
    const fin = await finalizeTentativa(tentativaId, 'tempo');
    return res.json({ ok: true, finalizado: true, ...fin });
  }

  const ordem = JSON.parse(t.ordem_json || '[]');
  const respondidasRow = await db
    .prepare(`SELECT COUNT(*) AS c FROM tentativa_respostas WHERE tentativa_id = ?`)
    .get(tentativaId);
  const respondidas = Number(respondidasRow?.c || 0);

  return res.json({
    ok: true,
    tentativa: {
      id: t.id,
      simulado_id: t.simulado_id,
      titulo: t.titulo,
      unidade: t.unidade,
      status: t.status,
      avisos: t.avisos,
      termina_em: t.termina_em,
      total: ordem.length,
      respondidas,
      acertos: t.acertos,
      nota: t.nota,
      valor_total: t.valor_total,
    },
  });
});

// Buscar questão N (1 por vez)
app.get('/api/aluno/tentativas/:id/questoes/:n', requireLogin, async (req, res) => {
  if (req.session.user.perfil !== 'aluno') {
    return res.status(403).json({ ok: false, msg: 'Sem permissão' });
  }
  const tentativaId = Number(req.params.id);
  const n = Number(req.params.n);
  const matricula = req.session.user.matricula;

  const t = await db
    .prepare(`SELECT * FROM tentativas WHERE id = ? AND ${tentativasAlunoCol()} = ?`)
    .get(tentativaId, matricula);
  if (!t) return res.status(404).json({ ok: false, msg: 'Tentativa não encontrada' });

  const agora = nowSql();
  if (t.status === 'em_andamento' && agora > t.termina_em) {
    const fin = await finalizeTentativa(tentativaId, 'tempo');
    return res.json({ ok: true, finalizado: true, ...fin });
  }

  if (t.status !== 'em_andamento') {
    return res.json({ ok: true, finalizado: true, tentativa: { id: t.id, status: t.status, acertos: t.acertos, nota: t.nota } });
  }

  const ordem = JSON.parse(t.ordem_json || '[]');
  if (!ordem.length) return res.status(400).json({ ok: false, msg: 'Ordem de questões inválida.' });

  const idx = n - 1;
  if (idx < 0 || idx >= ordem.length) {
    return res.status(400).json({ ok: false, msg: 'Questão inválida.' });
  }

  const questaoId = ordem[idx];
  const q = await db
    .prepare(
      `SELECT q.id, q.enunciado, q.alternativa_a, q.alternativa_b, q.alternativa_c, q.alternativa_d, q.alternativa_e,
              q.imagem_url, d.nome AS disciplina_nome, q.materia
       FROM questoes q
       LEFT JOIN disciplinas d ON d.id = q.disciplina_id
       WHERE q.id = ?`
    )
    .get(questaoId);
  if (!q) return res.status(404).json({ ok: false, msg: 'Questão não encontrada.' });

  const r = await db
    .prepare(`SELECT marcada FROM tentativa_respostas WHERE tentativa_id = ? AND questao_id = ?`)
    .get(tentativaId, questaoId);

  return res.json({
    ok: true,
    questao: {
      ...q,
      marcada: r?.marcada || null,
    },
    progresso: { atual: n, total: ordem.length },
  });
});

// Responder questão (salva/atualiza)
app.post('/api/aluno/tentativas/:id/responder', requireLogin, async (req, res) => {
  if (req.session.user.perfil !== 'aluno') {
    return res.status(403).json({ ok: false, msg: 'Sem permissão' });
  }
  const tentativaId = Number(req.params.id);
  const matricula = req.session.user.matricula;
  const questaoId = Number(req.body.questao_id);
  const marcada = String(req.body.marcada || '').trim().toUpperCase();

  const t = await db.prepare(`SELECT * FROM tentativas WHERE id = ? AND ${tentativasAlunoCol()} = ?`).get(tentativaId, matricula);
  if (!t) return res.status(404).json({ ok: false, msg: 'Tentativa não encontrada.' });

  const agora = nowSql();
  if (t.status === 'em_andamento' && agora > t.termina_em) {
    const fin = await finalizeTentativa(tentativaId, 'tempo');
    return res.json({ ok: true, finalizado: true, ...fin });
  }
  if (t.status !== 'em_andamento') return res.status(400).json({ ok: false, msg: 'Tentativa já finalizada.' });

  if (!questaoId || !['A','B','C','D','E'].includes(marcada)) {
    return res.status(400).json({ ok: false, msg: 'Resposta inválida.' });
  }

  const correta = await db.prepare('SELECT correta FROM questoes WHERE id = ?').get(questaoId);
  if (!correta) return res.status(404).json({ ok: false, msg: 'Questão não encontrada.' });

  const isCorreta = correta.correta === marcada ? 1 : 0;

  // ✅ ordem (NOT NULL em alguns bancos): posição da questão dentro da tentativa
  let ordem = null;
  try {
    const arr = JSON.parse(t.ordem_json || "[]");
    const idx = arr.indexOf(questaoId);
    if (idx >= 0) ordem = idx + 1;
  } catch(_) {}
  if (!ordem) ordem = 1;

  await db.prepare(
    `INSERT INTO tentativa_respostas (tentativa_id, questao_id, ordem, marcada, correta)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(tentativa_id, questao_id)
     DO UPDATE SET ordem=excluded.ordem, marcada=excluded.marcada, correta=excluded.correta, respondida_em=NOW()`
  ).run(tentativaId, questaoId, ordem, marcada, isCorreta);

  return res.json({ ok: true });
});

// Registrar aviso (troca de aba/janela/sair). Com 3 avisos encerra.
app.post('/api/aluno/tentativas/:id/aviso', requireLogin, async (req, res) => {
  if (req.session.user.perfil !== 'aluno') {
    return res.status(403).json({ ok: false, msg: 'Sem permissão' });
  }
  const tentativaId = Number(req.params.id);
  const matricula = req.session.user.matricula;

  const t = await db.prepare(`SELECT * FROM tentativas WHERE id = ? AND ${tentativasAlunoCol()} = ?`).get(tentativaId, matricula);
  if (!t) return res.status(404).json({ ok: false, msg: 'Tentativa não encontrada.' });
  if (t.status !== 'em_andamento') {
    return res.json({ ok: true, encerrado: true, tentativa: { id: t.id, status: t.status, acertos: t.acertos, nota: t.nota, avisos: t.avisos } });
  }

  const novo = Number(t.avisos || 0) + 1;
  await db.prepare('UPDATE tentativas SET avisos = ? WHERE id = ?').run(novo, tentativaId);

  if (novo >= 3) {
    const fin = await finalizeTentativa(tentativaId, 'avisos');
    return res.json({ ok: true, encerrado: true, avisos: novo, ...fin });
  }

  return res.json({ ok: true, encerrado: false, avisos: novo });
});

// Enviar simulado
app.post('/api/aluno/tentativas/:id/enviar', requireLogin, async (req, res) => {
  if (req.session.user.perfil !== 'aluno') {
    return res.status(403).json({ ok: false, msg: 'Sem permissão' });
  }

  const tentativaId = Number(req.params.id);
  const matricula = req.session.user.matricula;

  const t = await db.prepare(
    `SELECT * FROM tentativas WHERE id = ? AND ${tentativasAlunoCol()} = ?`
  ).get(tentativaId, matricula);

  if (!t) return res.status(404).json({ ok: false, msg: 'Tentativa não encontrada.' });

  // total de questões
  const ordem = JSON.parse(t.ordem_json || '[]');
  const total = ordem.length;

  // quantas marcadas (marcada não nula)
  const marcadasRow = await db.prepare(`
    SELECT COUNT(*) AS c
    FROM tentativa_respostas
    WHERE tentativa_id = ?
      AND marcada IS NOT NULL
  `).get(tentativaId);
  const marcadas = Number(marcadasRow?.c || 0);

  if (marcadas < total) {
    return res.status(400).json({
      ok: false,
      msg: `Você ainda não marcou todas as questões (${marcadas}/${total}).`
    });
  }

  const fin = await finalizeTentativa(tentativaId, 'envio');
  return res.json(fin);
});

// Acertos por disciplina (resultado do aluno)
app.get('/api/aluno/tentativas/:id/disciplinas', requireLogin, async (req, res) => {
  try {
    if (req.session.user.perfil !== 'aluno') {
      return res.status(403).json({ ok: false, msg: 'Sem permissão' });
    }

    const tentativaId = Number(req.params.id);
    const matricula = req.session.user.matricula;
    const t = await db.prepare(
      `SELECT id FROM tentativas WHERE id = ? AND ${tentativasAlunoCol()} = ?`
    ).get(tentativaId, matricula);

    if (!t) return res.status(404).json({ ok: false, msg: 'Tentativa não encontrada.' });

    const rows = await db.prepare(`
      SELECT
        COALESCE(d.nome, 'Sem disciplina') AS disciplina,
        SUM(tr.correta) AS acertos,
        COUNT(tr.questao_id) AS total
      FROM tentativa_respostas tr
      JOIN questoes q ON q.id = tr.questao_id
      LEFT JOIN disciplinas d ON d.id = q.disciplina_id
      WHERE tr.tentativa_id = ?
      GROUP BY COALESCE(d.nome, 'Sem disciplina')
      ORDER BY disciplina
    `).all(tentativaId);

    return res.json({ ok: true, rows: rows || [] });
  } catch (e) {
    console.error('Erro acertos por disciplina:', e);
    return res.status(500).json({ ok: false, msg: 'Erro ao carregar acertos por disciplina.' });
  }
});

// ==============================
// ALUNO — RESULTADOS (histórico)
// ==============================
// Lista todas as tentativas finalizadas do aluno no ano atual.
// Campos: simulado, unidade, data realizada, acertos e nota.
app.get('/api/aluno/resultados', requireLogin, async (req, res) => {
  try {
    if (req.session.user.perfil !== 'aluno') {
      return res.status(403).json({ ok: false, msg: 'Acesso negado.' });
    }

    const matricula = req.session.user.matricula;

    const sql = `
      SELECT
        s.titulo,
        s.unidade,
        COALESCE(t.finalizado_em, t.iniciado_em) as realizado_em,
        COALESCE(t.acertos, 0) as acertos,
        COALESCE(s.num_questoes, 0) as total,
        COALESCE(t.nota, 0) as nota
      FROM tentativas t
      JOIN simulados s ON s.id = t.simulado_id
      WHERE t.${tentativasAlunoCol()} = ?
        AND t.status = 'enviado'
      ORDER BY realizado_em DESC
    `;

    const rows = await db.prepare(sql).all(matricula);
    return res.json({ ok: true, rows });
  } catch (e) {
    console.error('Erro /api/aluno/resultados:', e);
    return res.status(500).json({ ok: false, msg: 'Erro ao carregar resultados.' });
  }
});

// ==============================
// RELATÓRIOS (ADMIN / PROFESSOR)
// ==============================


app.get("/api/admin/relatorios/unidades", requireLogin, requireAdminOrProfessor, async (req, res) => {
  try {
    const ano = Number(req.query.ano || anoSistema(req));
    const rows = await db.prepare(`SELECT DISTINCT unidade FROM simulados WHERE ano = ? ORDER BY unidade`).all(ano);
    res.json({ ok: true, unidades: (rows || []).map(r => r.unidade).filter(Boolean) });
  } catch (e) {
    console.error("Erro unidades:", e);
    res.status(500).json({ ok: false, msg: "Erro ao buscar unidades." });
  }
});



app.get("/api/admin/relatorios/turmas", requireLogin, requireAdminOrProfessor, async (req, res) => {
  try {
    const ano = Number(req.query.ano || anoSistema(req));
    const unidade = String(req.query.unidade || "").trim();
    if (!unidade) return res.status(400).json({ ok: false, msg: "Informe a unidade." });

    const rows = await db.prepare(
      `SELECT DISTINCT turma FROM simulados WHERE ano = ? AND unidade = ? ORDER BY turma`
    ).all(ano, unidade);

    res.json({ ok: true, turmas: (rows || []).map(r => r.turma).filter(Boolean) });
  } catch (e) {
    console.error("Erro turmas:", e);
    res.status(500).json({ ok: false, msg: "Erro ao buscar turmas." });
  }
});



app.get("/api/admin/relatorios/simulados", requireLogin, requireAdminOrProfessor, async (req, res) => {
  try {
    const ano = Number(req.query.ano || anoSistema(req));
    const unidade = String(req.query.unidade || "").trim();
    const turma = String(req.query.turma || "").trim();

    if (!unidade) return res.status(400).json({ ok: false, msg: "Informe a unidade." });
    if (!turma) return res.status(400).json({ ok: false, msg: "Informe a turma." });

    const rows = await db.prepare(`
      SELECT id, titulo, inicio_em, fim_em, num_questoes, valor_total
      FROM simulados
      WHERE ano = ? AND unidade = ? AND turma = ?
      ORDER BY inicio_em DESC, id DESC
    `).all(ano, unidade, turma);

    res.json({ ok: true, simulados: rows || [] });
  } catch (e) {
    console.error("Erro simulados:", e);
    res.status(500).json({ ok: false, msg: "Erro ao buscar simulados." });
  }
});



app.get("/api/admin/relatorios/simulado/:id", requireLogin, requireAdminOrProfessor, async (req, res) => {
  try {
    if (req.user.perfil !== "admin" && req.user.perfil !== "professor") {
      return res.status(403).json({ ok: false, msg: "Acesso negado." });
    }

    const simuladoId = Number(req.params.id || 0);
    if (!simuladoId) return res.status(400).json({ ok: false, msg: "Simulado inválido." });

    const sim = await db.prepare("SELECT * FROM simulados WHERE id = ?").get(simuladoId);
    if (!sim) return res.status(404).json({ ok: false, msg: "Simulado não encontrado." });

    const ano = Number(sim.ano || anoSistema(req));
    const turma = String(sim.turma || "").trim();

    // Lista TODOS os alunos da turma, e cruza com tentativas do simulado.
    const alunos = await db.prepare(`
      SELECT matricula, nome
      FROM aluno_ano
      WHERE ano = ? AND serie = ?
      ORDER BY LOWER(nome)
    `).all(ano, turma);

    // Monta o SELECT dinamicamente para evitar erro "no such column".
    const tentativasSql = `
      SELECT id, aluno_matricula, status, acertos, nota, iniciado_em, finalizado_em
      FROM tentativas
      WHERE simulado_id = ?
    `;
    const tentativas = await db.prepare(tentativasSql).all(simuladoId);

    const isEnviado = (x) => String(x?.status || "") === "enviado";
    const dtKey = (x) => String(x?.finalizado_em || x?.iniciado_em || "");

    // Mapa: matricula -> tentativa "melhor" (prioriza ENVIADA e mais recente)
    const mapT = new Map();
    for (const t of tentativas) {
      const key = String(t.aluno_matricula);
      const atual = mapT.get(key);
      if (!atual) { mapT.set(key, t); continue; }

      if (isEnviado(t) && !isEnviado(atual)) { mapT.set(key, t); continue; }
      if (!isEnviado(t) && isEnviado(atual)) continue;

      if (dtKey(t) > dtKey(atual)) { mapT.set(key, t); continue; }
      if (dtKey(t) === dtKey(atual) && Number(t.id) > Number(atual.id)) {
        mapT.set(key, t);
      }
    }

    const rows = alunos.map((a) => {
      const t = mapT.get(String(a.matricula));
      const realizou = !!t && isEnviado(t);
      const dataRealizada = t ? (t.finalizado_em || t.iniciado_em || null) : null;
      let tempoGastoMin = null;
      if (t?.iniciado_em && t?.finalizado_em) {
        const ini = new Date(t.iniciado_em);
        const fim = new Date(t.finalizado_em);
        if (!Number.isNaN(ini.getTime()) && !Number.isNaN(fim.getTime())) {
          const diffMs = Math.max(0, fim - ini);
          tempoGastoMin = Math.round(diffMs / 60000);
        }
      }

      return {
        nome: a.nome,
        matricula: a.matricula,
        data_realizada: realizou ? dataRealizada : null,
        acertos: realizou ? Number(t.acertos || 0) : null,
        nota: realizou ? Number(t.nota || 0) : null,
        tempo_gasto_min: realizou ? tempoGastoMin : null,
        status: realizou ? "Realizou" : "Não realizou",
      };
    });

    const realizaram = rows.filter(r => r.status === "Realizou").length;

    res.json({
      ok: true,
      simulado: {
        id: sim.id,
        titulo: sim.titulo,
        unidade: sim.unidade,
        turma: sim.turma,
        curso: sim.curso,
        inicio_em: sim.inicio_em,
        fim_em: sim.fim_em,
        num_questoes: sim.num_questoes,
        valor_total: sim.valor_total,
        duracao_min: sim.duracao_min
      },
      resumo: {
        total_alunos: rows.length,
        realizaram,
        nao_realizaram: rows.length - realizaram
      },
      rows
    });
  } catch (e) {
    console.error("Relatório simulado (admin/prof) erro:", e);
    res.status(500).json({ ok: false, msg: "Erro interno (relatório do simulado)." });
  }
});


app.get("/api/admin/relatorios/comparativo-series", requireLogin, requireAdminOrProfessor, async (req, res) => {
  try {
    if (req.user.perfil !== "admin" && req.user.perfil !== "professor") {
      return res.status(403).json({ ok: false, msg: "Acesso negado." });
    }

    const ano = Number(req.query.ano || anoSistema(req));
    const serie = String(req.query.serie || "").trim(); // "1", "2", "3" ou "" (todas)

    const whereSerie = serie ? ` AND a.serie LIKE ? ` : "";
    const params = serie ? [ano, ano, `${serie}%`] : [ano, ano];

    const rows = await db.prepare(`
      SELECT
        a.serie AS turma,
        ROUND(AVG(t.nota)::numeric, 2) AS media,
        COUNT(t.id) AS tentativas_enviadas
      FROM tentativas t
      JOIN aluno_ano a
        ON a.matricula = t.${tentativasAlunoCol()}
       AND a.ano = ?
      JOIN simulados s
        ON s.id = t.simulado_id
       AND s.ano = ?
      WHERE t.status = 'enviado'
      ${whereSerie}
      GROUP BY a.serie
      ORDER BY a.serie
    `).all(...params);

    res.json({ ok: true, rows });
  } catch (e) {
    console.error("Comparativo por série erro:", e);
    res.status(500).json({ ok: false, msg: "Erro interno (comparativo por série)." });
  }
});

// Desempenho por disciplina por aluno (admin/professor)
app.get("/api/admin/relatorios/desempenho-disciplina-alunos", requireLogin, requireAdminOrProfessor, async (req, res) => {
  try {
    const ano = Number(req.query.ano || anoSistema(req));
    const unidade = String(req.query.unidade || "").trim();
    const turma = String(req.query.turma || "").trim();
    const disciplinaId = String(req.query.disciplina_id || "").trim();

    if (!unidade || !turma || !disciplinaId) {
      return res.status(400).json({ ok: false, msg: "Informe unidade, turma e disciplina." });
    }

    const alunoCol = tentativasAlunoCol();

    const rows = await db.prepare(`
      SELECT
        a.nome AS aluno,
        SUM(tr.correta) AS acertos,
        COUNT(tr.questao_id) AS total,
        ROUND(
          (
            CASE WHEN COUNT(tr.questao_id) > 0
              THEN (SUM(tr.correta) * 100.0 / COUNT(tr.questao_id))
              ELSE 0
            END
          )::numeric, 2
        ) AS aproveitamento
      FROM tentativas t
      JOIN simulados s ON s.id = t.simulado_id
      JOIN tentativa_respostas tr ON tr.tentativa_id = t.id
      JOIN questoes q ON q.id = tr.questao_id
      LEFT JOIN aluno_ano a ON a.matricula = t.${alunoCol} AND a.ano = ?
      WHERE t.status = 'enviado'
        AND s.ano = ?
        AND s.unidade = ?
        AND s.turma = ?
        AND q.disciplina_id = ?
      GROUP BY a.matricula, a.nome
      ORDER BY aproveitamento DESC, aluno ASC
    `).all(ano, ano, unidade, turma, Number(disciplinaId));

    res.json({ ok: true, rows: rows || [] });
  } catch (e) {
    console.error("Desempenho disciplina alunos erro:", e);
    res.status(500).json({ ok: false, msg: "Erro interno (desempenho por disciplina)." });
  }
});

app.get("/api/admin/relatorios/ranking", requireLogin, requireAdminOrProfessor, async (req, res) => {
  try {
    const ano = Number(req.query.ano || anoSistema(req));
    const serie = String(req.query.serie || "").trim();
    const unidade = String(req.query.unidade || "").trim();

    const alunoCol = tentativasAlunoCol();
    const params = [ano, ano];
    let where = "WHERE t.status = 'enviado'";
    if (serie) {
      where += " AND a.serie LIKE ?";
      params.push(`${serie}%`);
    }
    if (unidade) {
      where += " AND s.unidade = ?";
      params.push(unidade);
    }

    const rows = await db.prepare(`
      SELECT
        a.nome AS nome,
        a.serie AS turma,
        MAX(s.curso) AS curso,
        ROUND(AVG(t.nota)::numeric, 2) AS media,
        COUNT(t.id) AS tentativas
      FROM tentativas t
      JOIN aluno_ano a
        ON a.matricula = t.${alunoCol}
       AND a.ano = ?
      JOIN simulados s
        ON s.id = t.simulado_id
       AND s.ano = ?
      ${where}
      GROUP BY a.matricula, a.nome, a.serie
      ORDER BY media DESC, a.nome ASC
      LIMIT 10
    `).all(...params);

    res.json({ ok: true, rows: rows || [] });
  } catch (e) {
    console.error("Ranking (admin/prof) erro:", e);
    res.status(500).json({ ok: false, msg: "Erro interno (ranking)." });
  }
});

// ==============================
// LIBERACOES (ADMIN / PROFESSOR)
// ==============================
app.get("/api/admin/liberacoes", requireLogin, requireAdminOrProfessor, async (req, res) => {
  try {
    const rows = await db.prepare(`
      SELECT
        t.id,
        t.simulado_id,
        t.aluno_matricula,
        t.bloqueado_motivo,
        t.bloqueado_em,
        s.titulo,
        s.unidade,
        s.turma,
        u.nome AS aluno_nome
      FROM tentativas t
      JOIN simulados s ON s.id = t.simulado_id
      LEFT JOIN users u ON u.matricula = t.aluno_matricula
      WHERE t.bloqueado = 1 AND t.liberado_em IS NULL
      ORDER BY t.bloqueado_em DESC
    `).all();

    return res.json({ ok: true, rows: rows || [] });
  } catch (e) {
    console.error("Erro liberacoes:", e);
    return res.status(500).json({ ok: false, msg: "Erro ao carregar liberações." });
  }
});

app.post("/api/admin/liberacoes/:id/liberar", requireLogin, requireAdminOrProfessor, async (req, res) => {
  try {
    const id = Number(req.params.id || 0);
    if (!id) return res.status(400).json({ ok: false, msg: "Registro inválido." });

    const row = await db.prepare(`
      SELECT simulado_id, aluno_matricula
      FROM tentativas
      WHERE id = ? AND bloqueado = 1 AND liberado_em IS NULL
    `).get(id);

    if (!row) return res.status(404).json({ ok: false, msg: "Registro não encontrado ou já liberado." });

    await db.prepare(`
      UPDATE tentativas
      SET bloqueado = 0, liberado_em = NOW(), liberado_por = ?
      WHERE simulado_id = ? AND aluno_matricula = ? AND bloqueado = 1 AND liberado_em IS NULL
    `).run(req.session.user.matricula, row.simulado_id, row.aluno_matricula);

    return res.json({ ok: true });
  } catch (e) {
    console.error("Erro liberar:", e);
    return res.status(500).json({ ok: false, msg: "Erro ao liberar aluno." });
  }
});

async function start() {
  await db.init();
  await seed();
  app.listen(PORT, () => console.log(`Servidor rodando em http://localhost:${PORT}`));
}

start().catch((err) => {
  console.error("Falha ao iniciar o servidor:", err);
  process.exit(1);
});
