# Roteiro: migração de produção para o SaaS multiempresa (#41)

Sábado, 28/11/2026. Banco: `cmms` no Neon (São Paulo). API: serviço `maintos` no Render
(Virginia). Todos os dados são fictícios, e alguns minutos fora do ar foram aceitos.

Ordem: **(a)** branch de backup no Neon → **(b)** aplicar o 06 (e o seed) no `cmms` →
**(c)** trocar o `DATABASE_URL` no Render → **(d)** merge do PR → **(e)** checklist e testes
de fumaça. Se algo der errado, ver [Como voltar atrás](#como-voltar-atrás).

Os nomes de botões do Neon e do Render foram conferidos na documentação em 26/11/2026
(Neon: *Branches* e *Restore*; Render: *Environment variables* e *Rollbacks*).

## Antes de começar

- [ ] O PR do #41 está com **CI verde, Quality Gate aprovado e testes de isolamento passando**.
- [ ] `psql` 16 ou mais novo (`psql --version`) e o Git Bash abertos na pasta do projeto.
- [ ] `backend/.env` tem `DATABASE_URL_ADMIN` (dono do `cmms`, cmms_owner) e `SEED_PASSWORD`.
- [ ] O arquivo `C:\Users\davim\maintos-segredos\DATABASE_URL_producao_maintos_app.txt` existe
      (URL do papel `maintos_app`; o papel já foi criado no Neon em 26/11, com senha).
- [ ] Carregue as duas URLs no terminal **sem exibi-las**. As URLs têm `&`; por isso, nada de
      `source .env`: o Node lê o arquivo.

```bash
ADMIN_URL="$(node -e "const t=require('fs').readFileSync('backend/.env','utf8');process.stdout.write([...t.matchAll(/^DATABASE_URL_ADMIN=(.*)$/gm)].at(-1)[1].trim())")"
APP_URL="$(tr -d '\r\n' < /c/Users/davim/maintos-segredos/DATABASE_URL_producao_maintos_app.txt)"
psql "$ADMIN_URL" -Atc "SELECT current_user, current_database()"   # cmms_owner|cmms
psql "$APP_URL"   -Atc "SELECT current_user, current_database()"   # maintos_app|cmms
```

## (a) Branch de backup no Neon

1. Anote o **horário exato** (com segundos) antes de mexer no banco: `date -u` no terminal.
   É o ponto de volta mais seguro (ver "Como voltar atrás").
2. Neon Console → projeto → **Branches** → **New branch**.
3. **Parent branch**: a branch de produção (a que tem o banco `cmms`).
4. Nome: `backup-antes-saas-2026-11-28`.
5. Dados: **Current data**.
6. **Desmarque** "Automatically delete branch after" (vem marcado com 1 dia).
7. **Create**.
8. Confira: a branch nova aparece em *Branches*, com os bancos `cmms` e `cmms_test`. Ela
   copia também os papéis e as senhas (inclusive o `maintos_app`).

## (b) Aplicar o 06 no `cmms` e popular as duas empresas

```bash
# 1. migração (reexecutável: se cair no meio, pode rodar de novo)
psql "$ADMIN_URL" -v ON_ERROR_STOP=1 -f database/06_multiempresa.sql
#    esperado: BEGIN ... COMMIT, sem ERROR

# 2. seed: recria TUDO com as duas empresas, o PLATAFORMA e 2 pedidos pendentes.
#    Apaga os dados atuais do cmms (todos fictícios) e gera OS com datas até hoje.
cd database && npm run seed && cd ..
#    esperado: tabela com "Empresa Demonstração" e "Metalúrgica Exemplo"

# 3. conferências
psql "$ADMIN_URL" -Atc "SELECT relname, relforcerowsecurity FROM pg_class WHERE relname IN ('usuarios','ordens_servico','pecas')"
#    esperado: as três com t
psql "$APP_URL" -Atc "SELECT count(*) FROM ordens_servico"
#    esperado: 0 (sem contexto de empresa, a RLS não mostra nada)
psql "$APP_URL" -v empresa_id=2 -q -f database/04_consultas_bd2.sql | head -20
#    esperado: as consultas BD2 só com dados da Metalúrgica Exemplo
```

> Entre (b) e (d), o site antigo continua no ar, conectado como dono: as leituras
> funcionam, mas gravar (abrir OS etc.) falha, porque o código antigo não informa a
> empresa. É a janela de "alguns minutos fora do ar".

## (c) Trocar o `DATABASE_URL` no Render

1. Render Dashboard → serviço **maintos** → **Environment**.
2. Edite `DATABASE_URL` e cole o conteúdo de `DATABASE_URL_producao_maintos_app.txt`.
3. Salve com **Save only**: grava sem fazer deploy. O valor novo entra no próximo deploy,
   que é o do merge, junto com o código novo.
   - Não use "Save and deploy": o código antigo subiria com o `maintos_app` e o login pararia
     até o merge.
4. Não apague o valor antigo de nenhum lugar: ele continua no `backend/.env` como
   `DATABASE_URL_ADMIN` e é o que se usa para voltar atrás.

## (d) Merge do PR

1. No GitHub, confira mais uma vez que todos os checks estão verdes e faça o **merge**.
2. O Render só faz o deploy depois que a CI da `main` passar (`autoDeployTrigger: checksPass`).
   Acompanhe em **Events** até aparecer o deploy como *live*.
3. Proteção embutida: se o `DATABASE_URL` ainda fosse o dono (`cmms_owner`, que ignora a RLS),
   a API se recusa a subir (`verificarPapelSemBypass`). O health check falha e a versão
   anterior continua no ar. Nesse caso, corrija o passo (c) e faça **Manual Deploy**.

## (e) Checklist e testes de fumaça

Use uma janela normal e uma anônima, para ter duas sessões ao mesmo tempo. Senha dos
usuários do seed: a do `SEED_PASSWORD`.

- [ ] `https://maintos.com.br/api/health` responde `{"status":"ok"}` (a primeira chamada pode
      levar ~1 min: cold start).
- [ ] Landing: o botão principal é **Solicitar acesso**; o e-mail de contato e o "Copiar
      e-mail" continuam na seção "Para sua empresa".
- [ ] **Empresa Demonstração**: entre com `supervisor@cmms.local`. O menu mostra "Empresa
      Demonstração", com 10 equipamentos. Anote o número de uma OS (ex.: abra a primeira da
      lista e veja o `id` na barra de endereço).
