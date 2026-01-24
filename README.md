AvaliaCEEP

Visao geral
- Portal de avaliacoes com login por perfil (admin, professor, aluno)
- Backend em Node.js + Express
- Banco Postgres
- Front-end estatico em HTML/CSS/JS

Como rodar
1) `npm install`
2) `npm start`
3) Acesse `http://localhost:3000`

Scripts
- `npm start` inicia o servidor
- `npm run start:prod` define NODE_ENV=production

Variaveis de ambiente
- `PORT` porta do servidor (padrao 3000)
- `SESSION_SECRET` chave da sessao
- `NODE_ENV` use `production` para cookies seguros em HTTPS
- `DATABASE_URL` string completa do Postgres (opcional)
- `PGHOST`, `PGPORT`, `PGUSER`, `PGPASSWORD`, `PGDATABASE` credenciais do Postgres

Estrutura
- `server.js` API, sessao e regras de negocio
- `db.js` schema Postgres e indices
- `public/` front-end estatico
- `views/` paginas EJS (admin)
- `docs/API.md` documentacao de rotas

Migracao de dados (SQLite -> Postgres)
1) Ajuste as variaveis do Postgres (`PGHOST`, `PGUSER`, `PGPASSWORD`, `PGDATABASE`) ou `DATABASE_URL`.
2) (Opcional) Defina `SQLITE_PATH` com o caminho do arquivo SQLite.
3) Para limpar o Postgres antes de importar, use `PG_TRUNCATE=1`.
4) Rode: `node scripts/migrate-sqlite-to-postgres.js`

Notas
- O seed inicial cria 1 admin, 1 professor e 1 aluno quando o banco esta vazio.
