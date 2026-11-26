# Relatório de Qualidade e Segurança de Software (QSS) — MaintOS

Projeto individual da AVD2 (Módulo IV). Repositório público, todos os dados são fictícios.
Ferramentas: **SonarCloud** (análise estática e cobertura), **GitHub Actions** (CI),
**c8** (cobertura), **npm audit** e **Dependabot** (dependências).

Projeto no SonarCloud: <https://sonarcloud.io/project/overview?id=dev-DaviGuerra_mini-cmms>

---

## 1. Processo de qualidade

```
push / pull request
   └─ GitHub Actions (.github/workflows/ci.yml)
        ├─ PostgreSQL 18 em service container (banco descartável, nunca o Neon)
        ├─ aplica database/01, 02, 03 e 05
        ├─ npm ci + npm audit --audit-level=high   (falha com vulnerabilidade alta/crítica)
        ├─ npm run test:cobertura                 (node:test + c8 => coverage/lcov.info)
        ├─ roda database/04_consultas_bd2.sql      (as 3 consultas BD2 executam sem erro)
        └─ SonarCloud (sonar-project.properties)  => Quality Gate no PR
```

- Cada funcionalidade nasce numa issue, vai para uma branch `feature/<issue>-<nome>` e entra na
  `main` só por pull request, revisado e aprovado pelo autor depois do Quality Gate.
- No começo, o SonarCloud usava a **Automatic Analysis**, que não recebe relatório de cobertura
  (por isso aparecia "0.0% Coverage"). Na #12 a análise passou a ser feita pela **CI**, que envia o
  `lcov.info` gerado pelo c8.
- **Dependabot** (`.github/dependabot.yml`): PRs semanais para as dependências npm do `backend`,
  `database` e `frontend` e para as versões das GitHub Actions.

---

## 2. Correções apontadas pelo SonarCloud

