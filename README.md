AvaliaCEEP

Visao geral
- Portal de avaliacoes com perfis (admin, professor, aluno)
- Backend em Node.js + Express
- Banco Postgres
- Front-end estatico em HTML/CSS/JS
- App Android via Capacitor (usa a mesma URL do servidor)

Recursos principais
- Autenticacao por perfil
- Simulados e questoes com gerenciamento via painel
- Resultados e graficos
- Recuperacao de senha por e-mail (opcional, SMTP)
- Backup automatico do banco (opcional)

Stack
- Node.js, Express
- Postgres
- HTML, CSS, JavaScript
- Capacitor (Android)

Requisitos
- Node.js (LTS recomendado)
- Postgres
- (Opcional) Java/Android Studio para build do app

Instalacao e execucao
1) `npm install`
2) Configure as variaveis de ambiente (veja abaixo)
3) `npm start`
4) Acesse `http://localhost:3000`

Scripts
- `npm start` inicia o servidor
- `npm run start:prod` define `NODE_ENV=production`

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

Estrutura do projeto
- `server.js` API, sessao e regras de negocio
- `db.js` schema Postgres e indices
- `public/` front-end estatico
- `docs/API.md` documentacao de rotas
- `docs/APK.md` guia do APK (Android)
- `scripts/` utilitarios

Android (Capacitor)
- O app Android aponta para a mesma URL do servidor
- Atualize a URL quando trocar o ambiente (dev/prod)
- Consulte `docs/APK.md` para o passo a passo

Backups
- O backup usa `pg_dump` quando `BACKUP_ENABLED=1`
- Configure horario e quantidade de backups via variaveis de ambiente

Notas
- O seed inicial cria 1 admin, 1 professor e 1 aluno quando o banco esta vazio
- O app segue a mesma regra do desktop para selecao de ano (via `/api/anos`)

Licenca
- Defina a licenca aqui (ex.: MIT)
