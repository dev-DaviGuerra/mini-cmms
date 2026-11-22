# Mini-CMMS

[![CI](https://github.com/dev-DaviGuerra/mini-cmms/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/dev-DaviGuerra/mini-cmms/actions/workflows/ci.yml)
[![Quality Gate Status](https://sonarcloud.io/api/project_badges/measure?project=dev-DaviGuerra_mini-cmms&metric=alert_status)](https://sonarcloud.io/summary/new_code?id=dev-DaviGuerra_mini-cmms)
[![Coverage](https://sonarcloud.io/api/project_badges/measure?project=dev-DaviGuerra_mini-cmms&metric=coverage)](https://sonarcloud.io/summary/new_code?id=dev-DaviGuerra_mini-cmms)

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
database/    01_schema.sql, 02_triggers.sql, 03_procedures.sql, 04_consultas_bd2.sql,
             05_usuarios_ativo.sql, seed.js
docs/        estudo.md (resumo de cada etapa + perguntas de banca), qss-relatorio.md
.github/     workflows/ci.yml (CI + SonarCloud), dependabot.yml
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

# 2. criar tabelas, triggers, função de KPIs, procedure e a coluna usuarios.ativo, nos DOIS bancos
#    (ordem: 01, 02, 03, 05; o 04 só contém consultas)
psql "$DATABASE_URL"      -f database/01_schema.sql -f database/02_triggers.sql -f database/03_procedures.sql -f database/05_usuarios_ativo.sql
psql "$DATABASE_URL_TEST" -f database/01_schema.sql -f database/02_triggers.sql -f database/03_procedures.sql -f database/05_usuarios_ativo.sql

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
| POST | `/api/auth/senha` | qualquer logado | `{ senhaAtual, novaSenha }` → 204; senha atual errada: 400 (não 401) |
| GET | `/api/usuarios` | SUPERVISOR | `[{ id, nome, email, perfil, ativo }]`, nunca o hash |
| POST | `/api/usuarios` | SUPERVISOR | `{ nome, email, perfil, senha }` → 201; e-mail duplicado: 409 `EMAIL_DUPLICADO` |
| PATCH | `/api/usuarios/:id/ativo` | SUPERVISOR | `{ ativo: true\|false }`; desativar a si mesmo: 409 `AUTO_DESATIVACAO` |

**Política de senha** (cadastro e troca): mínimo de 10 caracteres, com pelo menos uma letra e
um número, e até 72 bytes (limite do bcrypt). Senhas sempre com bcrypt (custo 10). Nenhuma
resposta devolve o hash. Usuários **não são apagados, só desativados**. Um usuário inativo
não faz login (recebe a mesma mensagem de senha errada), e o token que ele já tinha é recusado
na próxima requisição, porque o middleware consulta o banco a cada chamada.

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
| `os.html` | indicadores do `/api/kpis/resumo`, lista de OS com filtros e paginação (filtros também pela URL: `?status=&prioridade=&equipamentoId=`); "+ Nova OS" em painel lateral para OPERADOR e SUPERVISOR |
| `os-detalhe.html?id=N` | detalhe da OS: dados, peças com custo e histórico de auditoria; "Assumir" (TECNICO, OS aberta) e "Fechar" em painel lateral com lista de peças (TECNICO que assumiu ou SUPERVISOR). Falta de estoque: mensagem com peça, pedido e disponível, e a OS vai para "Aguardando peça" |
| `equipamentos.html` | resumo (total, operando, parados), lista com tag, nome, linha, criticidade, status em semáforo e OS pendentes (o link abre a lista de OS filtrada); busca e filtro; cadastro em painel lateral para SUPERVISOR |
| `estoque.html` | resumo (peças, abaixo do mínimo, valor em estoque), lista com destaque das peças abaixo do mínimo (que aparecem primeiro); para SUPERVISOR: alertas pendentes e "Entrada de estoque" em painel lateral (`CALL sp_entrada_estoque`) |
| `dashboard.html` | só indicadores e gráficos (Chart.js local em `vendor/`): situação atual (`/kpis/resumo`); totais do período de 30, 90 ou 180 dias (falhas, MTTR médio, disponibilidade média, custo); MTTR e disponibilidade por equipamento; Pareto de causas; top 5 peças; tabela "MTTR acima da média". Cada bloco indica a técnica SQL usada |
| `usuarios.html` | só SUPERVISOR (o item do menu aparece só para ele): lista de usuários, cadastro em painel lateral e ativar/desativar |
| (todas as telas) | "Trocar senha" no rodapé do menu, em painel lateral, para qualquer perfil |
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

## Qualidade e segurança (CI)

- **GitHub Actions** (`.github/workflows/ci.yml`), a cada push e pull request: sobe um
  PostgreSQL 18 em *service container* (descartável, nunca o Neon), aplica os scripts 01, 02, 03
  e 05, roda `npm audit --audit-level=high`, os testes com cobertura e as consultas BD2, e envia
  o resultado ao **SonarCloud**.
- **Cobertura:** `cd backend && npm run test:cobertura` (c8; gera `backend/coverage/lcov.info`
  e um resumo no terminal). Usa o mesmo `DATABASE_URL_TEST` do `npm test`.
- **SonarCloud:** análise pela CI (`sonar-project.properties`), não pela *Automatic Analysis*.
  O token fica só no secret `SONAR_TOKEN` do repositório.
- **Dependabot** (`.github/dependabot.yml`): PRs semanais para npm (`backend`, `database`,
  `frontend`) e GitHub Actions.
- Relatório completo do QSS (correções do Sonar, controles de segurança, cobertura e prints):
  [`docs/qss-relatorio.md`](docs/qss-relatorio.md).

## Fluxo de trabalho
- Uma issue por funcionalidade, board no GitHub Projects (To Do / In Progress / Done).
- Branch `feature/<issue>-<nome>`, commits pequenos, PR com `Closes #N`, revisão e merge na `main`.
- `.env` nunca é versionado; use `backend/.env.example` como modelo.