| # | Regra | Tipo / severidade | Onde | Problema | Correção | PR |
|---|---|---|---|---|---|---|
| 1 | S5852 | Vulnerabilidade, **crítica** | `backend/src/consultasBd2.js` | **ReDoS**: a regex `/;\s*(--[^\n]*\s*)*$/` tem quantificadores aninhados; com 49 caracteres levava **10,6 s** e travava o event loop do Node | Parser reescrito **linha a linha, sem regex**: tempo linear (100.000 caracteres em 0,4 ms), com teste de desempenho | #22 |
| 2 | S9383 | Bug (confiabilidade) | `frontend/js/os-lista.js` | **Promessas sem `await`**: 3 chamadas de `carregarLista()` sem `await`/`.catch()`/`void` (erro viraria *unhandled rejection* silenciosa) | `await` onde há o que esperar; `void` explícito, com comentário, nos tratadores de evento | #23 |
| 3 | S6850 | Acessibilidade | `frontend/os-detalhe.html` | `<h1>` vazio até o script preencher | texto padrão "Ordem de serviço", que o script troca | #27 |
| 4 | S2871 | Bug | `frontend/js/equipamentos.js` | **Ordenação com acento**: `.sort()` sem comparador ordena pelo código UTF-16 (palavras com acento iam para o fim) | `.sort((a, b) => a.localeCompare(b, 'pt-BR'))` | #30 |
| 5 | S6843 | Acessibilidade | `frontend/dashboard.html` | `role="img"` direto no `<canvas>` (elemento interativo) | `role="img"` + `aria-label` com o resumo no contêiner do gráfico | #31 |
| 6 | S6825 | Acessibilidade | `frontend/dashboard.html` | `aria-hidden` no canvas dentro de `role="img"` (redundante: os filhos de `role="img"` já são apresentacionais) | `aria-hidden` removido; cada gráfico mantém o resumo em texto e uma **tabela com os mesmos dados** | #31 |
| 7 | S5145 | Vulnerabilidade | `backend/src/middlewares/erros.js` | **Log injection**: a URL do cliente ia direto para o log do erro 500; um `%0D%0A` criaria linhas falsas no log | `semQuebras()` troca CR, LF, U+2028 e U+2029 por `_`; teste com URL maliciosa | #12 |
| 8 | S9383 | Bug | `database/seed.js` | `main()` chamada sem `await` | `await main();` (top-level await, ES Modules) | #12 |
| 9 | S7767 | Code smell | `database/seed.js` | "use `Math.trunc` em vez de `\| 0`" | **Não aplicável**: no gerador mulberry32 o `\| 0` faz o *overflow* de 32 bits que o algoritmo exige, e `Math.trunc` mudaria a sequência. Marcado com `// NOSONAR` e justificativa no código | #12 |
| 10 | plsql:CharVarchar | Bug | `database/01_schema.sql` | "use VARCHAR2 em vez de CHAR" | **Falso positivo**: regra do Oracle; o PostgreSQL não tem VARCHAR2. Primeiro foi ignorada só para `database/**/*.sql`; no #34 os `.sql` saíram da análise (ver a linha 13) | #12 |
| 11 | githubactions:S6505 | Vulnerabilidade | `.github/workflows/ci.yml` | `npm ci` sem `--ignore-scripts`: um pacote comprometido poderia rodar código na instalação (cadeia de suprimentos) | `npm ci --ignore-scripts` (o bcrypt 6 já traz o binário pronto, em `prebuilds/`) | #12 |
| 12 | githubactions:S7637 | Vulnerabilidade | `.github/workflows/ci.yml` | action de terceiro referenciada por tag (`@v8`), que pode ser movida para outro código | todas as actions fixadas pelo **SHA completo** do commit, com a versão em comentário; o Dependabot atualiza os SHAs | #12 |
| 13 | Aviso de análise | Aviso (não é *issue*) | análise da `main` | "1 analysis warning": *The Data Dictionary is not configured for the PLSQL analyzer*. O SonarCloud não tem analisador de PostgreSQL e lê os `.sql` como PL/SQL do Oracle (o log mostrava ainda 16 erros de parse em `02_triggers.sql` e `03_procedures.sql`). Não era o `fetch-depth` do checkout, que já era `0` | `database/**/*.sql` em `sonar.exclusions`, com a justificativa no `sonar-project.properties`. O SQL continua validado pela CI (scripts aplicados num PostgreSQL 18 e `04_consultas_bd2.sql` rodado no psql) e pelos testes da API | #34 |

