# CLAUDE.md — Regras do projeto Mini-CMMS

Projeto individual da AVD2 (Módulo IV). Apresentação: **01/12/2026**.
Referência completa: `Mini-CMMS_Projeto_AVD2.pdf` (local, fora do git).

## Escopo MVP (não adicionar nada além disto)

**PostgreSQL**
- Tabelas da seção 5 do PDF: usuarios, equipamentos, pecas, ordens_servico, os_pecas,
  movimentacoes, alertas_estoque, os_auditoria.
- Triggers `trg_estoque_minimo` e `trg_auditoria_os`.
- Função `sp_kpis_equipamento(data_ini, data_fim)` (MTTR, MTBF, disponibilidade, custo).
- Procedure `sp_entrada_estoque(p_peca_id, p_qtd, p_usuario_id)` (CALL): soma estoque, grava
  ENTRADA e resolve alertas quando o estoque volta a ficar >= mínimo.
- 3 consultas BD2 em `database/04_consultas_bd2.sql`.
- `database/seed.js`: 10 equipamentos, 30 peças, ~200 OS fictícias em 90 dias.
- `database/05_usuarios_ativo.sql` (#28): coluna `usuarios.ativo`. Ordem de aplicação: 01, 02,
  03, 05 (o 04 só tem consultas).

**API** — Node 20 + Express (ES Modules)
- Login JWT com perfis OPERADOR / TECNICO / SUPERVISOR; senhas com bcrypt.
- Rotas: OS (abrir, assumir, fechar com transação e ROLLBACK), equipamentos, peças, KPIs.
- Gestão de usuários (#28): `/api/usuarios` (SUPERVISOR) e `POST /api/auth/senha`.
- Sempre queries parametrizadas; `helmet`; `express-rate-limit`.

**Front** — HTML + JS vanilla + Chart.js
- Telas: login, lista de OS, detalhe/fechamento da OS, usuários (SUPERVISOR), dashboard.
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
só com `sonar.exclusions` e `sonar.coverage.exclusions`. Actions do workflow fixadas por SHA
completo (S7637) e `npm ci --ignore-scripts` (S6505).

Fora do escopo (só se o usuário pedir): cancelamento de OS, entrada de nota, cadastro aberto
(autocadastro) de usuários, deploy, artigo, slides.

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
- O banco é o **Neon** (PostgreSQL gerenciado, PG 19), com dois bancos:
  - `cmms` (`DATABASE_URL`): usado pela API e pelo seed;
  - `cmms_test` (`DATABASE_URL_TEST`): usado só pelo `npm test`.
- **Nunca exibir as connection strings** (contêm usuário e senha). Para usá-las num comando,
  leia-as do `.env` sem imprimir.
- Os scripts SQL são **portáveis**: só PostgreSQL padrão, sem recurso exclusivo do Neon. Devem
  continuar rodando também em PostgreSQL local 14+ e na VM da Azure (deploy).
- Banco remoto => `ssl: { rejectUnauthorized: true }`. A regra fica em `configConexao()`
  (`backend/src/db.js` e `database/seed.js`). Os parâmetros `sslmode`/`channel_binding` da URL
  são removidos para o driver `pg`.
- `npm test` usa `NODE_ENV=test` (via cross-env). O `config.js` troca para `DATABASE_URL_TEST`
  e falha se ele for igual ao `DATABASE_URL`. Os testes nunca tocam o banco de desenvolvimento.

## Convenções da API
- Camadas: `routes` (valida a entrada) → `services` (regra de negócio) → `db`.
- Escrita com mais de um passo usa `transacao(usuarioId, fn)` de `db.js`. Ela já faz
  `BEGIN`, `set_config('app.usuario_id', ...)`, `COMMIT`/`ROLLBACK`.
- Erros: lançar as classes de `src/errors.js`; o middleware `erros.js` formata a resposta.
- `app.set('trust proxy', 1)`: a API roda atrás de 1 proxy (NGINX) no deploy.
- Consultas BD2: a fonte única é `database/04_consultas_bd2.sql`. Cada consulta começa com
  `-- @consulta <nome>` e é exposta em `/api/kpis/<nome>` (`src/consultasBd2.js`). Não copiar
  o SQL para o JavaScript.
- Testes em `backend/tests/*.test.js`. Cada arquivo cria e remove os próprios dados
  (`tests/helpers.js`).

## Convenções do front (`frontend/`)
- HTML + CSS + JS puro com ES Modules, sem framework e sem build. O Express serve a pasta em
  desenvolvimento (`NODE_ENV` diferente de `production`); no deploy, o NGINX.
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
- Fluxos que gravam dados (assumir, fechar, cadastrar) são testados no navegador contra uma
  **segunda instância da API** com `NODE_ENV=test PORT=3001`, que usa o `cmms_test`. Um script de
  fixtures no scratchpad cria usuários, equipamento, peças e OS e os apaga no final. Nunca gravar
  dados de teste no `cmms` de desenvolvimento. Parar a instância 3001 antes de rodar `npm test`,
  porque os dois usam o mesmo banco.
- Rotas inexistentes fora de `/api` mostram `404.html` (caminhos absolutos nela).

## Comandos
```bash
# aplicar o banco (URLs lidas do backend/.env; sempre entre aspas por causa do &)
psql "$DATABASE_URL"      -f database/01_schema.sql -f database/02_triggers.sql -f database/03_procedures.sql -f database/05_usuarios_ativo.sql
psql "$DATABASE_URL_TEST" -f database/01_schema.sql -f database/02_triggers.sql -f database/03_procedures.sql -f database/05_usuarios_ativo.sql
cd database && npm install && npm run seed
psql "$DATABASE_URL" -f database/04_consultas_bd2.sql
cd backend && npm test && npm start
cd backend && npm run test:cobertura   # cobertura (c8, lcov em backend/coverage/)
```
