AvaliaCEEP

Visao geral
- Portal de avaliacoes com login por perfil (admin, professor, aluno)
- Backend em Node.js + Express
- Banco Postgres
- Front-end estatico em HTML/CSS/JS
- App Android via Capacitor (usa a mesma URL do servidor)

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
- `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` envio de e-mail (opcional)
- `BACKUP_ENABLED=1` ativa backup automatico (usa `pg_dump`)
- `BACKUP_HOUR` (0-23) hora do backup diario (padrao 2)
- `BACKUP_MINUTE` (0-59) minuto do backup diario (padrao 0)
- `BACKUP_ON_START=1` executa backup ao iniciar o servidor
- `BACKUP_KEEP` quantidade de backups mantidos (padrao 5)

Estrutura
- `server.js` API, sessao e regras de negocio
- `db.js` schema Postgres e indices
- `public/` front-end estatico
- `docs/API.md` documentacao de rotas
- `docs/APK.md` guia do APK (Android)

Notas
- O seed inicial cria 1 admin, 1 professor e 1 aluno quando o banco esta vazio.
- O app segue a mesma regra do desktop para selecao de ano (via /api/anos).
