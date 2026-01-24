API - AvaliaCEEP

Base
- Base URL: `http://localhost:3000`
- Autenticacao: sessao via cookie (login em /api/login)
- Resposta padrao: `{ ok: true|false, ... }`

Auth
- POST `/api/login` body: `{ matricula, senha }`
- GET `/api/me`
- POST `/api/logout`
- POST `/api/alterar-senha` body: `{ nova }`
- POST `/api/password-requests` body: `{ nome, matricula, email, perfil? }`

Usuarios (admin)
- GET `/api/admin/users-admin-prof`
- POST `/api/admin/users-admin-prof` body: `{ matricula, nome, perfil }`
- PUT `/api/admin/users-admin-prof/:matricula` body: `{ matricula, nome, perfil }`
- DELETE `/api/admin/users-admin-prof/:matricula`
- POST `/api/admin/reset-senha` body: `{ matricula }`
- GET `/api/admin/password-requests` query: `status=pendente|resolvido|recusado`
- POST `/api/admin/password-requests/:id/resolve` body: `{ action: "reset|resolver|recusar", nota? }`

Alunos (admin)
- POST `/api/admin/importar-alunos` body: `{ alunos: [{ matricula, nome, serie }] }`
- GET `/api/admin/alunos-ano-atual`
- PUT `/api/admin/alunos/:matricula` body: `{ nome, serie }`
- DELETE `/api/admin/alunos/:matricula`
- GET `/api/admin/turmas-ano-atual`

Questoes (admin/prof)
- GET `/api/questoes` query: `ano, page, limit, search, curso, serie, unidade, disciplina_id, materia`
- GET `/api/questoes/:id`
- POST `/api/questoes` body: dados da questao
- PUT `/api/questoes/:id` body: dados da questao
- DELETE `/api/questoes/:id`
- POST `/api/upload/questao-imagem` multipart: `imagem`
- GET `/api/disciplinas` query: `curso, serie, unidade, ano`
- POST `/api/disciplinas` body: `{ nome, curso, serie, unidade, ano }`

Simulados (admin/prof)
- GET `/api/admin/simulados`
- POST `/api/admin/simulados` body: dados do simulado
- PUT `/api/admin/simulados/:id` body: dados do simulado
- DELETE `/api/admin/simulados/:id`
- POST `/api/admin/simulados/:id/replicar`
- GET `/api/simulados/:id`
- POST `/api/simulados/:id/questoes` body: `{ questao_id }`
- DELETE `/api/simulados/:id/questoes/:questaoId`
- POST `/api/simulados/:id/questoes/criar` body: dados da questao

Aluno - simulados
- GET `/api/aluno/simulados`
- POST `/api/aluno/simulados/:id/iniciar`
- GET `/api/aluno/tentativas/:id`
- GET `/api/aluno/tentativas/:id/questoes/:n`
- POST `/api/aluno/tentativas/:id/responder` body: `{ questao_id, marcada }`
- POST `/api/aluno/tentativas/:id/aviso`
- POST `/api/aluno/tentativas/:id/enviar`
- GET `/api/aluno/resultados`

Relatorios (admin/prof)
- GET `/api/admin/relatorios/unidades`
- GET `/api/admin/relatorios/turmas` query: `ano, unidade`
- GET `/api/admin/relatorios/simulados` query: `ano, unidade, turma`
- GET `/api/admin/relatorios/simulado/:id`
- GET `/api/admin/relatorios/comparativo-series` query: `ano, serie`
