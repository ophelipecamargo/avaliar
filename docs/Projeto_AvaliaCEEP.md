# Documentacao do Projeto AvaliaCEEP

Este arquivo esta em Markdown para abrir no Word e salvar como .docx.

## 1) Visao geral
O AvaliaCEEP e um portal de avaliacoes com tres perfis:
- Admin
- Professor
- Aluno

O sistema permite:
- Criar simulados, gerenciar questoes e aplicar avaliacoes.
- Acompanhar resultados e gerar relatorios.
- Visualizar graficos de desempenho.
- Controlar liberacoes quando o aluno atinge avisos ou expira a sessao.
- Operar por ano letivo, com historico preservado.

## 2) Stack e arquitetura
- Backend: Node.js + Express
- Banco: PostgreSQL
- Sessao: cookies com express-session + connect-pg-simple
- Front-end: HTML/CSS/JS estatico em `public/`

Estrutura principal:
- `server.js`: API, regras de negocio e sessao.
- `db.js`: schema, indices e utilitarios de banco.
- `public/`: paginas e scripts do front.
- `scripts/`: migracao e utilitarios.
- `docs/`: documentacao.

## 3) Perfis e permissoes
- Admin:
  - Gerencia usuarios (admin/professor/aluno).
  - Gerencia simulados, questoes, relatorios e liberacoes.
- Professor:
  - Gerencia simulados e questoes.
  - Consulta resultados e relatorios.
  - Gerencia liberacoes.
- Aluno:
  - Realiza simulados liberados.
  - Consulta resultado pessoal.

## 4) Ano letivo e historico
O sistema funciona por ano letivo. O ano ativo e selecionado no header:
- Por padrao, o ano vigente e usado.
- O usuario pode trocar o ano para consultar historico.
- Nao ha migracao automatica de alunos entre anos.
- A mesma matricula pode existir em anos diferentes com turmas diferentes.

Impacto:
- `aluno_ano` guarda o vinculo por ano.
- `simulados`, `questoes` e relatorios usam o ano ativo.

## 5) Requisitos
- Node.js 18+
- PostgreSQL 13+ (ou compativel)

## 6) Instalacao e execucao
1. `npm install`
2. Configure o `.env`
3. `npm start`
4. Acesse `http://localhost:3000`

## 7) Variaveis de ambiente
Obrigatorias:
- `SESSION_SECRET`
- `PGHOST`, `PGPORT`, `PGUSER`, `PGPASSWORD`, `PGDATABASE`
  - Ou `DATABASE_URL`

Opcionais:
- `PORT` (padrao 3000)
- `NODE_ENV=production`

## 8) Scripts
- `npm start`: inicia o servidor.
- `npm run start:prod`: modo production.
- `npm run migrate:sqlite`: migracao SQLite -> Postgres.

## 9) Migracao SQLite -> Postgres
1. Defina as credenciais do Postgres no `.env`.
2. (Opcional) `SQLITE_PATH` com o caminho do SQLite.
3. (Opcional) `PG_TRUNCATE=1` para limpar antes de migrar.
4. Execute `node scripts/migrate-sqlite-to-postgres.js`.

## 10) Principais paginas (front)
- `dashboard.html`: atalho para funcoes por perfil.
- `simulados-criar.html`: gestao de simulados.
- `simulados-aluno.html`: simulados do aluno.
- `simulado-realizar.html`: execucao do simulado.
- `resultados.html`: relatorios e resultados.
- `graficos.html`: comparativo, ranking e pizza por disciplina.
- `liberacoes.html`: liberacoes de tentativas bloqueadas.
- `perfil.html`: dados pessoais e troca de senha.
- `login.html`: acesso ao sistema.

## 11) API (resumo)
Detalhe completo em `docs/API.md`. Rotas principais:

Auth
- POST `/api/login`
- GET `/api/me`
- POST `/api/logout`
- POST `/api/alterar-senha`

Ano letivo
- GET `/api/anos`
- GET `/api/ano`
- PUT `/api/ano`