A coluna PR é o pull request em que a correção entrou (o #12 é este). O detalhamento das correções 1 e 2 (medições, risco real e perguntas de banca) está em
`docs/estudo.md`, seção "Segurança (QSS)".

---

## 3. Controles de segurança

| Controle | Como foi feito | Evidência (teste ou configuração) |
|---|---|---|
| **Autenticação JWT** | token HS256 assinado com `JWT_SECRET` de 32+ caracteres (a API não sobe sem ele), expira em 8 h; `jwt.verify` com `algorithms: ['HS256']` fixo, contra a troca de algoritmo (`alg: none`) | `auth.test.js`: token adulterado, expirado ou ausente dá 401 |
| **Senhas com bcrypt** | custo 10 e *salt* por senha; política de 10+ caracteres com letra e número, até 72 bytes (limite do bcrypt) | hash começa com `$2b$10$`; casos inválidos dão 400 |
| **Hash nunca exposto** | colunas listadas explicitamente, sem `SELECT *`; `RETURNING` sem `senha_hash` | nenhuma resposta contém `senha_hash` nem `$2b$` |
| **Sem enumeração de contas** | e-mail inexistente, senha errada e usuário inativo recebem a mesma resposta, e o bcrypt sempre roda (mesmo tempo) | respostas idênticas no teste |
| **Perfis (autorização)** | OPERADOR / TECNICO / SUPERVISOR; `exigirPerfil()` em cada rota; o perfil vem do **banco** a cada requisição, não do token; esconder botões no front é só conforto | 403 para perfis sem permissão em todas as rotas restritas |
| **Revogação de usuário** | usuário nunca é apagado, só desativado; o middleware `autenticar` consulta `ativo` no banco a cada requisição | token emitido antes da desativação recebe 401 |
| **Privilégio mínimo** | só o SUPERVISOR gerencia usuários, sem autocadastro; o supervisor não desativa a si mesmo; na CI, o `GITHUB_TOKEN` só tem `contents: read` | 403 / 409 `AUTO_DESATIVACAO`; `permissions:` no `ci.yml` |
| **SQL Injection** | 100% das queries parametrizadas (`$1, $2…`); o usuário da auditoria entra por `set_config('app.usuario_id', $1, true)` | revisão de código; Sonar sem vulnerabilidade de injeção |
| **XSS** | dados da API entram na página só por `textContent` (`el()` de `js/ui.js`) | `front.test.js` falha se aparecer `innerHTML`, `outerHTML`, `insertAdjacentHTML` ou `document.write` |
| **CSP** (helmet) | `default-src 'self'`, `script-src 'self'`, `script-src-attr 'none'`, `style-src 'self'` (sem `'unsafe-inline'`), `object-src 'none'`, `frame-ancestors 'none'`, `base-uri 'self'`, `form-action 'self'`; sem CDN | teste do cabeçalho; teste contra script/estilo/`on*=` inline e URLs externas |
| **Rate limit** | login e troca de senha: 10 tentativas por IP a cada 15 min (configurável, validado de 1 a 10.000); `/api` inteira: 300 por 15 min; `trust proxy` = 1 (NGINX) | teste de `LOGIN_RATE_LIMIT_MAX` inválido |
| **Erros sem detalhes internos** | erro inesperado responde só "Erro interno do servidor"; detalhes e URL (sem quebras de linha) ficam no log do servidor | teste do 500 e da URL maliciosa |
| **Transações e auditoria** | toda mudança de status de OS em transação com `ROLLBACK`; a trigger `trg_auditoria_os` registra quem mudou | testes de rollback por falta de estoque e de auditoria com `usuario_id` |
| **Arquivos internos** | `package.json`, `scripts/` e `node_modules/` do front não são servidos; corpo JSON limitado a 100 kB | `front.test.js` (404 nesses caminhos) |
| **Segredos** | `.env` no `.gitignore`; `.env.example` sem valores reais; banco remoto com SSL e certificado verificado (`rejectUnauthorized: true`); na CI, `JWT_SECRET` aleatório por execução e o `SONAR_TOKEN` só como *secret* | varredura do histórico (seção 4) |
| **Dependências** | `npm audit` na CI (falha com alta/crítica); Dependabot semanal; `overrides` de `glob`/`minimatch` para versões corrigidas na árvore do c8 | `npm audit`: 0 vulnerabilidades |

**Deploy (#11, Render):** o HTTPS é feito pelo balanceador do Render (certificado automático,
HTTP redirecionado para HTTPS), e a CSP de produção inclui `upgrade-insecure-requests`. O
mesmo Express serve o front e bloqueia os caminhos internos, com teste no modo produção.
`trust proxy = 1`, com teste de que um `X-Forwarded-For` forjado não muda o contador do rate limit.
**Ainda pendente:** conectar a API com um usuário do PostgreSQL que tenha só permissões de
leitura e escrita nas tabelas (sem DDL), em vez do dono do banco.

---

## 4. Verificações da #12 (22/11/2026)

- **npm audit** (`backend`, `database`, `frontend`): **0 vulnerabilidades** em todos. A instalação
  do c8 trouxe 4 moderadas (`glob` e `minimatch`, só em desenvolvimento), corrigidas com
  `overrides` para `glob@14.0.6` e `minimatch@11.0.9`, sem rebaixar o c8.
- **Segredos no histórico do git** (117 commits, todas as branches):
  - nenhum arquivo `.env` foi versionado; só o `backend/.env.example`;
  - as connection strings encontradas são exemplos com senha de placeholder (`localhost`,
    `USUARIO:SENHA@HOST`);
  - nenhum host, senha ou identificador do Neon, nenhum token do GitHub/Sonar e nenhuma chave
    privada.
- **SonarCloud pela CI:** a análise do próprio workflow apontou `npm ci` sem `--ignore-scripts` e
  actions sem SHA fixo (corrigidos). O `JWT_SECRET` gerado na CI é mascarado no log (`::add-mask::`).
- **A CI encontrou um problema real:** os testes só passavam na máquina de desenvolvimento,
  porque o `.env` local tem `LOGIN_RATE_LIMIT_MAX=100`. Num ambiente limpo, com o padrão de
  produção (10), o 11º login dos testes recebia 429. A CI agora define o mesmo ajuste de forma
  explícita, e o padrão de produção continua 10.

---

## 5. Cobertura de testes

81 testes de integração (`node:test` + `supertest`) contra um PostgreSQL real, executados pela CI
a cada push.

| Métrica (c8, `backend/src`) | Valor |
|---|---|
| Linhas | **98,5%** (1316/1336) |
| Ramos (branches) | **90,7%** (321/354) |
| Funções | **100%** (65/65) |

**Cobertura no SonarCloud** (primeira análise pela CI, branch da #12, 22/11/2026):

| Métrica (SonarCloud) | Antes (Automatic Analysis) | Depois (análise pela CI) |
|---|---|---|
| Cobertura | 0,0% (não era enviada) | **96,8%** |
| Cobertura de linhas | — | **98,4%** (1338 linhas a cobrir) |
| Cobertura de ramos | — | **90,9%** |
| Cobertura do código novo | — | **100%** |
| Bugs / vulnerabilidades / code smells | 2 / 1 / 1 | **0 / 0 / 0** |
| Security hotspots | 0 | 0 |
| Quality Gate | — | **Passed** |

Na primeira análise pela CI, o Gate reprovou: o arquivo de teste `auth.test.js` entrou como código
sem cobertura, e o Sonar apontou as duas vulnerabilidades do próprio workflow (linhas 11 e 12 da
tabela da seção 2). Os dois problemas foram corrigidos antes do PR.

O que entra na métrica: o código da API (`backend/src`). O front (testado no navegador com Edge
headless) e o `database/seed.js` (script de carga) **continuam analisados** para bugs,
vulnerabilidades e code smells, mas ficam fora da métrica de cobertura
(`sonar.coverage.exclusions`), porque não têm testes de unidade automatizados. Os arquivos de
`backend/tests/` também ficam fora, porque são os próprios testes. O `server.js`
(só o `app.listen`) também fica fora do c8.

---

## 6. Prints para anexar

Salvar em `docs/capturas/qss/`:

1. **SonarCloud — visão geral "antes"**: a tela do projeto com "0.0% Coverage" (se já não houver
   esse print, usar o histórico em *Activity*).
2. **SonarCloud — visão geral "depois"**: Quality Gate **Passed**, cobertura e as notas A de
   Security, Reliability e Maintainability.
3. **SonarCloud — Activity**: gráfico da evolução de issues e cobertura entre as análises.
4. **SonarCloud — issue de ReDoS (S5852)** no PR #22: a vulnerabilidade crítica e o Quality Gate
   reprovado, e depois o PR aprovado.
5. **SonarCloud — Code > backend/src**: a cobertura por arquivo.
6. **GitHub Actions**: a execução verde da CI, com as etapas abertas (banco aplicado, audit,
   testes, Sonar).
7. **GitHub — PR da #12**: as verificações (CI + Quality Gate) passando.
8. **GitHub — Dependabot**: *Insights > Dependency graph > Dependabot* com os ecossistemas
   ativos.
9. **GitHub — Settings > Secrets and variables > Actions**: o `SONAR_TOKEN` cadastrado (o valor
   nunca aparece, só o nome).
10. **Terminal**: `npm audit` com "found 0 vulnerabilities" e o resumo de cobertura do
    `npm run test:cobertura`.
11. **Navegador**: o cabeçalho `Content-Security-Policy` na aba *Network* do DevTools e a
    resposta 429 depois de várias tentativas de login erradas.
