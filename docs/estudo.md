# Caderno de estudo — Mini-CMMS

Um resumo por etapa, com perguntas que um professor poderia fazer na apresentação.

---

## Etapa 1 — Banco de dados (issue #1)

**O que foi feito**

1. Criei as 8 tabelas da seção 5 em `01_schema.sql`, com chaves estrangeiras e `CHECK`s. Entre eles, `estoque >= 0` e status e perfis permitidos.
2. `02_triggers.sql` tem duas triggers. `trg_estoque_minimo` cria um alerta quando o estoque cruza o mínimo. `trg_auditoria_os` registra cada mudança de status da OS com o usuário, que recebe via `SET LOCAL app.usuario_id`.
3. `03_procedures.sql` cria `sp_kpis_equipamento(data_ini, data_fim)`. Ela usa CTEs para calcular, por equipamento, MTTR, MTBF, disponibilidade e custo (peças + horas × custo/hora).
4. `04_consultas_bd2.sql` tem 3 consultas. A primeira mostra o MTTR acima da média (subquery). A segunda, o top 5 de peças em 30 dias (JOIN + GROUP BY/HAVING). A terceira, o Pareto de causas (CTE + funções de janela).
5. `seed.js` gera numa única transação dados fictícios e reproduzíveis (semente fixa): 4 usuários, 10 equipamentos, 30 peças e cerca de 200 OS em 90 dias.

**Perguntas prováveis**

1. *Por que a trigger de estoque compara `OLD` e `NEW` em vez de só checar `NEW.estoque < NEW.estoque_min`?*
   Para gerar o alerta só no momento em que o estoque **cruza** o mínimo. Se olhasse só o `NEW`, toda baixa de uma peça que já está abaixo do mínimo criaria um alerta repetido.

2. *Como a trigger de auditoria sabe qual usuário mudou o status, se o banco só conhece o usuário da conexão do pool?*
   A API roda `SET LOCAL app.usuario_id = '<id>'` dentro da transação, e a trigger lê com `current_setting('app.usuario_id', true)`. O `SET LOCAL` vale só até o COMMIT/ROLLBACK, então o valor não vaza para outra requisição que reutilize a mesma conexão.

3. *O que acontece se o fechamento de uma OS tentar baixar mais peças do que há em estoque?*
   O `UPDATE ... WHERE estoque >= qtd` não afeta nenhuma linha e a API lança erro. Mesmo que alguém esqueça essa condição, o `CHECK (estoque >= 0)` do banco rejeita o valor negativo. Nos dois casos a transação sofre ROLLBACK e nada é gravado: nem `os_pecas`, nem movimentações, nem a mudança de status.

### Complemento — procedure `sp_entrada_estoque`

**O que foi feito**

1. Em `03_procedures.sql` criei uma PROCEDURE de verdade (`CREATE PROCEDURE`), chamada com `CALL sp_entrada_estoque(peca, qtd, usuario)`.
2. Ela soma a quantidade ao estoque e grava uma movimentação `ENTRADA` com o usuário, para manter a rastreabilidade.
3. Se o estoque voltar a ficar `>=` estoque mínimo, marca como `resolvido = true` os alertas pendentes da peça. A trigger cria o alerta e a procedure o fecha.
4. Ela valida a quantidade (> 0) e a existência da peça com `RAISE EXCEPTION`. Um usuário inválido é barrado pela FK. Qualquer erro desfaz a chamada inteira.
5. Ela não faz COMMIT própria: quando chamada dentro de `BEGIN … ROLLBACK`, a entrada é desfeita junto com o resto. Testei a entrada parcial (alerta continua pendente), a entrada que resolve o alerta, os 3 erros e o rollback.

**FUNCTION × PROCEDURE no PostgreSQL**

| | FUNCTION | PROCEDURE (PostgreSQL 11+) |
|---|---|---|
| Como chamar | dentro de SQL: `SELECT * FROM f(...)`, em `WHERE`, `JOIN` etc. | sozinha, com `CALL p(...)` |
| Retorno | obrigatório: valor, linha ou tabela (`RETURNS TABLE`) | não tem `RETURNS`; só devolve dados por parâmetros `INOUT`/`OUT` |
| Controle de transação | não pode `COMMIT`/`ROLLBACK`; roda dentro da transação de quem chamou | pode `COMMIT`/`ROLLBACK` internamente, mas só se chamada fora de um bloco `BEGIN` explícito |
| Uso típico | cálculo/consulta reaproveitável (`sp_kpis_equipamento`) | ação com efeitos colaterais (`sp_entrada_estoque`) |

Por isso os KPIs ficaram em FUNCTION (precisam devolver uma tabela consultável com `SELECT`, inclusive dentro de subqueries) e a entrada de estoque ficou em PROCEDURE (é uma ação). Tentar `CALL sp_kpis_equipamento(...)` dá erro: *procedure does not exist*.

