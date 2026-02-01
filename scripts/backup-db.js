const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

require("dotenv").config();

function pad(n) {
  return String(n).padStart(2, "0");
}

function timestamp() {
  const d = new Date();
  return [
    d.getFullYear(),
    pad(d.getMonth() + 1),
    pad(d.getDate()),
    "_",
    pad(d.getHours()),
    pad(d.getMinutes()),
    pad(d.getSeconds()),
  ].join("");
}

function buildArgs(outputPath) {
  if (process.env.DATABASE_URL) {
    return ["--dbname", process.env.DATABASE_URL, "--format=plain", "--file", outputPath];
  }

  const host = process.env.PGHOST || "localhost";
  const port = process.env.PGPORT || "5432";
  const user = process.env.PGUSER;
  const db = process.env.PGDATABASE;

  if (!user || !db) {
    throw new Error("Defina PGUSER e PGDATABASE (ou DATABASE_URL) no .env.");
  }

  return ["-h", host, "-p", port, "-U", user, "-d", db, "--format=plain", "--file", outputPath];
}

function cleanupOldBackups(dir, keep = 5) {
  const files = fs.readdirSync(dir)
    .filter((f) => /^db_\d{8}_\d{6}\.sql$/.test(f))
    .map((f) => ({ name: f, full: path.join(dir, f) }))
    .sort((a, b) => fs.statSync(b.full).mtimeMs - fs.statSync(a.full).mtimeMs);

  files.slice(keep).forEach((f) => {
    fs.unlinkSync(f.full);
  });
}

async function main() {
  const backupDir = path.join(__dirname, "..", "backups");
  fs.mkdirSync(backupDir, { recursive: true });

  const outputPath = path.join(backupDir, `db_${timestamp()}.sql`);
  const args = buildArgs(outputPath);

  const env = { ...process.env };
  if (process.env.PGPASSWORD) env.PGPASSWORD = process.env.PGPASSWORD;

  const child = spawn("pg_dump", args, { env, stdio: "inherit" });
  child.on("exit", (code) => {
    if (code !== 0) {
      process.exit(code || 1);
      return;
    }
    const keep = Math.max(1, Number(process.env.BACKUP_KEEP || 5));
    cleanupOldBackups(backupDir, keep);
    process.exit(0);
  });
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
