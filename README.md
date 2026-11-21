# Mini-CMMS

Sistema de Ordens de Manutenção e Estoque de Peças — projeto da AVD2 (Módulo IV).

Permite cadastrar equipamentos, abrir ordens de serviço (OS), fechá-las consumindo peças do
estoque numa transação atômica e acompanhar indicadores de manutenção (MTTR, MTBF,
disponibilidade e custo). **Todos os dados são fictícios**, gerados pelo `database/seed.js`.

## Stack
- **Banco:** PostgreSQL no [Neon](https://neon.tech) (tabelas, triggers, função de KPIs, procedure, consultas BD2)
- **API:** Node.js 20 + Express (ES Modules), JWT, bcrypt, helmet, express-rate-limit
- **Front:** HTML + JavaScript vanilla + Chart.js

## Estrutura
```
backend/     API Express (src/routes, src/middlewares, src/services) e tests/
frontend/    telas HTML + js/ + css/
database/    01_schema.sql, 02_triggers.sql, 03_procedures.sql, 04_consultas_bd2.sql, seed.js
docs/        estudo.md (resumo de cada etapa + perguntas de banca)
```

## Banco de dados

O banco de desenvolvimento é o **Neon** (PostgreSQL gerenciado), com dois bancos:

| Banco | Variável no `backend/.env` | Uso |
|---|---|---|
| `cmms` | `DATABASE_URL` | API e seed |
| `cmms_test` | `DATABASE_URL_TEST` | só `npm test` (os testes criam e apagam dados) |

Os scripts SQL são **portáveis**. Usam só PostgreSQL padrão (PL/pgSQL, `TIMESTAMPTZ`, CTEs,
funções de janela), sem nenhum recurso exclusivo do Neon, e rodam igual em vários ambientes:
- PostgreSQL 14 ou mais novo, local;
- Neon (testado no PostgreSQL 19);
- VM da Azure (testado no PostgreSQL 18).

A conexão da API e do seed usa SSL com verificação de certificado sempre que o host não é
`localhost`.

Pré-requisitos: Node.js 20 e o `psql` (vem com o PostgreSQL).

```bash
# 1. configurar variáveis (DATABASE_URL, DATABASE_URL_TEST, JWT_SECRET, SEED_PASSWORD)
cp backend/.env.example backend/.env

# 2. criar tabelas, triggers, função de KPIs e procedure, nos DOIS bancos
psql "$DATABASE_URL"      -f database/01_schema.sql -f database/02_triggers.sql -f database/03_procedures.sql
psql "$DATABASE_URL_TEST" -f database/01_schema.sql -f database/02_triggers.sql -f database/03_procedures.sql

# 3. popular o banco de desenvolvimento com dados fictícios
cd database && npm install && npm run seed

# 4. rodar as consultas BD2
psql "$DATABASE_URL" -f database/04_consultas_bd2.sql
```

> As URLs do Neon contêm `&`. No terminal, use-as sempre entre aspas.

Usuários criados pelo seed (senha = `SEED_PASSWORD` do `.env`):

| E-mail | Perfil |
|---|---|
| operador@cmms.local | OPERADOR |
| tecnico@cmms.local | TECNICO |
| tecnico2@cmms.local | TECNICO |
| supervisor@cmms.local | SUPERVISOR |

## Como rodar a API

```bash
cd backend
npm install
npm start          # http://localhost:3000  (npm run dev reinicia ao salvar)
npm test           # node:test + supertest; usa SEMPRE o DATABASE_URL_TEST (cmms_test)
```

O `JWT_SECRET` do `backend/.env` precisa ter pelo menos 32 caracteres; a API não sobe sem ele.

`LOGIN_RATE_LIMIT_MAX` define quantas tentativas de login cada IP pode fazer a cada 15 minutos.
O padrão é 10, que é o valor de produção. Em desenvolvimento pode ser maior (ex.: 100), para os
testes no navegador não bloquearem o login.

O `npm test` roda com `NODE_ENV=test`. Nesse modo, a API se recusa a usar o banco de
desenvolvimento. Os testes criam e apagam os próprios usuários, equipamentos e OS; o
`cmms_test` só precisa dos scripts `01..03`.

### Endpoints

| Método | Rota | Perfil | Descrição |
|---|---|---|---|
| GET | `/api/health` | público | verificação de vida |
| POST | `/api/auth/login` | público | `{ email, senha }` → `{ token, expiraEm, usuario }` (`LOGIN_RATE_LIMIT_MAX` tentativas/15 min, padrão 10) |
| GET | `/api/auth/me` | qualquer logado | dados do usuário do token |
| POST | `/api/os` | OPERADOR, SUPERVISOR | abre OS: `{ equipamentoId, descricao, tipo?, prioridade? }` → 201; o equipamento passa a PARADO |
| GET | `/api/os` | qualquer logado | lista `{ dados, paginacao: { limit, offset, total } }`; filtros `status`, `prioridade`, `equipamentoId`; `limit` (padrão 50, máx. 200) e `offset` (padrão 0) |
| GET | `/api/os/:id` | qualquer logado | detalhe com peças usadas e histórico de auditoria |
| POST | `/api/os/:id/assumir` | TECNICO | só OS `ABERTA` (senão 409): `EM_ANDAMENTO`, `tecnico_id`, `iniciada_em` |
| POST | `/api/os/:id/fechar` | TECNICO que assumiu, SUPERVISOR | `{ causa, solucao, horas, pecas?: [{ pecaId, qtd }] }`; só OS `EM_ANDAMENTO` ou `AGUARDANDO_PECA`. Transação: baixa de estoque, `os_pecas`, movimentações SAIDA, OS `FECHADA`; o equipamento volta a `OPERANDO` se não houver outra OS `ABERTA`/`EM_ANDAMENTO`/`AGUARDANDO_PECA`. Falta de estoque: 409 `ESTOQUE_INSUFICIENTE`, nada é gravado e a OS vai para `AGUARDANDO_PECA` |
| GET | `/api/equipamentos` | qualquer logado | lista com `status` e `os_pendentes` |
| POST | `/api/equipamentos` | SUPERVISOR | `{ tag, nome, linha, criticidade (A/B/C) }` → 201; tag duplicada: 409 `TAG_DUPLICADA` |
| GET | `/api/pecas` | qualquer logado | lista com `estoque`, `estoque_min` e `abaixo_minimo` |
| POST | `/api/pecas` | SUPERVISOR | `{ codigo, descricao, estoqueMin, custoUnit }` → 201, com estoque 0; código duplicado: 409 `CODIGO_DUPLICADO` |
| POST | `/api/pecas/:id/entrada` | SUPERVISOR | `{ qtd }` → `CALL sp_entrada_estoque`: soma o estoque, grava ENTRADA e resolve alertas → `{ peca, alertasResolvidos }` |
| GET | `/api/alertas` | SUPERVISOR | alertas de estoque mínimo pendentes |
| GET | `/api/kpis?inicio=&fim=` | qualquer logado | `sp_kpis_equipamento` por equipamento (datas `AAAA-MM-DD`; padrão: últimos 90 dias) → `{ inicio, fim, equipamentos }` |
| GET | `/api/kpis/resumo` | qualquer logado | cards: OS abertas, em andamento, aguardando peça, equipamentos parados, alertas pendentes |
| GET | `/api/kpis/mttr-acima-media` | qualquer logado | consulta BD2 nº 1 (subquery) |
| GET | `/api/kpis/top-pecas` | qualquer logado | consulta BD2 nº 2 (top 5 peças em 30 dias) |
| GET | `/api/kpis/pareto-causas` | qualquer logado | consulta BD2 nº 3 (CTE + janela) |

As três rotas BD2 executam o SQL **do próprio** `database/04_consultas_bd2.sql`. A API lê o
arquivo ao subir e separa as consultas pelos marcadores `-- @consulta <nome>`. Assim, o psql e a
API rodam o mesmo texto.

Toda resposta de erro tem o formato `{ "erro": { "codigo", "mensagem", "detalhes" } }`:

| Status | Quando |
|---|---|
| 400 | dados inválidos |
| 401 | sem token ou token inválido |
| 403 | perfil sem permissão |
| 404 | não encontrado |
| 409 | estoque insuficiente ou status inválido |

## Front

HTML + CSS + JavaScript puro (ES Modules), sem framework e sem build, na pasta `frontend/`.
Em desenvolvimento, o próprio Express serve a pasta: com a API rodando (`npm start` em `backend/`),
abra **http://localhost:3000**. No deploy, quem serve os arquivos é o NGINX.

| Página | Conteúdo |
|---|---|
| `index.html` | login em tela dividida (o JWT fica no `sessionStorage`) |
| `os.html` | indicadores do `/api/kpis/resumo`, lista de OS com filtros e paginação; "+ Nova OS" em painel lateral para OPERADOR e SUPERVISOR |
| `404.html` | página para endereços inexistentes fora de `/api` (dentro de `/api` a resposta é JSON) |

Visual "sala de controle industrial": menu lateral grafite, uma única cor de destaque
(amarelo de segurança `#F2A900`) e status em semáforo, com ponto colorido + texto. As fontes
IBM Plex Sans e Mono ficam em `frontend/fontes/` (licença OFL). As cores, espaçamentos e
fontes são **design tokens** (variáveis CSS) no topo de `css/estilo.css`, para as próximas
telas reaproveitarem.

As fontes vêm do npm (`@fontsource`), mas os arquivos copiados são versionados, então o deploy
não precisa rodar npm no front. Para atualizá-las: `cd frontend && npm install && npm run vendor`.

Capturas de antes e depois do redesign: `docs/capturas/redesign/`.

Segurança no front:
- todo dado vindo da API entra na página por `textContent`, nunca por `innerHTML` (contra XSS);
- a CSP permite só scripts e estilos do próprio site (`'self'`), sem `'unsafe-inline'`;
- `js/api.js` envia o token e, num 401, encerra a sessão e volta ao login;
- a tela esconde botões conforme o perfil, mas quem garante a permissão é sempre a API;
- sem CDN: fontes, logo e scripts são servidos pelo próprio site;
- em desenvolvimento, `package.json`, `scripts/` e `node_modules/` do front não são servidos.
  No NGINX do deploy, bloquear os mesmos caminhos.

## Fluxo de trabalho
- Uma issue por funcionalidade, board no GitHub Projects (To Do / In Progress / Done).
- Branch `feature/<issue>-<nome>`, commits pequenos, PR com `Closes #N`, revisão e merge na `main`.
- `.env` nunca é versionado; use `backend/.env.example` como modelo.