**Perguntas prováveis**

1. *Por que `sp_kpis_equipamento` tem prefixo "sp_" mas é FUNCTION?*
   O nome veio do enunciado. No PostgreSQL, uma PROCEDURE não devolve um conjunto de linhas, e a consulta BD2 nº 1 precisa usar o resultado em `FROM` e numa subquery. Só uma FUNCTION com `RETURNS TABLE` permite isso.

2. *Por que a procedure não faz COMMIT no final?*
   Para ser componível. Se ela fizesse COMMIT, não daria para juntá-la a outros passos numa transação maior (ex.: uma nota com várias peças), e um erro na 3ª peça não desfaria as duas primeiras. Além disso, COMMIT dentro de procedure falha quando ela é chamada dentro de um `BEGIN` explícito, que é como a API trabalha.

3. *Quem garante que o alerta é resolvido no momento certo, e por que não usar outra trigger?*
   A própria procedure, depois do UPDATE, compara o estoque novo com o mínimo (`RETURNING estoque, estoque_min`). Uma trigger também funcionaria, mas deixar na procedure torna a regra explícita no fluxo de entrada e evita uma cadeia de triggers difícil de depurar. A trigger fica só com o papel de **detectar** o problema.

---

## Etapa 2 — Login JWT com perfis (issue #2)

**O que foi feito**

1. A API Express 5 está organizada em camadas: `routes` → `services` → `db`. O `app.js` monta o app sem dar `listen`, para os testes usarem o app direto com supertest.
2. `POST /api/auth/login` confere a senha com `bcrypt.compare`. Se estiver certa, emite um JWT HS256 válido por 8h, com `sub` (id), `nome` e `perfil`. O segredo vem só do `.env`, e a API se recusa a subir sem ele ou se ele tiver menos de 32 caracteres.
3. Os middlewares `autenticar` (401) e `exigirPerfil(...)` (403) protegem as rotas. Um middleware único transforma qualquer erro no formato `{ erro: { codigo, mensagem } }` (400/401/403/404/409/500).
4. Segurança: `helmet` nos cabeçalhos; rate limit geral (300 req/15 min) e outro mais rígido no login (10/15 min); limite de 100 kb no corpo; queries parametrizadas.
5. São 9 testes com `node:test` + supertest: login ok e errado, 400, 401 sem token / adulterado / expirado, 403 por perfil e 404. Cada teste cria e apaga os próprios usuários.

**Perguntas prováveis**

1. *Por que a resposta é igual para "e-mail não existe" e "senha errada"? E para que serve o `HASH_FALSO`?*
   Mensagens diferentes deixariam um atacante descobrir quais e-mails estão cadastrados (enumeração de usuários). O `HASH_FALSO` faz o `bcrypt.compare` rodar mesmo quando o e-mail não existe. Assim o tempo de resposta também é parecido, e não dá para descobrir os e-mails medindo o tempo.

2. *O JWT é criptografado? Um usuário pode trocar seu perfil de OPERADOR para SUPERVISOR no token?*
   Não é criptografado, só assinado: qualquer um pode decodificar o payload em base64 e ler o perfil, por isso não colocamos dados sensíveis nele. Mas, se alguém alterar o payload, a assinatura HMAC-SHA256 deixa de bater, e o `jwt.verify` rejeita com 401. Só quem tem o `JWT_SECRET` (o servidor) consegue gerar um token válido. Além disso, fixamos `algorithms: ['HS256']` para impedir o ataque de trocar o algoritmo do cabeçalho para `none`.

3. *Qual a diferença entre 401 e 403, e por que bcrypt em vez de SHA-256?*
   401 significa "não sei quem você é" (token ausente, inválido ou expirado). 403 significa "sei quem você é, mas seu perfil não pode fazer isso". O bcrypt é lento de propósito (custo 10, cerca de 2¹⁰ rodadas) e gera um *salt* aleatório por senha. Se o banco vazar, isso torna a força bruta e as *rainbow tables* inviáveis. O SHA-256 é rápido demais e, sem salt, senhas iguais teriam o mesmo hash.

---

## Ajustes de infraestrutura antes da #3 (Neon, testes e proxy)

**O que foi feito**

