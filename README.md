# MaintOS

**Gestão de manutenção industrial (CMMS)**

[![CI](https://github.com/dev-DaviGuerra/mini-cmms/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/dev-DaviGuerra/mini-cmms/actions/workflows/ci.yml)
[![Quality Gate Status](https://sonarcloud.io/api/project_badges/measure?project=dev-DaviGuerra_mini-cmms&metric=alert_status)](https://sonarcloud.io/summary/new_code?id=dev-DaviGuerra_mini-cmms)
[![Coverage](https://sonarcloud.io/api/project_badges/measure?project=dev-DaviGuerra_mini-cmms&metric=coverage)](https://sonarcloud.io/summary/new_code?id=dev-DaviGuerra_mini-cmms)

Sistema de Ordens de Manutenção e Estoque de Peças — projeto da AVD2 (Módulo IV).
O nome junta *Maint* (de *maintenance*, manutenção) e *OS* (Ordem de Serviço).

Em produção: **https://maintos.com.br** (Render; ver [Deploy](#deploy-render)). A raiz é a
landing page pública, e o login fica em `/login.html`. O repositório
e o projeto no SonarCloud mantêm o nome técnico `mini-cmms`.

Permite cadastrar equipamentos, abrir ordens de serviço (OS), fechá-las consumindo peças do
estoque numa transação atômica e acompanhar indicadores de manutenção (MTTR, MTBF,
disponibilidade e custo). **Todos os dados são fictícios**, gerados pelo `database/seed.js`.

É um **SaaS multiempresa** (#41): várias empresas na mesma instalação, isoladas pela
*Row-Level Security* do PostgreSQL (ver [Multiempresa](#multiempresa-saas)). Uma empresa
nova pede acesso na landing, e o administrador da plataforma aprova.

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

| Banco | Variáveis no `backend/.env` | Uso |
|---|---|---|
| `cmms` | `DATABASE_URL` (papel `maintos_app`) e `DATABASE_URL_ADMIN` (dono) | API (app) e migrações/seed (dono) |
| `cmms_test` | `DATABASE_URL_TEST` (`maintos_app`) e `DATABASE_URL_TEST_ADMIN` (dono) | só `npm test` (os testes criam e apagam dados) |

Cada banco tem duas URLs. A API usa só o papel **`maintos_app`**: não é dono das tabelas, não
tem `BYPASSRLS`, não pode apagar nem mudar o schema. Com ele, a Row-Level Security vale, e
cada requisição só enxerga a própria empresa. A API **se recusa a subir** se o
`DATABASE_URL` for de um papel que ignora a RLS. A URL do dono serve só para aplicar os
scripts, rodar o seed e preparar os dados dos testes.

Os scripts SQL são **portáveis**. Usam só PostgreSQL padrão (PL/pgSQL, `TIMESTAMPTZ`, CTEs,
funções de janela), sem nenhum recurso exclusivo do Neon, e rodam igual em vários ambientes:
- PostgreSQL 14 ou mais novo, local;
- Neon (testado no PostgreSQL 19);
- PostgreSQL 18 da CI (GitHub Actions).

A conexão da API e do seed usa SSL com verificação de certificado sempre que o host não é
`localhost`.

Pré-requisitos: Node.js 20 e o `psql` 16 ou mais novo (vem com o PostgreSQL). O servidor pode ser 14+;
o `psql` 16 é preciso por causa do `\bind`, que passa as datas para as consultas BD2.

```bash
# 1. configurar variáveis (as 4 URLs, JWT_SECRET, SEED_PASSWORD)
cp backend/.env.example backend/.env

# 2. papel da API, uma vez por servidor (a senha fica fora do git; troque SENHA)
psql "$DATABASE_URL_ADMIN" -c "CREATE ROLE maintos_app LOGIN NOBYPASSRLS PASSWORD 'SENHA'"

# 3. criar o banco nos DOIS bancos, com o DONO (ordem: 01, 02, 03, 05, 06; o 04 só tem consultas).
#    O 06 (multiempresa) é reexecutável.
psql "$DATABASE_URL_ADMIN"      -f database/01_schema.sql -f database/02_triggers.sql -f database/03_procedures.sql -f database/05_usuarios_ativo.sql -f database/06_multiempresa.sql
psql "$DATABASE_URL_TEST_ADMIN" -f database/01_schema.sql -f database/02_triggers.sql -f database/03_procedures.sql -f database/05_usuarios_ativo.sql -f database/06_multiempresa.sql

# 4. popular com as duas empresas fictícias (npm run seed:teste popula o cmms_test)
cd database && npm install && npm run seed

# 5. rodar as consultas BD2 com o papel da API (padrão: empresa 1, últimos 90 dias)
psql "$DATABASE_URL" -f database/04_consultas_bd2.sql
psql "$DATABASE_URL" -v empresa_id=2 -v data_ini=2026-09-01 -v data_fim=2026-09-30 -f database/04_consultas_bd2.sql
```

> As URLs do Neon contêm `&`. No terminal, use-as sempre entre aspas.

Usuários criados pelo seed (senha = `SEED_PASSWORD` do `.env`):

| E-mail | Perfil | Empresa |
|---|---|---|
| operador@cmms.local | OPERADOR | Empresa Demonstração |
| tecnico@cmms.local | TECNICO | Empresa Demonstração |
| tecnico2@cmms.local | TECNICO | Empresa Demonstração |
| supervisor@cmms.local | SUPERVISOR | Empresa Demonstração |
| operador@metalurgica.local | OPERADOR | Metalúrgica Exemplo |
| tecnico@metalurgica.local | TECNICO | Metalúrgica Exemplo |
| supervisor@metalurgica.local | SUPERVISOR | Metalúrgica Exemplo |
| plataforma@maintos.local | PLATAFORMA | nenhuma (administra a plataforma) |

A Demonstração tem 10 equipamentos e ~200 OS; a Metalúrgica, 6 equipamentos (com as mesmas
tags R-01, PH-01... de propósito) e ~90 OS. O seed cria também 2 pedidos de acesso pendentes.

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
| GET | `/api/auth/me` | qualquer logado | dados do usuário do token (com `empresaId`, `empresaNome`, `trocarSenha`) |
| POST | `/api/solicitacoes` | público | pedido de acesso `{ empresa, responsavel, email, cidade, uf, equipamentos, consentimento: true, site }` → sempre 202 (`site` é a armadilha contra robôs); `SOLICITACAO_RATE_LIMIT_MAX` por IP/hora (padrão 5) |
| GET | `/api/plataforma/solicitacoes?status=` | PLATAFORMA | pedidos `PENDENTE` (padrão), `APROVADA` ou `RECUSADA` |
| POST | `/api/plataforma/solicitacoes/:id/aprovar` | PLATAFORMA | cria a empresa e o primeiro SUPERVISOR → 201 `{ empresa, supervisor, senhaTemporaria }` (a senha só aparece aqui; `Cache-Control: no-store`); já decidida: 409 `JA_DECIDIDA`; e-mail em uso: 409 `EMAIL_EM_USO` |
| POST | `/api/plataforma/solicitacoes/:id/recusar` | PLATAFORMA | `{ motivo? }` → 200 |
| GET | `/api/plataforma/empresas` | PLATAFORMA | nome, cidade/UF, situação e data (nada operacional) |
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
| GET | `/api/kpis/mttr-acima-media?inicio=&fim=` | qualquer logado | consulta BD2 nº 1 (subquery) → `{ inicio, fim, linhas }` |
| GET | `/api/kpis/top-pecas?inicio=&fim=` | qualquer logado | consulta BD2 nº 2 (top 5 peças consumidas no período) → `{ inicio, fim, linhas }` |
| GET | `/api/kpis/pareto-causas?inicio=&fim=` | qualquer logado | consulta BD2 nº 3 (CTE + janela) → `{ inicio, fim, linhas }` |
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
API rodam o mesmo texto. As três recebem o período como `$1` (início) e `$2` (fim), com as
mesmas datas e o mesmo padrão (últimos 90 dias) de `/api/kpis`; no psql, os valores chegam
pelo `\bind`. No dashboard, o filtro 30/90/180 dias vale para todos os blocos, menos o "Agora".

Toda resposta de erro tem o formato `{ "erro": { "codigo", "mensagem", "detalhes" } }`:

| Status | Quando |
|---|---|
| 400 | dados inválidos |
| 401 | sem token ou token inválido |
| 403 | perfil sem permissão; PLATAFORMA nas rotas das empresas; `TROCA_SENHA_OBRIGATORIA` com senha temporária |
| 404 | não encontrado, **inclusive registro de outra empresa** (para a empresa A, a OS da B não existe) |
| 409 | estoque insuficiente ou status inválido |

## Front

HTML + CSS + JavaScript puro (ES Modules), sem framework e sem build, na pasta `frontend/`.
Em desenvolvimento, o próprio Express serve a pasta: com a API rodando (`npm start` em `backend/`),
abra **http://localhost:3000**. Em produção (Render) é igual: o mesmo processo Node serve a
API e o front, na mesma origem.

| Página | Conteúdo |
|---|---|
| `index.html` | **landing page pública** (raiz do site): o que o sistema faz, como funciona e "Para sua empresa"; botões "Solicitar acesso" (formulário) e "Entrar", com "ou escreva para" (`mailto:`) e o e-mail visível com botão "Copiar e-mail" (`js/landing.js`), para quem não tem programa de e-mail. No hero, uma captura real do Dashboard (`img/dashboard.webp`, com fallback `dashboard.png`). Sem formulário e sem gravar dados |
| `login.html` | login em tela dividida (o JWT fica no `sessionStorage`). O 401, o "Sair" e a 404 levam para cá. Depois do login, cada perfil vai para a sua página inicial (OS, painel da plataforma ou troca de senha) |
| `solicitar-acesso.html` | formulário público de pedido de acesso, com consentimento LGPD e campo armadilha contra robôs |
| `privacidade.html` | aviso de privacidade (quais dados, para quê, por quanto tempo, direitos) |
| `plataforma.html` | painel do PLATAFORMA: pedidos (aprovar mostra a senha temporária uma vez; recusar com motivo) e lista de empresas |
| `trocar-senha.html` | troca obrigatória da senha temporária no primeiro login |
| `os.html` | indicadores do `/api/kpis/resumo`, lista de OS com filtros e paginação (filtros também pela URL: `?status=&prioridade=&equipamentoId=`); "+ Nova OS" em painel lateral para OPERADOR e SUPERVISOR |
| `os-detalhe.html?id=N` | detalhe da OS: dados, peças com custo e histórico de auditoria; "Assumir" (TECNICO, OS aberta) e "Fechar" em painel lateral com lista de peças (TECNICO que assumiu ou SUPERVISOR). Falta de estoque: mensagem com peça, pedido e disponível, e a OS vai para "Aguardando peça" |
| `equipamentos.html` | resumo (total, operando, parados), lista com tag, nome, linha, criticidade, status em semáforo e OS pendentes (o link abre a lista de OS filtrada); busca e filtro; cadastro em painel lateral para SUPERVISOR |
| `estoque.html` | resumo (peças, abaixo do mínimo, valor em estoque), lista com destaque das peças abaixo do mínimo (que aparecem primeiro); para SUPERVISOR: alertas pendentes e "Entrada de estoque" em painel lateral (`CALL sp_entrada_estoque`) |
| `dashboard.html` | só indicadores e gráficos (Chart.js local em `vendor/`): situação atual (`/kpis/resumo`); totais do período de 30, 90 ou 180 dias (falhas, MTTR médio, disponibilidade média, custo); MTTR e disponibilidade por equipamento; Pareto de causas; top 5 peças; tabela "MTTR acima da média". O período vale para todos os blocos, menos a situação atual. A técnica SQL e as explicações ficam no tooltip ⓘ de cada bloco (mouse ou teclado) |
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
- `package.json`, `scripts/` e `node_modules/` do front não são servidos (404), em
  desenvolvimento e em produção.

## Deploy (Render)

Arquitetura em produção:

```
navegador ──HTTPS──> maintos.com.br ──DNS (Registro.br)──> Render
                                                           │ balanceador: termina o HTTPS
                                                           │ (certificado automático) e
                                                           │ redireciona HTTP -> HTTPS
                                                           ▼
                                                     Node 20 + Express (1 processo)
                                                     /api/*  -> API
                                                     /*      -> frontend/ (estáticos)
                                                           │ TLS, certificado verificado
                                                           ▼
                                                     Neon (PostgreSQL gerenciado)
```

- **Domínio:** `maintos.com.br`, registrado no Registro.br. O DNS do Registro.br (modo
  avançado) aponta o domínio para o Render: registro `A` da raiz para o IP do balanceador do
  Render e `CNAME` do `www` para o subdomínio `.onrender.com` do serviço. O `www` redireciona
  para a raiz.
- **Render:** é o servidor web e o proxy reverso. Faz o HTTPS (certificado criado e renovado
  sozinho), redireciona HTTP para HTTPS e repassa a requisição ao Node por HTTP. Não há NGINX:
  o próprio Express serve o `frontend/`, com a mesma 404 e o mesmo bloqueio de arquivos
  internos do desenvolvimento.
- **Aplicação:** um *web service* Node descrito em [`render.yaml`](render.yaml) (Blueprint):
  `rootDir: backend`, build `npm ci --omit=dev --ignore-scripts`, start `npm start`, health
  check em `/api/health`, plano free, região `virginia` (não há região na América do Sul; é a
  mais próxima do Brasil). Só publica um commit da `main` depois que a CI passa
  (`autoDeployTrigger: checksPass`).
- **Banco:** continua no Neon, acessado por `DATABASE_URL`, com SSL e certificado verificado.

Variáveis de ambiente do serviço:

| Variável | Valor | Onde é definida |
|---|---|---|
| `DATABASE_URL` | connection string do banco de produção no Neon, com o papel **`maintos_app`** (#41) | painel do Render (secreta) |
| `JWT_SECRET` | segredo novo, só de produção (96 caracteres hex) | painel do Render (secreta) |
| `NODE_ENV` | `production` | `render.yaml` |
| `NODE_VERSION` | `20` (a mesma versão da CI) | `render.yaml` |
| `LOGIN_RATE_LIMIT_MAX` | `10` | `render.yaml` |
| `TRUST_PROXY` | `1` (o balanceador do Render) | `render.yaml` |
| `PORT` | definida pelo próprio Render (padrão 10000) | automática |

Atrás do proxy: `trust proxy = 1` faz o Express usar o último endereço do `X-Forwarded-For`,
que é o que o balanceador acrescenta. Assim o rate limit conta por cliente, e um IP forjado
pelo cliente no começo do cabeçalho não muda o contador (há teste). Em produção a CSP inclui
`upgrade-insecure-requests`, e o helmet envia HSTS, `nosniff`, `X-Frame-Options` e
`Referrer-Policy`.

O Render não documenta quantos proxies existem antes do Node. Por isso, conferir depois do
deploy que o `TRUST_PROXY=1` está certo, olhando o cabeçalho `RateLimit` (`remaining=` é o
que sobra da cota do IP):

```bash
# 1) da sua rede, duas vezes: remaining cai de 1 em 1 (299, 298...)
curl -s -o /dev/null -D - https://maintos.com.br/api/nao-existe | grep -i '^ratelimit:'
# 2) de outra rede (ex.: 4G do celular): remaining começa de novo em 299
#    Se continuar a sequência da sua rede, todos os clientes dividem o mesmo contador:
#    aumentar TRUST_PROXY para 2 no painel e repetir.
# 3) forjando um IP: remaining continua a sequência da sua rede (o forjado é ignorado)
curl -s -o /dev/null -D - -H 'X-Forwarded-For: 1.2.3.4' https://maintos.com.br/api/nao-existe | grep -i '^ratelimit:'
#    Se voltar para 299, o valor está alto demais: diminuir TRUST_PROXY.
```

**Cold start do plano free:** depois de 15 minutos sem requisições o Render desliga a
instância. A próxima requisição a liga de novo, o que leva cerca de 1 minuto, e por isso a
primeira página demora. O Neon também suspende o banco quando ele fica ocioso, e a primeira
consulta acorda o banco. Antes de uma apresentação, abra o site alguns minutos antes. O plano
free tem 750 horas de instância por mês e disco efêmero, mas o sistema não grava arquivos:
todos os dados ficam no Neon.

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

## Multiempresa (SaaS)

Até a #37, cada fábrica recebia a própria instalação (*single-tenant*). Na #41 o MaintOS virou
**multiempresa**: várias empresas na mesma instalação e no mesmo banco, isoladas pelo próprio
PostgreSQL. A migração de produção segue o roteiro de [`docs/migracao-producao.md`](docs/migracao-producao.md).

**Banco (`database/06_multiempresa.sql`, reexecutável)**
- Tabela `empresas` e coluna `empresa_id NOT NULL` nas 8 tabelas de negócio. Os dados que já
  existiam foram para a "Empresa Demonstração". O `DEFAULT` da coluna é a empresa do contexto
  da requisição, então os `INSERT` da API, das triggers e da procedure não mudaram.
- Chaves estrangeiras **compostas** `(empresa_id, x_id)`: nem um bug liga a OS da empresa A ao
  equipamento da B. Tag do equipamento e código da peça são únicos **por empresa**; o e-mail,
  na plataforma inteira (o login é só por e-mail).
- **Row-Level Security** com `ENABLE` e **`FORCE`** em todas as tabelas, e políticas
  `empresa_id = current_setting('app.empresa_id')`. Sem contexto, nenhuma linha aparece.
- Papel **`maintos_app`** para a API: sem `BYPASSRLS`, sem ser dono, sem `DELETE`.
- Funções `SECURITY DEFINER` só para o que precisa ver além de uma empresa: `fn_login` (no
  login ainda não há empresa), `fn_sessao` (confere o usuário e grava o contexto) e
  `fn_aprovar_solicitacao` (cria a empresa e o primeiro supervisor).

**Contexto por requisição, com poucas viagens ao banco.** A API roda no Render (Virginia) e o
banco no Neon (São Paulo): cada viagem custa ~110 ms. No início de cada requisição autenticada,
`fn_sessao()` confere o usuário e grava `app.empresa_id`, `app.usuario_id` e `app.plataforma`
com `set_config`, **na mesma viagem** que a autenticação já fazia. Cada conexão do pool lembra
qual contexto está gravado nela e só o regrava se a próxima requisição for de outra empresa.
Além disso, o período dos KPIs é calculado no Node, e a lista e o detalhe da OS viraram uma
consulta cada. Resultado: toda rota autenticada faz **2 viagens** (antes, de 1 a 4).

**Perfis.** OPERADOR, TECNICO e SUPERVISOR pertencem a uma empresa. O **PLATAFORMA** fica fora
das empresas (tabela `usuarios_plataforma`): vê só os pedidos de acesso e a lista de empresas, e
recebe 403 nas rotas das empresas. Mesmo que chegasse a elas, a RLS não lhe mostraria nenhuma
linha, porque ele nunca grava `app.empresa_id`.

**Entrada de clientes.** Na landing, **Solicitar acesso** abre um formulário (empresa,
responsável, e-mail, cidade/UF, nº de equipamentos e consentimento da LGPD, com
[aviso de privacidade](frontend/privacidade.html)). O pedido é gravado como PENDENTE, com
rate limit por IP, campo armadilha contra robôs e validação no servidor. O PLATAFORMA aprova
no painel: nasce a empresa e o primeiro SUPERVISOR, com uma **senha temporária mostrada uma
única vez**, e a troca é obrigatória no primeiro login.

**Testes de isolamento.** `isolamento-api.test.js`: a empresa A não lista, não lê, não
assume, não fecha e não altera OS, peças, equipamentos e usuários da B (404).
`isolamento-sql.test.js`: conectado como `maintos_app`, o próprio banco não devolve nem grava
linhas de outra empresa. `plataforma.test.js`: cadastro público, aprovação e troca obrigatória.

**Ainda fora do escopo:** envio de e-mail automático (a senha temporária é repassada pelo
administrador; o plano free do Render bloqueia SMTP), recuperação de senha, cobrança, planos,
subdomínio por empresa, exportação e exclusão dos dados de uma empresa (LGPD), e limpeza
automática dos pedidos recusados após 90 dias (hoje é manual).

## Fluxo de trabalho
- Uma issue por funcionalidade, board no GitHub Projects (To Do / In Progress / Done).
- Branch `feature/<issue>-<nome>`, commits pequenos, PR com `Closes #N`, revisão e merge na `main`.
- `.env` nunca é versionado; use `backend/.env.example` como modelo.
