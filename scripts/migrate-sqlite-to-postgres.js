const path = require("path");
const Database = require("better-sqlite3");
const { Pool } = require("pg");

const SQLITE_PATH =
  process.env.SQLITE_PATH ||
  path.join(__dirname, "..", "avaliaceep.sqlite");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  host: process.env.PGHOST || "localhost",
  port: Number(process.env.PGPORT || 5432),
  user: process.env.PGUSER || "avaliaceep_user",
  password: process.env.PGPASSWORD,
  database: process.env.PGDATABASE || "avaliaceep",
});

const TABLES = [
  "users",
  "aluno_ano",
  "disciplinas",
  "questoes",
  "simulados",
  "simulado_questoes",
  "aplicacoes",
  "tentativas",
  "tentativa_respostas",
];

function getSqliteColumns(db, table) {
  return db
    .prepare(`PRAGMA table_info(${table})`)
    .all()
    .map((c) => c.name);
}

async function getPgColumns(table) {
  const res = await pool.query(
    `
      SELECT column_name, data_type
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = $1
      ORDER BY ordinal_position
    `,
    [table]
  );
  const map = new Map();
  for (const row of res.rows) {
    map.set(row.column_name, row.data_type);
  }
  return map;
}

function buildInsertSql(table, columns) {
  const cols = columns.map((c) => `"${c}"`).join(", ");
  const params = columns.map((_, i) => `$${i + 1}`).join(", ");
  return `INSERT INTO ${table} (${cols}) VALUES (${params})`;
}

function normalizeTentativasRow(row) {
  if (row.aluno_matricula == null && row.matricula != null) {
    row.aluno_matricula = row.matricula;
  }
  if (row.matricula == null && row.aluno_matricula != null) {
    row.matricula = row.aluno_matricula;
  }
  return row;
}

function normalizeTentativaRespostasRow(row) {
  if (row.ordem == null) row.ordem = 1;
  if (row.respondida_em == null) row.respondida_em = new Date();
  return row;
}

function coerceValue(value, dataType) {
  if (value === "") {
    return null;
  }
  if (value == null) {
    return value;
  }
  const t = String(dataType || "").toLowerCase();
  if (t.includes("int")) {
    const n = Number.parseInt(String(value), 10);
    return Number.isNaN(n) ? null : n;
  }
  if (t.includes("numeric") || t.includes("double") || t.includes("real")) {
    const n = Number.parseFloat(String(value));
    return Number.isNaN(n) ? null : n;
  }
  if (t.includes("boolean")) {
    if (value === true || value === false) return value;
    const v = String(value).toLowerCase().trim();
    if (v === "1" || v === "true") return true;
    if (v === "0" || v === "false") return false;
    return null;
  }
  return value;
}

async function copyTable(db, table) {
  const sqliteCols = getSqliteColumns(db, table);
  const pgCols = await getPgColumns(table);
  const pgColSet = new Set(pgCols.keys());

  let cols = sqliteCols.filter((c) => pgColSet.has(c));

  if (table === "tentativas" && pgColSet.has("aluno_matricula") && !cols.includes("aluno_matricula")) {
    cols.push("aluno_matricula");
  }
  if (table === "tentativas" && pgColSet.has("matricula") && !cols.includes("matricula")) {
    cols.push("matricula");
  }
  if (table === "tentativa_respostas" && pgColSet.has("ordem") && !cols.includes("ordem")) {
    cols.push("ordem");
  }

  if (cols.length === 0) return;

  const rows = db.prepare(`SELECT ${cols.join(", ")} FROM ${table}`).all();
  if (!rows.length) return;

  const insertSql = buildInsertSql(table, cols);

  for (const row of rows) {
    let r = { ...row };
    if (table === "tentativas") r = normalizeTentativasRow(r);
    if (table === "tentativa_respostas") r = normalizeTentativaRespostasRow(r);
    const values = cols.map((c) => coerceValue(r[c], pgCols.get(c)));
    await pool.query(insertSql, values);
  }
}

async function resetSequence(table, column) {
  await pool.query(
    `
      SELECT setval(
        pg_get_serial_sequence($1, $2),
        COALESCE((SELECT MAX(${column}) FROM ${table}), 1),
        true
      )
    `,
    [table, column]
  );
}

async function main() {
  const db = new Database(SQLITE_PATH, { readonly: true });
  try {
    if (process.env.PG_TRUNCATE === "1") {
      await pool.query(`TRUNCATE ${TABLES.join(", ")} RESTART IDENTITY CASCADE`);
    }

    for (const table of TABLES) {
      await copyTable(db, table);
    }

    await resetSequence("users", "id");
    await resetSequence("aluno_ano", "id");
    await resetSequence("disciplinas", "id");
    await resetSequence("questoes", "id");
    await resetSequence("simulados", "id");
    await resetSequence("aplicacoes", "id");
    await resetSequence("tentativas", "id");
  } finally {
    db.close();
    await pool.end();
  }
}

main()
  .then(() => {
    console.log("Migracao concluida.");
  })
  .catch((err) => {
    console.error("Erro na migracao:", err);
    process.exit(1);
  });