1. **Banco no Neon com SSL:** o driver `pg` passa a usar `ssl: { rejectUnauthorized: true }` sempre que o host não é local. A conexão é criptografada (TLS 1.3) **e** o certificado do servidor é verificado, o que evita um ataque *man-in-the-middle*. Os scripts SQL rodaram sem nenhuma mudança no Neon (PG 19), o que mostra que são portáveis.
2. **`npm test` isolado no `cmms_test`:** o script roda com `NODE_ENV=test` (via `cross-env`, para funcionar também no Windows). O `config.js` troca para `DATABASE_URL_TEST` e aborta se ele for igual ao banco de desenvolvimento. Os testes apagam o que criam, e o `cmms` nunca é tocado.
3. **`app.set('trust proxy', 1)`:** no deploy, toda requisição chega à API vinda do NGINX. Sem essa linha, o Express enxerga o IP do NGINX para todos os clientes, e o rate limit bloquearia todo mundo junto depois de 10 logins. Com ela, o Express usa o IP real do cabeçalho `X-Forwarded-For`, confiando em **1** salto de proxy.
4. **`jwt.verify` com `{ algorithms: ['HS256'] }`:** isso já estava no `middlewares/auth.js` desde a #2. Foi conferido, e há teste com token adulterado e expirado.
5. A API sobe localmente apontando para o `cmms` no Neon, e os testes passam no `cmms_test`.

**Perguntas prováveis**

1. *Por que não rodar os testes no mesmo banco de desenvolvimento?*
   Os testes inserem e apagam dados. Se um teste falhar no meio, pode deixar lixo ou apagar algo, e o banco da demo ficaria inconsistente. Além disso, os testes de "nada mudou no banco" contam linhas, e alguém mexendo na API ao mesmo tempo atrapalharia essas contagens. Com bancos separados, cada ambiente tem dados previsíveis.

2. *Por que `trust proxy` é `1` e não `true`?*
   Com `true`, o Express confia em **todo** o `X-Forwarded-For`, e o cliente pode enviar esse cabeçalho forjado com um IP qualquer. Bastaria trocar o IP a cada tentativa para burlar o rate limit. Com `1`, o Express só aceita o IP que o NGINX (o único proxy confiável) acrescentou.

3. *O que o `rejectUnauthorized: true` acrescenta, se a conexão já é criptografada?*
   A criptografia sozinha garante que ninguém leia o tráfego, mas não garante **com quem** a API está falando. Sem verificar o certificado, um atacante na rede poderia se passar pelo banco e capturar a senha. Verificar o certificado (assinado por uma autoridade confiável, com o nome do host batendo) garante que a API está falando com o Neon de verdade.

---

## Etapa 3 — Abrir OS (issue #3)

**O que foi feito**

1. `POST /api/os` (OPERADOR ou SUPERVISOR) valida equipamento, descrição, tipo e prioridade, e devolve 400 com **todos** os problemas de uma vez. Na mesma transação, insere a OS como `ABERTA` e coloca o equipamento em `PARADO`.
2. A transação usa o helper `transacao(usuarioId, fn)` de `db.js`, que já grava `app.usuario_id` com `set_config(..., true)`. Ele vai ser reaproveitado para assumir e fechar a OS.
3. O equipamento é lido com `SELECT ... FOR UPDATE`. Equipamento inexistente dá 404, e um ROLLBACK garante que nenhuma OS seja criada.
4. Também entraram `GET /api/os`, com filtros por status, prioridade e equipamento (o SQL é montado só com parâmetros `$n`), e `GET /api/os/:id`, com peças e histórico de auditoria. As telas de lista e detalhe vão precisar delas.
5. São 9 testes novos: 201 com o equipamento PARADO, supervisor também abre, 403 do técnico sem gravar nada, 401, 400, 404 sem criar OS, listas com filtro, detalhe e id inválido.

**Perguntas prováveis**

1. *Por que abrir a OS e parar o equipamento numa transação, se são só dois comandos?*
   Porque precisam acontecer juntos. Se o INSERT funcionasse e o UPDATE falhasse (queda de conexão, por exemplo), teríamos uma OS aberta com o equipamento ainda "OPERANDO". Os KPIs e o painel mostrariam um estado impossível. Com a transação, ou os dois acontecem ou nenhum.

2. *O filtro da listagem monta o SQL dinamicamente. Isso não abre brecha para SQL injection?*
   Não. O que muda no texto do SQL são só trechos fixos escritos no código (`os.status = $1`). Os **valores** vindos da URL vão sempre como parâmetros, e o PostgreSQL os trata como dados, nunca como código. Além disso, os filtros são validados antes: o status precisa estar na lista de status válidos e o `equipamentoId` precisa ser inteiro.

3. *Para que serve o `FOR UPDATE` no equipamento?*
   Ele trava a linha do equipamento até o fim da transação. Se dois operadores abrirem OS para o mesmo equipamento ao mesmo tempo, a segunda transação espera a primeira terminar. Assim as duas não leem e atualizam o equipamento simultaneamente. Esse controle de concorrência é ainda mais importante no fechamento da OS, com a baixa de estoque.