Perfil
- GET `/api/perfil`
- PUT `/api/perfil`

Usuarios (admin)
- GET `/api/admin/users-admin-prof`
- POST `/api/admin/users-admin-prof`
- PUT `/api/admin/users-admin-prof/:matricula`
- DELETE `/api/admin/users-admin-prof/:matricula`
- POST `/api/admin/reset-senha`

Alunos (admin)
- POST `/api/admin/importar-alunos`
- GET `/api/admin/alunos-ano-atual`
- PUT `/api/admin/alunos/:matricula`
- DELETE `/api/admin/alunos/:matricula`
- GET `/api/admin/turmas-ano-atual`

Questoes (admin/professor)
- GET `/api/questoes`
- GET `/api/questoes/:id`
- POST `/api/questoes`
- PUT `/api/questoes/:id`
- DELETE `/api/questoes/:id`
- POST `/api/upload/questao-imagem`
- GET `/api/disciplinas`
- POST `/api/disciplinas`

Simulados (admin/professor)
- GET `/api/admin/simulados`
- POST `/api/admin/simulados`
- PUT `/api/admin/simulados/:id`
- DELETE `/api/admin/simulados/:id`
- POST `/api/admin/simulados/:id/replicar`
- GET `/api/simulados/:id`
- POST `/api/simulados/:id/questoes`
- DELETE `/api/simulados/:id/questoes/:questaoId`
- POST `/api/simulados/:id/questoes/criar`

Aluno - simulados
- GET `/api/aluno/simulados`
- POST `/api/aluno/simulados/:id/iniciar`
- GET `/api/aluno/tentativas/:id`
- GET `/api/aluno/tentativas/:id/questoes/:n`
- POST `/api/aluno/tentativas/:id/responder`
- POST `/api/aluno/tentativas/:id/aviso`
- POST `/api/aluno/tentativas/:id/enviar`
- GET `/api/aluno/resultados`

Relatorios (admin/professor)
- GET `/api/admin/relatorios/unidades`
- GET `/api/admin/relatorios/turmas`
- GET `/api/admin/relatorios/simulados`
- GET `/api/admin/relatorios/simulado/:id`
- GET `/api/admin/relatorios/comparativo-series`
- GET `/api/admin/relatorios/ranking`
- GET `/api/admin/relatorios/desempenho-disciplinas`
- GET `/api/admin/relatorios/desempenho-disciplina-alunos`

Liberacoes
- GET `/api/admin/liberacoes`
- POST `/api/admin/liberacoes/:id/liberar`

## 12) Banco de dados (tabelas principais)
- `users`: usuarios, perfil, dados pessoais.
- `aluno_ano`: vinculo do aluno com turma por ano.
- `simulados`: definicao do simulado.
- `simulado_questoes`: questoes vinculadas ao simulado.
- `questoes`: banco de questoes.
- `disciplinas`: disciplinas e contexto.
- `tentativas`: execucoes do simulado pelo aluno.
- `tentativa_respostas`: respostas do aluno.

## 13) Seguranca e boas praticas
- Use `SESSION_SECRET` forte.
- Use `NODE_ENV=production` em ambiente com HTTPS.
- Mantenha o PostgreSQL com acesso restrito.
- Controle de acesso por perfil ja aplicado.

## 14) Registro e protecao (Brasil)
Recomendacoes:
1. Registro de Programa de Computador no INPI (prova de autoria).
2. Definicao de licenca:
   - "Todos os direitos reservados" se for fechado.
   - Ou licenca customizada para clientes.
3. Documentacao e historico de commits como evidencia.
4. Contratos com clientes/usuarios (termos de uso e privacidade).

Obs.: Este texto nao substitui orientacao juridica.

## 15) Manutencao anual (fluxo sugerido)
1. No inicio do ano, selecione o novo ano no header.
2. Importe alunos do ano novo (sem migrar automaticamente).
3. Crie simulados do novo ano.
4. O historico do ano anterior fica consultavel.

## 16) Contato tecnico
Equipe AvaliaCEEP.