- [ ] **Metalúrgica Exemplo** (janela anônima): entre com `supervisor@metalurgica.local`. O
      menu mostra "Metalúrgica Exemplo", com 6 equipamentos (R-01, PH-01... as mesmas tags,
      outra empresa).
- [ ] **Isolamento**: na janela da Metalúrgica, abra
      `https://maintos.com.br/os-detalhe.html?id=<id anotado da Demonstração>`. Deve aparecer
      "não encontrada" (a API responde 404).
- [ ] **Abrir e fechar OS** na Demonstração (operador abre, `tecnico@cmms.local` assume e
      fecha com uma peça) e conferir que nada disso aparece na Metalúrgica.
- [ ] **Plataforma**: entre com `plataforma@maintos.local`. Aparece o painel com 2 pedidos
      pendentes e a lista de empresas, sem menu de OS. Abrir `os.html` volta para o painel.
- [ ] **Cadastro público**: em "Solicitar acesso", envie um pedido (e-mail seu ou fictício).
      Ele aparece como pendente no painel.
- [ ] **Aprovar**: aprove o pedido, copie a senha temporária (só aparece uma vez), entre com
      ela numa janela anônima. A tela pede a troca; depois, a empresa nova aparece vazia.
- [ ] Render → **Logs**: sem erros 500 nem "ignora a Row-Level Security".
- [ ] **Tempo de resposta** (comparar com a tabela "antes" do PR):

```bash
read -rs SENHA   # digite a SEED_PASSWORD (não aparece na tela) e Enter
TOKEN="$(curl -s -X POST https://maintos.com.br/api/auth/login -H 'Content-Type: application/json' \
  -d "{\"email\":\"supervisor@cmms.local\",\"senha\":\"$SENHA\"}" | node -pe "JSON.parse(require('fs').readFileSync(0)).token")"
for rota in /api/kpis /api/kpis/resumo /api/kpis/top-pecas /api/os /api/os/1 /api/equipamentos; do
  for i in 1 2 3 4 5; do curl -s -o /dev/null -w "%{time_total}\n" -H "Authorization: Bearer $TOKEN" "https://maintos.com.br$rota"; done \
    | sort -n | sed -n 3p | xargs printf "$rota  mediana %s s\n"
done
unset SENHA TOKEN
```

## Como voltar atrás

Use se o checklist falhar e não houver correção rápida. Os dados são fictícios; o
objetivo é deixar o site como estava na sexta.

1. **Código** — Render → serviço **maintos** → **Deploys** → no deploy anterior ao merge,
   **Rollback** → **Rollback to this deploy**. O rollback reaproveita o build e as
   variáveis daquele deploy e **desliga o auto-deploy** do serviço (religar depois em
   **Settings**).
2. **Variável** — Render → **Environment** → `DATABASE_URL` de volta para a URL do dono
   (valor de `DATABASE_URL_ADMIN` no `backend/.env`) → **Save only**. O rollback do passo 1
   já usa as variáveis antigas; isto evita que um próximo deploy suba com a URL errada.
3. **Banco** — Neon Console → selecione a branch de produção → **Postgres database** →
   **Backup & Restore** → **Restore from history**:
   - Opção preferida: aba **From history**, com o horário anotado no passo (a)1 → **Next** →
     **Restore**. A branch continua sendo a principal e mantém os snapshots.
   - Alternativa: aba **From another branch**, com `backup-antes-saas-2026-11-28` como origem
     → **Next** → **Restore**. Atenção: restaurar a branch principal a partir de outra a
     transforma em "filha" dessa outra, e ela perde os snapshots e os agendamentos de backup.
   - Nos dois casos, **a connection string não muda**, as conexões abertas caem por um instante,
     e o Neon guarda automaticamente uma cópia do estado anterior, chamada
     `{branch}_old_{horário}`, na página *Branches*.
   - A restauração volta **todos** os bancos da branch (`cmms` e `cmms_test`).
4. Confira em `https://maintos.com.br` que o login antigo (`supervisor@cmms.local`) e a lista
   de OS voltaram.
5. A branch do PR continua aberta: corrija, deixe a CI verde e repita o roteiro.

Depois que tudo estiver estável por alguns dias, a branch `backup-antes-saas-2026-11-28`
pode ser apagada (Branches → menu da branch → *Delete*).
