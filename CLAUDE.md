# CLAUDE.md — Regras do projeto MaintOS

Projeto individual da AVD2 (Módulo IV). Apresentação: **01/12/2026**.
Referência completa: `Mini-CMMS_Projeto_AVD2.pdf` (local, fora do git).

**Nome do produto: MaintOS** ("OS" maiúsculo: *Maint* de *maintenance* + *OS* de Ordem de
Serviço). Subtítulo: "Gestão de manutenção industrial (CMMS)". Em toda tela, título e doc usar
"MaintOS". O repositório, a chave do SonarCloud e os nomes de pacote npm continuam `mini-cmms`
(não renomear). No login, o "OS" fica em `--destaque` pela classe `.marca-os`.

## Escopo MVP (não adicionar nada além disto)

**PostgreSQL**
- Tabelas da seção 5 do PDF: usuarios, equipamentos, pecas, ordens_servico, os_pecas,
  movimentacoes, alertas_estoque, os_auditoria.
- Triggers `trg_estoque_minimo` e `trg_auditoria_os`.
- Função `sp_kpis_equipamento(data_ini, data_fim)` (MTTR, MTBF, disponibilidade, custo).
- Procedure `sp_entrada_estoque(p_peca_id, p_qtd, p_usuario_id)` (CALL): soma estoque, grava
  ENTRADA e resolve alertas quando o estoque volta a ficar >= mínimo.
- 3 consultas BD2 em `database/04_consultas_bd2.sql`.
- `database/seed.js`: duas empresas (Empresa Demonstração: 10 equipamentos, 30 peças, ~200 OS;
  Metalúrgica Exemplo: 6 equipamentos, 30 peças, ~90 OS), o PLATAFORMA e 2 pedidos pendentes.
  `npm run seed` usa `DATABASE_URL_ADMIN`; `npm run seed:teste`, o `DATABASE_URL_TEST_ADMIN`.
