// db.js
const { Pool, types } = require("pg");
const { AsyncLocalStorage } = require("async_hooks");

// Preserve local timestamps as text (avoid UTC shifting).
types.setTypeParser(1114, (value) => value);

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  host: process.env.PGHOST || "localhost",
  port: Number(process.env.PGPORT || 5432),
  user: process.env.PGUSER || "avaliaceep_user",
  password: process.env.PGPASSWORD,
  database: process.env.PGDATABASE || "avaliaceep",
});

const txStore = new AsyncLocalStorage();

function normalizeSql(sql) {
  let i = 0;
  return String(sql).replace(/\?/g, () => `$${++i}`);
}

function runner() {
  return txStore.getStore() || pool;
}

async function addColumnSafe(table, columnDef) {
  await pool.query(`ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS ${columnDef}`);
}

async function init() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      matricula TEXT NOT NULL UNIQUE,
      nome TEXT NOT NULL,
      perfil TEXT NOT NULL CHECK(perfil IN ('admin','professor','aluno')),
      senha_hash TEXT NOT NULL,
      primeiro_acesso INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS aluno_ano (
      id SERIAL PRIMARY KEY,
      ano INTEGER NOT NULL,
      matricula TEXT NOT NULL,
      serie TEXT NOT NULL,
      nome TEXT NOT NULL,
      UNIQUE(ano, matricula)
    );

    CREATE TABLE IF NOT EXISTS password_reset_requests (
      id SERIAL PRIMARY KEY,
      nome TEXT NOT NULL,
      matricula TEXT NOT NULL,
      perfil TEXT,
      motivo TEXT,
      status TEXT NOT NULL DEFAULT 'pendente' CHECK(status IN ('pendente','resolvido','recusado')),
      criado_em TIMESTAMP NOT NULL DEFAULT NOW(),
      criado_ip TEXT,
      atendido_em TIMESTAMP,
      atendido_por TEXT,
      nota TEXT
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS questoes (
      id SERIAL PRIMARY KEY,
      ano INTEGER NOT NULL,
      enunciado TEXT NOT NULL,
      alternativa_a TEXT NOT NULL,
      alternativa_b TEXT NOT NULL,
      alternativa_c TEXT NOT NULL,
      alternativa_d TEXT NOT NULL,
      alternativa_e TEXT,
      correta TEXT NOT NULL CHECK(correta IN ('A','B','C','D','E')),
      materia TEXT,
      tags TEXT,
      criada_por_matricula TEXT,
      criada_em TIMESTAMP NOT NULL DEFAULT NOW(),
      curso TEXT,
      serie TEXT,
      unidade TEXT,
      imagem_url TEXT,
      disciplina_id INTEGER
    );

    CREATE TABLE IF NOT EXISTS simulados (
      id SERIAL PRIMARY KEY,
      ano INTEGER NOT NULL,
      titulo TEXT NOT NULL,
      unidade TEXT NOT NULL,
      turma TEXT NOT NULL,
      inicio_em TIMESTAMP NOT NULL,
      fim_em TIMESTAMP NOT NULL,
      valor_total DOUBLE PRECISION NOT NULL,
      num_questoes INTEGER NOT NULL,
      criado_por_matricula TEXT,
      criado_em TIMESTAMP NOT NULL DEFAULT NOW(),
      atualizado_em TIMESTAMP,
      curso TEXT,
      duracao_min INTEGER DEFAULT 90
    );

    CREATE TABLE IF NOT EXISTS simulado_questoes (
      simulado_id INTEGER NOT NULL,
      questao_id INTEGER NOT NULL,
      ordem INTEGER NOT NULL,
      adicionada_por_matricula TEXT,
      adicionada_em TIMESTAMP,
      PRIMARY KEY (simulado_id, questao_id),
      FOREIGN KEY (simulado_id) REFERENCES simulados(id) ON DELETE CASCADE,
      FOREIGN KEY (questao_id) REFERENCES questoes(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS aplicacoes (
      id SERIAL PRIMARY KEY,
      simulado_id INTEGER NOT NULL,
      inicio_em TIMESTAMP NOT NULL,
      fim_em TIMESTAMP NOT NULL,
      tipo TEXT NOT NULL DEFAULT 'original' CHECK(tipo IN ('original','reaplicacao')),
      criado_em TIMESTAMP NOT NULL DEFAULT NOW(),
      FOREIGN KEY (simulado_id) REFERENCES simulados(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS disciplinas (
      id SERIAL PRIMARY KEY,
      nome TEXT NOT NULL,
      curso TEXT NOT NULL,
      serie TEXT NOT NULL,
      unidade TEXT NOT NULL,
      ano INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS tentativas (
      id SERIAL PRIMARY KEY,
      simulado_id INTEGER NOT NULL,
      aluno_matricula TEXT NOT NULL,
      iniciado_em TIMESTAMP NOT NULL DEFAULT NOW(),
      termina_em TIMESTAMP NOT NULL,
      status TEXT NOT NULL DEFAULT 'em_andamento' CHECK(status IN ('em_andamento','enviado','expirado')),
      avisos INTEGER NOT NULL DEFAULT 0,
      ordem_json TEXT NOT NULL,
      acertos INTEGER,
      nota DOUBLE PRECISION,
      finalizado_em TIMESTAMP,
      matricula TEXT,
      bloqueado INTEGER DEFAULT 0,
      bloqueado_motivo TEXT,
      bloqueado_em TIMESTAMP,
      liberado_em TIMESTAMP,
      liberado_por TEXT,
      FOREIGN KEY (simulado_id) REFERENCES simulados(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS tentativa_respostas (
      tentativa_id INTEGER NOT NULL,
      questao_id INTEGER NOT NULL,
      ordem INTEGER NOT NULL DEFAULT 1,
      marcada TEXT CHECK(marcada IN ('A','B','C','D','E')),
      correta INTEGER NOT NULL DEFAULT 0,
      respondida_em TIMESTAMP NOT NULL DEFAULT NOW(),
      PRIMARY KEY (tentativa_id, questao_id),
      FOREIGN KEY (tentativa_id) REFERENCES tentativas(id) ON DELETE CASCADE,
      FOREIGN KEY (questao_id) REFERENCES questoes(id) ON DELETE CASCADE
    );
  `);

  await addColumnSafe("simulados", "curso TEXT");
  await addColumnSafe("simulados", "duracao_min INTEGER DEFAULT 90");
  await addColumnSafe("questoes", "curso TEXT");
  await addColumnSafe("questoes", "serie TEXT");
  await addColumnSafe("questoes", "unidade TEXT");
  await addColumnSafe("questoes", "imagem_url TEXT");
  await addColumnSafe("users", "data_nascimento DATE");
  await addColumnSafe("users", "email TEXT");
  await addColumnSafe("users", "estado TEXT");
  await addColumnSafe("users", "cidade TEXT");
  await addColumnSafe("users", "endereco TEXT");
  await addColumnSafe("users", "telefone TEXT");
  await addColumnSafe("users", "last_activity TIMESTAMP");
  await addColumnSafe("simulado_questoes", "adicionada_por_matricula TEXT");
  await addColumnSafe("simulado_questoes", "adicionada_em TIMESTAMP");
  await addColumnSafe("questoes", "disciplina_id INTEGER");
  await addColumnSafe("tentativas", "matricula TEXT");
  await addColumnSafe("tentativas", "aluno_matricula TEXT");
  await addColumnSafe("tentativas", "bloqueado INTEGER DEFAULT 0");
  await addColumnSafe("tentativas", "bloqueado_motivo TEXT");
  await addColumnSafe("tentativas", "bloqueado_em TIMESTAMP");
  await addColumnSafe("tentativas", "liberado_em TIMESTAMP");
  await addColumnSafe("tentativas", "liberado_por TEXT");
  await addColumnSafe("tentativa_respostas", "ordem INTEGER NOT NULL DEFAULT 1");

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_aluno_ano_ano_serie ON aluno_ano(ano, serie);
    CREATE INDEX IF NOT EXISTS idx_pwdreq_status ON password_reset_requests(status);
    CREATE INDEX IF NOT EXISTS idx_pwdreq_criado_em ON password_reset_requests(criado_em);
    CREATE INDEX IF NOT EXISTS idx_simulados_ano_turma ON simulados(ano, turma);
    CREATE INDEX IF NOT EXISTS idx_simulados_ano_unidade ON simulados(ano, unidade);
    CREATE INDEX IF NOT EXISTS idx_questoes_ano_curso_serie_unidade ON questoes(ano, curso, serie, unidade);
    CREATE INDEX IF NOT EXISTS idx_questoes_disciplina ON questoes(disciplina_id);
    CREATE INDEX IF NOT EXISTS idx_questoes_materia ON questoes(materia);
    CREATE INDEX IF NOT EXISTS idx_disciplinas_contexto ON disciplinas(curso, serie, unidade, ano);
    CREATE INDEX IF NOT EXISTS idx_tentativas_simulado_aluno_status ON tentativas(simulado_id, aluno_matricula, status);
    CREATE INDEX IF NOT EXISTS idx_tentativas_simulado_matricula_status ON tentativas(simulado_id, matricula, status);
    CREATE INDEX IF NOT EXISTS idx_tentativas_bloqueio ON tentativas(simulado_id, aluno_matricula, bloqueado, liberado_em);
    CREATE INDEX IF NOT EXISTS idx_users_last_activity ON users(last_activity);
    CREATE INDEX IF NOT EXISTS idx_tentativa_respostas_tentativa ON tentativa_respostas(tentativa_id);
    CREATE INDEX IF NOT EXISTS idx_tentativa_respostas_questao ON tentativa_respostas(questao_id);
  `);

  await pool.query("UPDATE tentativas SET status = 'enviado' WHERE status = 'enviada'");
  await pool.query("UPDATE tentativas SET status = 'expirado' WHERE status = 'encerrada'");
  await pool.query(`
    UPDATE tentativas
    SET aluno_matricula = matricula
    WHERE aluno_matricula IS NULL AND matricula IS NOT NULL
  `);
  await pool.query(`
    UPDATE tentativas
    SET matricula = aluno_matricula
    WHERE matricula IS NULL AND aluno_matricula IS NOT NULL
  `);
}

async function withTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    return await txStore.run(client, async () => {
      const res = await fn();
      await client.query("COMMIT");
      return res;
    });
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch (_) {
      // ignora erro de rollback
    }
    throw err;
  } finally {
    client.release();
  }
}

function prepare(sql) {
  const text = normalizeSql(sql);
  return {
    get: async (...values) => {
      const res = await runner().query(text, values);
      return res.rows[0];
    },
    all: async (...values) => {
      const res = await runner().query(text, values);
      return res.rows;
    },
    run: async (...values) => runner().query(text, values),
  };
}

async function exec(sql) {
  return runner().query(normalizeSql(sql));
}

module.exports = {
  pool,
  query: (text, params) => pool.query(text, params),
  exec,
  prepare,
  transaction: (fn) => () => withTransaction(() => fn()),
  withTransaction,
  init,
};