- `database/05_usuarios_ativo.sql` (#28): coluna `usuarios.ativo`.
- `database/06_multiempresa.sql` (#41, reexecutável): ver "Multiempresa" abaixo. Ordem de
  aplicação: 01, 02, 03, 05, 06 (o 04 só tem consultas), sempre com a URL do DONO.

**API** — Node 20 + Express (ES Modules)
- Login JWT com perfis OPERADOR / TECNICO / SUPERVISOR (por empresa) e PLATAFORMA (#41);
  senhas com bcrypt.
- Rotas: OS (abrir, assumir, fechar com transação e ROLLBACK), equipamentos, peças, KPIs.
- Gestão de usuários (#28): `/api/usuarios` (SUPERVISOR) e `POST /api/auth/senha`.
- Sempre queries parametrizadas; `helmet`; `express-rate-limit`.

**Front** — HTML + JS vanilla + Chart.js
- Telas: login, lista de OS, detalhe/fechamento da OS, usuários (SUPERVISOR), dashboard;
  multiempresa (#41): `solicitar-acesso.html`, `privacidade.html`, `plataforma.html`
  (PLATAFORMA) e `trocar-senha.html` (troca obrigatória da senha temporária).
- Landing page pública (#37, #39, #41): a raiz `/` (`index.html`) não tem formulário nem grava
  dados. O botão principal é "Solicitar acesso" (`/solicitar-acesso.html`); o "ou escreva
  para" é um `mailto:`. O único JS da landing é `js/landing.js` ("Copiar e-mail",
  melhoria progressiva: o botão nasce `hidden`; se a Clipboard API falhar, seleciona o texto).
  A captura do hero (`img/dashboard.webp` + fallback `.png`, 1600×1000) vem do sistema rodando
  com o seed; se o visual do dashboard mudar, gerar de novo e atualizar o `alt`. O login fica em `login.html`,
  e todo redirecionamento para o login (401, "Sair", 404) aponta para `login.html`, nunca
  para a raiz. O único link externo permitido é o do GitHub (há teste).
- Escopo ampliado a pedido do usuário: telas de Equipamentos e Estoque (#26). A entrada de
  estoque fica na tela de Estoque, e o dashboard (#10) só tem indicadores e gráficos.
- Gráficos (dashboard): Chart.js UMD local em `frontend/vendor/` (copiado por `npm run vendor`).
  As cores são lidas dos tokens `--grafico-*`. Nunca usar eixo duplo; barras começam no zero
  (eixo cortado só com pontos); referências em tinta neutra tracejada; tabela de dados sob cada
  gráfico.

**Qualidade (#12):** CI no GitHub Actions (`.github/workflows/ci.yml`) com PostgreSQL 18 em
service container (nunca o Neon na CI), `npm audit --audit-level=high`, `npm run test:cobertura`
(c8 => `backend/coverage/lcov.info`) e SonarCloud pela CI (`sonar-project.properties`; a
Automatic Analysis fica desligada). Dependabot em `.github/dependabot.yml`. Relatório em
`docs/qss-relatorio.md`. Na CI, `LOGIN_RATE_LIMIT_MAX=100` (os testes fazem mais de 10 logins).
Não usar `// NOSONAR` nem ignorar regra sem justificativa escrita no código ou no properties.
No novo escopo do SonarCloud, `sonar.sources`/`sonar.tests` não têm efeito: o escopo se ajusta
só com `sonar.exclusions` e `sonar.coverage.exclusions`. Os `.sql` ficam fora da análise (#34): o
SonarCloud os lê como PL/SQL do Oracle, o que gerava o aviso do Data Dictionary e erros de parse. Actions do workflow fixadas por SHA
completo (S7637) e `npm ci --ignore-scripts` (S6505).

**Deploy (#11): Render**, não Azure. Ver a seção "Deploy (Render)" abaixo.

Fora do escopo (só se o usuário pedir): cancelamento de OS, entrada de nota, cadastro aberto
(autocadastro) de usuários, artigo, slides. O pedido de acesso da #41 não é autocadastro: só
vira empresa depois da aprovação do PLATAFORMA.

**Segurança de usuários (#28):**
- Nunca apagar usuário, só desativar.
- Nunca devolver `senha_hash`: listar as colunas explicitamente, sem `SELECT *`.
- O middleware `autenticar` consulta o banco a cada requisição: usuário inativo recebe 401, e o
  perfil vem do banco, não do token.
- Erros de senha atual usam 400, nunca 401, porque um 401 derruba a sessão no front.

## Regras de trabalho
1. Manter `README.md` e este `CLAUDE.md` atualizados.
2. Uma issue por funcionalidade (via `gh`) e GitHub Project com colunas To Do / In Progress / Done.
3. Cada funcionalidade em `feature/<issue>-<nome>`, commits pequenos, PR com `Closes #N`.
   **O usuário revisa e faz o merge** — nunca fazer merge nem push na `main` diretamente.
4. Ao terminar cada etapa, adicionar em `docs/estudo.md`: explicação de 5 linhas do que foi feito
   + 3 perguntas que um professor poderia fazer, com as respostas.
5. Nunca commitar `.env`. Manter `.env.example` sem segredos reais.
6. **Nunca sobrescrever o `backend/.env`.** Proibido rodar `cp`, `mv`, redirecionamento `>`,
   `writeFileSync`, Write/Edit ou qualquer comando que substitua esse arquivo. Para alterá-lo,
   **só acrescentar linhas no fim** (`>>` ou `fs.appendFileSync`). O dotenv usa a última
   ocorrência de uma chave, então acrescentar basta para trocar um valor. Nunca exibir os valores
   do `.env`.
   *Motivo:* em 21/11 um comando sobrescreveu o `.env` com o `.env.example` e as credenciais do
   Neon tiveram de ser trocadas.
7. Para gerar arquivos com texto que contenha crases (Markdown), usar a ferramenta Write ou um
   heredoc com delimitador entre aspas simples (`<<'EOF'`). Nunca usar texto com crases dentro de
   aspas duplas no shell: o bash executa o conteúdo das crases como comando. Foi assim que o
   `.env` foi sobrescrito.

## Decisões de negócio (seção 6.2 do PDF)
- Prioridades: BAIXA / MEDIA / ALTA / EMERGENCIA.
- Status da OS: ABERTA, EM_ANDAMENTO, AGUARDANDO_PECA, FECHADA, CANCELADA.
- MTTR medido de `aberta_em` até `fechada_em` (tempo de equipamento parado), só OS CORRETIVAS fechadas.
- Custo da hora técnica: parâmetro `p_custo_hora` da função de KPIs (padrão R$ 80,00).
- Usuário da auditoria: a trigger lê `current_setting('app.usuario_id', true)`.
- **Regra obrigatória da API:** TODA mudança de status de OS (abrir→assumir, assumir, fechar,
  aguardar peça, cancelar) roda numa transação (`BEGIN` … `COMMIT`/`ROLLBACK`) e executa
  `SET LOCAL app.usuario_id = '<id do JWT>'` **antes** do `UPDATE` do status. Vale também para
  assumir a OS, não só para fechar. Sem isso, a auditoria grava `usuario_id` NULL.
  (`SET LOCAL` não aceita parâmetro `$1`; use `SELECT set_config('app.usuario_id', $1, true)`.)
- Todos os dados são fictícios (repositório público).

## Banco de dados: Neon
- O banco é o **Neon** (PostgreSQL gerenciado, PG 19), com dois bancos e duas URLs cada:
  - `cmms`: `DATABASE_URL` (papel `maintos_app`, API) e `DATABASE_URL_ADMIN` (dono, migrações e
    seed). **O `cmms` é o banco de produção** (o Render usa o mesmo): nada de testes nele;
  - `cmms_test`: `DATABASE_URL_TEST` (`maintos_app`) e `DATABASE_URL_TEST_ADMIN` (dono), só para
    o `npm test` e o teste no navegador.
- O dono (`cmms_owner`) tem `BYPASSRLS`. **A API nunca usa o dono** (ela se recusa a subir).
  A URL de produção do `maintos_app` está em
  `C:\Users\davim\maintos-segredos\DATABASE_URL_producao_maintos_app.txt`. Nunca exibir.
- **Nunca exibir as connection strings** (contêm usuário e senha). Para usá-las num comando,
  leia-as do `.env` sem imprimir.
- Os scripts SQL são **portáveis**: só PostgreSQL padrão, sem recurso exclusivo do Neon. Devem
  continuar rodando também em PostgreSQL local 14+ e no PostgreSQL 18 da CI.
- Banco remoto => `ssl: { rejectUnauthorized: true }`. A regra fica em `configConexao()`
  (`backend/src/db.js` e `database/seed.js`). Os parâmetros `sslmode`/`channel_binding` da URL
  são removidos para o driver `pg`.
- `npm test` usa `NODE_ENV=test` (via cross-env). O `config.js` troca para `DATABASE_URL_TEST`
  e falha se ele for igual ao `DATABASE_URL`. Os testes nunca tocam o banco de desenvolvimento.

## Convenções da API
- Camadas: `routes` (valida a entrada) → `services` (regra de negócio) → `db`.
- Escrita com mais de um passo usa `transacao(fn)` de `db.js` (`BEGIN`, `COMMIT`/`ROLLBACK`).
  Empresa e usuário vêm do contexto da requisição (ver "Multiempresa"), não de parâmetro.
- Erros: lançar as classes de `src/errors.js`; o middleware `erros.js` formata a resposta.
- `trust proxy` vem de `TRUST_PROXY` (padrão 1, o balanceador do Render). Nunca `true`: o
  Express usaria o primeiro IP do `X-Forwarded-For`, que o cliente pode forjar.
- `app.js` exporta `criarApp({ producao, trustProxy })` e `app = criarApp()`. Os testes de
  produção montam o app com `criarApp({ producao: true })`.
- `/api/health` fica antes do rate limit (health check do Render) e não consulta o banco.
- Consultas BD2: a fonte única é `database/04_consultas_bd2.sql`. Cada consulta começa com
  `-- @consulta <nome>` e é exposta em `/api/kpis/<nome>` (`src/consultasBd2.js`). Não copiar
  o SQL para o JavaScript. As consultas recebem o período em `$1`/`$2` (datas, como em
  `sp_kpis_equipamento`); no psql os valores vêm de `\bind` (psql 16+), com padrão de 90 dias
  calculado no cabeçalho do arquivo (`-v data_ini=... -v data_fim=...` para outro período).
- Testes em `backend/tests/*.test.js`. Cada arquivo cria e remove os próprios dados
  (`tests/helpers.js`).

## Convenções do front (`frontend/`)
- HTML + CSS + JS puro com ES Modules, sem framework e sem build. O Express serve a pasta em
  desenvolvimento **e em produção** (no Render não há NGINX), com a 404 e o bloqueio de
  `package.json`, `scripts/` e `node_modules/`.
- Toda chamada à API passa por `js/api.js` (token do `sessionStorage`, `ErroApi`, 401 => login).
  Páginas protegidas começam com `const usuario = await exigirLogin();`.
- **Nunca `innerHTML`/`outerHTML`/`insertAdjacentHTML`** com dados: criar os elementos com
  `el()` de `js/ui.js` (usa `textContent`). Há um teste que falha se aparecerem no código.
- CSP sem `'unsafe-inline'`: nada de `<script>` inline, `style="..."` ou `onclick=` no HTML
  (também há teste). Estilos só em `css/estilo.css`; eventos com `addEventListener`.
- Esconder botões por perfil é só conforto; a permissão é sempre validada na API.
- Teste no navegador: Edge headless com `puppeteer-core` instalado no scratchpad (fora do
  projeto). O `.env` de desenvolvimento tem `LOGIN_RATE_LIMIT_MAX=100`, então as rodadas não
  bloqueiam o login. Em produção o padrão é 10.

## Visual (redesign da #24) — seguir em todas as telas novas
- Conceito "sala de controle industrial". Usar **só os design tokens** do topo de
  `css/estilo.css` (cores, `--esp-*`, `--texto-*`, `--raio*`, sombras); não inventar cores soltas.
- Uma única cor de destaque: `--destaque` (amarelo de segurança `#F2A900`), para a ação
  principal da tela (`.botao.primario`) e o foco. Texto sobre ela: `--sobre-destaque`.
- Status de OS = `marcaStatus()` de `ui.js` (ponto colorido + texto), nunca só cor.
  Prioridade = `marcaPrioridade()` + barra lateral na linha (`tr.prioridade-*`).
- Números, tags, nº de OS e datas em `--fonte-mono` (IBM Plex Mono); texto em IBM Plex Sans.
  Fontes locais em `frontend/fontes/`, sem CDN (há teste contra URLs externas).
- Página nova do app: `<body class="app">`, `<aside id="menu" class="menu-lateral">`,
  `<main class="conteudo">` e `montarLayout(usuario, '<id>')`. Ao criar a tela, ativar o item
  correspondente em `ITENS_MENU` (`ui.js`), dando um `href`.
- Estados obrigatórios: carregando (`linhasSkeleton()` + `aria-busy`), vazio (`estadoVazio()`)
  e foco visível pelo teclado (`:focus-visible` já está no CSS).
- Formulários secundários em drawer: HTML `.drawer` com `inert` + `.fundo-drawer`, e a lógica
  vem de `criarDrawer()` de `ui.js` (Esc fecha, Tab preso, foco volta ao botão). Não reimplementar.
- Explicações e técnica SQL ficam num ícone ⓘ discreto (`.info-dica` > `button.botao-info` com
  `aria-describedby` + `span[role=tooltip].dica`), ativado por `ativarDicas()` de `ui.js` (hover,
  foco, Esc, e mantém o texto dentro da janela). Nada de texto explicativo longo na tela.
- Fluxos que gravam dados (assumir, fechar, cadastrar) são testados no navegador contra uma
  **segunda instância da API** com `NODE_ENV=test PORT=3001`, que usa o `cmms_test`. Um script de
  fixtures no scratchpad cria usuários, equipamento, peças e OS e os apaga no final. Nunca gravar
  dados de teste no `cmms` de desenvolvimento. Parar a instância 3001 antes de rodar `npm test`,
  porque os dois usam o mesmo banco.
- Rotas inexistentes fora de `/api` mostram `404.html` (caminhos absolutos nela).

## Deploy (Render) — issue #11
- Domínio `maintos.com.br` no Registro.br (DNS do Registro.br, modo avançado): `A` da raiz para o
  IP do balanceador do Render e `CNAME` do `www` para `<serviço>.onrender.com`. O Render faz o
  HTTPS (certificado automático) e redireciona HTTP para HTTPS e `www` para a raiz.
- `render.yaml` (Blueprint) na raiz: web service `maintos`, `runtime: node`, `rootDir: backend`,
  `npm ci --omit=dev --ignore-scripts`, `npm start`, `healthCheckPath: /api/health`, `plan: free`,
  `region: virginia` (não há região na América do Sul), `autoDeployTrigger: checksPass`.
  O `buildFilter` inclui `frontend/**` e o `04_consultas_bd2.sql`, que ficam fora do `rootDir`.
- Variáveis: `DATABASE_URL` (papel `maintos_app`, desde a #41) e `JWT_SECRET` só no painel do
  Render (`sync: false`);
  `NODE_ENV=production`, `NODE_VERSION=20`, `LOGIN_RATE_LIMIT_MAX=10` e `TRUST_PROXY=1` no
  `render.yaml`; `PORT` é do Render. O `JWT_SECRET` de produção fica fora do git, em
  `C:\Users\davim\maintos-segredos\JWT_SECRET_producao.txt`. Nunca exibir o valor nem commitá-lo.
- Plano free: a instância dorme após 15 min sem tráfego, e acordar leva cerca de 1 min (cold
  start). Abrir o site antes da apresentação.

## Multiempresa (SaaS) — issue #41
- Isolamento por **Row-Level Security** (`ENABLE` + `FORCE`) nas 8 tabelas de negócio, com
  política `empresa_id = current_setting('app.empresa_id')`. Sem contexto: nenhuma linha.
- `empresa_id NOT NULL` com `DEFAULT` = empresa do contexto: INSERT novo não precisa informá-la.
  FKs compostas `(empresa_id, x_id)`. Tag e código únicos por empresa; e-mail único na
  plataforma (trigger `trg_email_unico` entre `usuarios` e `usuarios_plataforma`).
- Contexto por requisição: `autenticar` chama `fn_sessao()` (SECURITY DEFINER), que confere o
  usuário e grava `app.empresa_id`/`app.usuario_id`/`app.plataforma` na conexão na mesma
  viagem. `db.js` guarda o contexto no `AsyncLocalStorage`, e cada conexão do pool lembra o
  que tem gravado (só regrava se mudar). Usar sempre `query()`/`transacao()` de `db.js`;
  **nunca `pool.query` direto na API**.
- Desempenho: Render (Virginia) ↔ Neon (São Paulo) ~110 ms por viagem. Não criar transação
  nem consulta extra sem necessidade; preferir uma consulta só (subconsulta/`json_agg`).
- Três portas: `autenticar` (empresas; PLATAFORMA leva 403), `autenticarPlataforma` e
  `autenticarQualquer` (`/api/auth/me`, `/api/auth/senha`). Senha temporária => 403
  `TROCA_SENHA_OBRIGATORIA` fora dessas duas rotas.
- PLATAFORMA (`usuarios_plataforma`) nunca grava `app.empresa_id` e não vê dados operacionais.
  Aprovar = `fn_aprovar_solicitacao` (cria empresa + SUPERVISOR com `trocar_senha`). A senha
  temporária só aparece na resposta da aprovação (`no-store`); no banco fica só o hash.
- Cadastro público `POST /api/solicitacoes`: rate limit `SOLICITACAO_RATE_LIMIT_MAX` (padrão 5
  por IP/hora), honeypot `site`, consentimento obrigatório, resposta sempre 202.
- Rota nova de empresa: o 404 entre empresas vem de graça (a RLS esconde a linha); escrever
  teste em `isolamento-api.test.js`. Tabela nova de negócio: `empresa_id` + política no 06 (ou
  num 07 reexecutável) + teste em `isolamento-sql.test.js`.
- Testes: `tests/helpers.js` cria uma empresa por arquivo com o pool do DONO (contexto gravado
  em cada conexão) e apaga tudo dela no `encerrar()`; a API dos testes usa o `maintos_app`.
- Produção: roteiro em `docs/migracao-producao.md` (backup no Neon, 06, `DATABASE_URL`, merge,
  testes de fumaça, como voltar atrás).

## Comandos
```bash
# aplicar o banco com o DONO (URLs lidas do backend/.env; sempre entre aspas por causa do &)
psql "$DATABASE_URL_ADMIN"      -f database/01_schema.sql -f database/02_triggers.sql -f database/03_procedures.sql -f database/05_usuarios_ativo.sql -f database/06_multiempresa.sql
psql "$DATABASE_URL_TEST_ADMIN" -f database/01_schema.sql -f database/02_triggers.sql -f database/03_procedures.sql -f database/05_usuarios_ativo.sql -f database/06_multiempresa.sql
cd database && npm install && npm run seed        # seed:teste => cmms_test
psql "$DATABASE_URL" -v empresa_id=1 -f database/04_consultas_bd2.sql
cd backend && npm test && npm start
cd backend && npm run test:cobertura   # cobertura (c8, lcov em backend/coverage/)
```
