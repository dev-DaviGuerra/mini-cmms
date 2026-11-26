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

---

## Etapa 4 — Assumir OS (issue #4)

**O que foi feito**

1. `POST /api/os/:id/assumir` aceita só o perfil TECNICO (403 para os outros) e só OS com status `ABERTA`. Qualquer outro status devolve **409 `STATUS_INVALIDO`**, informando o status atual e o esperado.
2. Tudo roda em `transacao()`, que faz `set_config('app.usuario_id', id, true)` **antes** do UPDATE. Assim a trigger `trg_auditoria_os` grava `ABERTA → EM_ANDAMENTO` com o técnico correto, e o teste confere isso.
3. A OS é lida com `SELECT ... FOR UPDATE` (`travarOs`). Num teste, dois técnicos assumem a mesma OS **ao mesmo tempo**: um recebe 200, o outro 409, e a auditoria registra só uma mudança.
4. `GET /api/os` ganhou paginação `limit`/`offset` (padrão 50, máximo 200). A resposta passou a ser `{ dados, paginacao: { limit, offset, total } }`, e o `total` vem de um `COUNT(*)` com os mesmos filtros.
5. São 7 testes novos: assumir com auditoria, 409 por status, concorrência, 403 do operador e do supervisor, 404/400/401, páginas sem repetição e limites inválidos.

**Perguntas prováveis**

1. *Por que 409 e não 400 quando a OS já foi assumida?*
   O 400 diz que a **requisição** está mal formada. Aqui ela está correta, mas conflita com o **estado atual** do recurso: a OS não está mais `ABERTA`. É exatamente o caso do 409 Conflict. O cliente sabe que, se repetir a mesma chamada, vai receber o mesmo erro até o estado mudar.

2. *Sem o `FOR UPDATE`, o que aconteceria com dois técnicos clicando em "Assumir" juntos?*
   As duas transações leriam `status = ABERTA` ao mesmo tempo, as duas passariam na verificação e as duas fariam o UPDATE. O segundo sobrescreveria o `tecnico_id` do primeiro: uma *lost update*, com duas linhas de auditoria. Com o `FOR UPDATE`, a segunda transação espera a primeira dar COMMIT e então lê `EM_ANDAMENTO` e recebe 409. Outra solução seria o UPDATE condicional `... WHERE id = $1 AND status = 'ABERTA'`, verificando o `rowCount`. Preferi travar e ler porque isso permite responder 404 ou 409 com a mensagem certa.

3. *Por que limitar a listagem e o que é paginação por `limit`/`offset`?*
   Com o tempo a tabela de OS cresce. Devolver tudo de uma vez deixaria a resposta lenta e pesada, além de permitir que alguém sobrecarregue a API. Com `limit`, cada página tem no máximo N itens; o `offset` diz quantos pular. O `total` permite ao front calcular o número de páginas. A ordenação fixa (`aberta_em DESC, id DESC`) garante que as páginas não repitam nem pulem itens. O `id` desempata OS abertas no mesmo instante.

---

## Etapa 5 — Fechar OS com transação e rollback (issue #5)

**O que foi feito**

1. `POST /api/os/:id/fechar` aceita o técnico **que assumiu** a OS ou um SUPERVISOR, e só OS `EM_ANDAMENTO` ou `AGUARDANDO_PECA`. Em uma única transação: trava a OS e o equipamento; para cada peça faz o `UPDATE ... WHERE estoque >= qtd`, grava `os_pecas` com o custo do momento e a movimentação `SAIDA`; marca a OS como `FECHADA`; e, por fim, devolve o equipamento a `OPERANDO`.
2. O equipamento só volta a `OPERANDO` se **não existir outra OS pendente** para ele (`ABERTA`, `EM_ANDAMENTO` ou `AGUARDANDO_PECA`), verificado com um `NOT EXISTS` no próprio UPDATE. Uma OS esperando peça significa que o defeito ainda não foi consertado, então ela também mantém o equipamento `PARADO`.
3. Se faltar estoque, a transação inteira sofre **ROLLBACK** e a resposta é 409 `ESTOQUE_INSUFICIENTE`, com a peça, o solicitado e o disponível. Depois, uma **segunda transação, separada**, muda só o status da OS para `AGUARDANDO_PECA`, com auditoria. Peça inexistente devolve 404, também com rollback, mas sem mudar o status.
4. Depois que o supervisor repõe o estoque com `CALL sp_entrada_estoque`, o técnico fecha de novo a OS em `AGUARDANDO_PECA`. O teste do ciclo completo cobre isto: 409 → `AGUARDANDO_PECA` → `CALL` → 200 `FECHADA` → alerta resolvido.
5. São 10 testes novos. O teste de rollback compara uma "fotografia" de estoque, `os_pecas`, movimentações e alertas antes e depois da tentativa. Um **teste de mutação** (trocar `ROLLBACK` por `COMMIT` em `db.js`) fez esse teste falhar, o que prova que ele detecta um rollback ausente.

**Perguntas prováveis**

1. *Por que colocar a OS em `AGUARDANDO_PECA` numa transação separada, e não na mesma?*
   Porque a transação do fechamento **precisa** ser desfeita por inteiro. Ela pode já ter baixado a peça anterior, gravado `os_pecas` e criado um alerta pela trigger. Só o ROLLBACK garante que nada disso fica. Se a mudança para `AGUARDANDO_PECA` estivesse dentro dela, seria desfeita junto. Então primeiro desfazemos tudo e depois registramos, numa transação nova e pequena, só o fato de que a OS está esperando peça. O UPDATE dela tem `WHERE status = 'EM_ANDAMENTO'`, então não mexe numa OS que, nesse meio tempo, mudou de estado.

2. *O que garante que dois técnicos usando a mesma peça ao mesmo tempo não deixam o estoque negativo?*
   Três camadas. (1) O `UPDATE pecas SET estoque = estoque - qtd WHERE id = $1 AND estoque >= qtd` é atômico: o PostgreSQL trava a linha da peça, e a segunda transação espera e reavalia o `WHERE` com o saldo novo, falhando se ele não for suficiente. (2) O `CHECK (estoque >= 0)` da tabela é a última barreira. (3) As peças são baixadas sempre **em ordem de id**. Assim duas transações nunca travam as mesmas peças em ordem inversa, o que causaria um *deadlock*.

3. *Por que travar o equipamento (`FOR UPDATE`) se o fechamento só atualiza o status dele no fim?*
   Por causa da regra "só volta a OPERANDO se não houver outra OS pendente". Se duas OS do mesmo equipamento fossem fechadas ao mesmo tempo sem a trava, cada transação enxergaria a outra ainda `EM_ANDAMENTO` (sem COMMIT) e nenhuma liberaria o equipamento. Ele ficaria `PARADO` para sempre. Com a trava, a segunda espera a primeira dar COMMIT. No nível READ COMMITTED, cada comando vê os dados já confirmados, então o `NOT EXISTS` da segunda enxerga a primeira como `FECHADA` e libera o equipamento.

---

## Etapa 6 — Equipamentos, peças, entrada de estoque e alertas (issue #6)

**O que foi feito**

1. `GET /api/equipamentos` e `GET /api/pecas` servem qualquer perfil logado: o operador escolhe o equipamento ao abrir a OS, e o técnico escolhe as peças ao fechar. A lista de equipamentos traz `os_pendentes`, e a de peças traz `abaixo_minimo`, calculado no SQL.
2. `POST /api/equipamentos` e `POST /api/pecas` são só do SUPERVISOR. Tag e código são gravados em maiúsculas. Duplicatas devolvem 409, detectadas pelo erro `23505` (*unique_violation*) do próprio banco.
3. A peça nasce com **estoque 0**. O saldo só entra por `POST /api/pecas/:id/entrada`. Assim toda unidade em estoque tem uma movimentação `ENTRADA` rastreável.
4. Essa rota chama a **PROCEDURE** com `CALL sp_entrada_estoque($1, $2, $3)` dentro de `transacao()`. Antes, trava a peça (`FOR UPDATE`) para devolver um 404 claro. A resposta informa quantos alertas foram resolvidos.
5. `GET /api/alertas` (SUPERVISOR) lista os alertas pendentes criados pela trigger. São 10 testes novos, incluindo o ciclo completo: trigger cria o alerta → ele aparece na lista → a entrada o resolve → ele sai da lista.

**Perguntas prováveis**

1. *Por que confiar na restrição UNIQUE do banco em vez de fazer um SELECT antes para ver se a tag já existe?*
   O "SELECT e depois INSERT" tem uma janela de corrida: dois supervisores cadastrando a mesma tag ao mesmo tempo passariam os dois no SELECT. A restrição `UNIQUE` é garantida pelo índice do banco de forma atômica. A API só traduz o erro `23505` para um 409 com mensagem clara. A regra fica num lugar só, no banco, e vale para qualquer cliente, inclusive o `psql`.

2. *Por que a peça é cadastrada com estoque 0 e não com uma quantidade inicial?*
   Para manter a rastreabilidade: o estoque de uma peça deve ser sempre igual a Σ ENTRADAS − Σ SAÍDAS em `movimentacoes`. Se o cadastro aceitasse um estoque inicial direto, essa quantidade apareceria "do nada", sem movimentação nem usuário responsável. Usando a procedure de entrada, a regra é a mesma para a primeira compra e para as reposições.

3. *A rota de entrada chama uma PROCEDURE: como a API sabe o que aconteceu, se ela não devolve linhas?*
   A procedure faz o trabalho (UPDATE, INSERT, resolver alertas), e a API consulta o resultado **na mesma transação**: conta os alertas pendentes antes e depois do `CALL`, e lê a peça atualizada no fim. É a divisão típica: a procedure executa a ação, e as consultas (ou funções) leem o estado. Como a procedure não faz COMMIT própria, tudo é confirmado de uma vez pelo `transacao()`.

---

## Etapa 7 — KPIs e consultas BD2 na API (issue #7)

**O que foi feito**

1. `GET /api/kpis?inicio=&fim=` chama a função `sp_kpis_equipamento`. Sem datas, usa os últimos 90 dias até hoje, calculados **no banco** (`CURRENT_DATE`). As datas são validadas (formato e calendário; `inicio <= fim`), e os `NUMERIC` viram números no JSON.
2. `GET /api/kpis/resumo` devolve numa consulta só os totais dos cards do dashboard: OS abertas, em andamento e aguardando peça, equipamentos parados e alertas pendentes.
3. As 3 consultas BD2 viraram rotas (`mttr-acima-media`, `top-pecas`, `pareto-causas`) **sem copiar o SQL**. A API lê o `database/04_consultas_bd2.sql` ao subir, separa as consultas pelos marcadores `-- @consulta <nome>` e ignora os comandos `\echo` do psql. Conferi que o psql e a API devolvem os mesmos números.
4. Todas as rotas aceitam qualquer usuário logado (401 sem token).
5. São 9 testes novos, com um cenário pequeno montado à mão (MTTR 3h e 1h, custo, OS pendentes, saídas dentro e fora dos 30 dias), cujos resultados foram calculados no papel. O teste de datas pegou um bug real: um mês inválido gerava erro 500 em vez de 400.

**Perguntas prováveis**

1. *Por que a API lê o arquivo `.sql` em vez de ter as consultas no código JavaScript?*
   Para ter **uma única fonte da verdade**. Se o SQL estivesse copiado no JavaScript, uma correção feita no arquivo da disciplina de BD2 poderia não chegar à API, e o professor veria no dashboard um resultado diferente do que roda no psql. Lendo o arquivo, os dois sempre executam o mesmo texto. O parser recusa trechos que não sejam `SELECT`/`WITH`, então ninguém consegue, por engano, transformar uma rota de leitura num `DELETE`.

2. *Como você sabe que os números de MTTR, MTBF e disponibilidade estão certos?*
   O teste monta um cenário que dá para calcular à mão. O equipamento E1 tem duas falhas, com reparos de 2h e 4h: MTTR = 6 ÷ 2 = 3h. O período de 90 dias, inclusivo, tem 91 dias = 2184h; o tempo operando é 2184 − 6 = 2178h, então MTBF = 2178 ÷ 2 = 1089h e disponibilidade = 1089 ÷ (1089 + 3) = 99,73%. O custo é 6h × R$ 80 + 2 peças × R$ 10 = R$ 500. A API precisa devolver exatamente esses valores.

3. *Por que as datas padrão são calculadas no banco e não no Node?*
   Porque "hoje" depende do fuso horário. O servidor Node e o banco podem estar em fusos diferentes (a VM da Azure normalmente usa UTC, e o Brasil está em UTC−3). Perto da meia-noite, os dois discordariam do dia. Usando `CURRENT_DATE` do PostgreSQL, a data padrão é coerente com os `TIMESTAMPTZ` que a função compara. Pelo mesmo motivo, as datas voltam como texto `AAAA-MM-DD`, e não como objeto `Date` do JavaScript, que aplicaria o fuso local.

---

## Etapa 8 — Front: login e lista de OS (issue #8)

**O que foi feito**

1. O front é HTML + CSS + JavaScript puro com ES Modules, sem framework e sem build. Em desenvolvimento, o Express serve a pasta `frontend/` (`express.static`); no deploy será o NGINX.
2. `js/api.js` centraliza o `fetch`: envia o JWT guardado no `sessionStorage`, converte `{ erro: { codigo, mensagem } }` em `ErroApi` e, num 401 com sessão aberta, limpa a sessão e volta ao login com "sessão expirou".
3. O login guarda o token e vai para `os.html`. A lista tem filtros por status, prioridade e equipamento, badges coloridos e paginação de 20 em 20. O botão "+ Nova OS" aparece só para OPERADOR e SUPERVISOR; o formulário confere os campos na tela e mostra os erros da API.
4. Segurança: toda informação vinda da API entra por `textContent`, nunca por `innerHTML`. A CSP do helmet foi escrita à mão, sem `'unsafe-inline'`: nenhum `<script>` inline, `style=""` ou `onclick` no HTML. Há testes de backend que falham se algum desses aparecer.
5. Testei num navegador real (Edge headless com puppeteer), em 18 verificações: login errado e certo, paginação, filtros, abertura de OS, botão por perfil, 401, saída, **XSS** (dados maliciosos aparecem como texto e não executam) e **nenhuma violação de CSP** no console.

**Perguntas prováveis**

1. *O que é XSS e como o front se protege?*
   *Cross-Site Scripting* acontece quando um texto controlado pelo atacante é interpretado como HTML/JavaScript na página de outro usuário. Por exemplo, um operador que escreve `<img src=x onerror="enviar(sessionStorage.token)">` na descrição da OS; quando o supervisor abre a lista, o código rodaria no navegador dele. O front usa só `textContent` para dados da API, então o navegador mostra o texto literalmente e não o interpreta. A CSP é a **segunda camada**: mesmo que algum HTML escapasse, scripts inline e atributos `onerror` seriam bloqueados pelo navegador. No teste, injetei exatamente esse tipo de texto e conferi que ele aparece como texto e não executa.

2. *Por que `sessionStorage` e não `localStorage` ou cookie?*
   O `sessionStorage` é apagado ao fechar a aba ou o navegador, então um token esquecido num computador compartilhado da fábrica não fica valendo por 8 horas. O `localStorage` persiste indefinidamente. Um cookie `HttpOnly` seria ainda mais protegido contra XSS, porque o JavaScript não consegue lê-lo, mas exigiria proteção contra CSRF e mudanças na API. Com XSS bloqueado por `textContent` e CSP, o `sessionStorage` é um equilíbrio razoável para o escopo do projeto.

3. *Se o botão "Nova OS" está escondido para o técnico, ele não consegue abrir uma OS?*
   Pela tela não, mas esconder o botão é só **usabilidade**, não segurança. Um técnico pode chamar a API direto, com curl ou pelo console do navegador. Quem impede é a API: o `exigirPerfil('OPERADOR', 'SUPERVISOR')` responde 403, e isso está testado. A regra é que o front nunca é a barreira de segurança, porque o usuário controla tudo o que roda no navegador.

---

## Redesign visual do front (issue #24)

**O que foi feito**

1. Novo visual "sala de controle industrial":
   - menu lateral fixo em grafite, com logo SVG próprio (engrenagem), navegação (as telas futuras aparecem desabilitadas) e usuário, perfil e Sair no rodapé;
   - base neutra fria e **uma única cor de destaque**, o amarelo de segurança `#F2A900`, usada nas ações principais e no foco.
2. Status em **semáforo** (ponto colorido + texto) e prioridade como barra colorida na lateral da linha. A cor nunca é a única informação. As fontes IBM Plex Sans e Mono são **servidas localmente** em woff2 (licença OFL), sem CDN.
3. Na lista: faixa de indicadores com `/api/kpis/resumo` (clicar num card filtra a lista), tabela mais densa com hover e "Nova OS" num **drawer** modal (foco preso dentro dele, Esc fecha e o foco volta ao botão). O login virou uma tela dividida, com faixas de segurança diagonais em CSS.
4. Estados de **carregando** (skeleton + `aria-busy`), **lista vazia** (com "Limpar filtros") e **foco visível** pelo teclado. Todas as cores, espaçamentos e fontes viraram **design tokens** (variáveis CSS) para as próximas telas.
5. Correções:
   - rotas inexistentes fora de `/api` mostram uma `404.html` no visual novo, e `/api` continua respondendo JSON;
   - o rate limit de login passou a vir do `.env` (`LOGIN_RATE_LIMIT_MAX`, padrão 10);
   - `package.json`, `scripts/` e `node_modules/` do front não são mais servidos.

   O teste em navegador real fez 30 verificações; a CSP continua sem `'unsafe-inline'`.

**Perguntas prováveis**

1. *Por que usar uma única cor de destaque e mostrar o status com ponto + texto?*
   Numa sala de controle, a cor chama atenção para o que exige ação. Se tudo for colorido, nada se destaca. O amarelo fica reservado para a ação principal e o foco, e as cores de status seguem o semáforo. O texto ao lado do ponto atende ao critério de acessibilidade WCAG 1.4.1 ("não usar só a cor"). Cerca de 8% dos homens têm alguma deficiência na percepção de cores, e para eles "vermelho" e "verde" podem parecer iguais.

2. *Por que servir as fontes localmente em vez de usar o Google Fonts?*
   Por três motivos. **Segurança:** a CSP fica só com `'self'`, sem liberar domínios externos (`font-src`, `style-src`). **Privacidade:** o navegador do usuário não avisa um terceiro a cada acesso. **Disponibilidade:** a demo não depende da internet externa nem de um CDN no dia da apresentação. Usamos só o subconjunto `latin` (que cobre o português) em woff2, o formato mais compacto, somando cerca de 136 KB.

3. *O que são design tokens e qual a vantagem?*
   São as decisões visuais com nome: `--destaque`, `--esp-3`, `--fonte-mono`, `--status-aberta`. Os componentes usam o nome, nunca o valor solto. Para mudar o amarelo do sistema inteiro, basta alterar uma linha, e as telas novas (detalhe da OS, dashboard) já nascem consistentes com as antigas. Eles também documentam o visual: quem lê o `:root` do CSS entende a paleta e a escala de espaçamento do projeto.

---

## Etapa 9 — Front: detalhe e fechamento da OS (issue #9)

**O que foi feito**

1. A página `os-detalhe.html?id=N` mostra os dados da OS, a seção de fechamento (causa, solução e horas), as peças usadas com custo unitário do momento e total, e o **histórico**. O histórico é uma linha do tempo que começa na abertura e segue com as mudanças gravadas pela trigger `trg_auditoria_os`, com usuário e data.
2. **Assumir** aparece para o TECNICO em OS aberta. **Fechar** aparece para o técnico que assumiu ou para o SUPERVISOR. Quando não há botão, a tela explica o motivo, como "Assumida por Tina. Só ela ou um supervisor pode fechar".
3. O fechamento acontece num drawer com causa (com sugestões das causas mais comuns), solução, horas e uma **lista de peças**. Cada linha tem a seleção da peça, mostrando o estoque atual, e a quantidade. Linhas vazias, quantidades inválidas e peças repetidas são barradas na própria tela.
4. O **409 de estoque insuficiente** aparece de forma clara: qual peça, quanto foi pedido e quanto há; que nada foi gravado (ROLLBACK); e que a OS foi para "Aguardando peça". A linha da peça que faltou fica destacada, com o foco na quantidade, e a tela de trás já mostra o novo status. Depois da reposição, o técnico fecha de novo.
5. A lógica do drawer virou `criarDrawer()` em `ui.js`, reaproveitada pela lista e pelas próximas telas. Ajustes de visual: o card "Máquinas paradas" ganhou cor crítica própria, ponto pulsando quando há máquina parada (respeitando `prefers-reduced-motion`) e fundo de alerta, e saiu o rótulo "OPERAÇÃO" de cima dos títulos. Teste de ponta a ponta: **29/29** num navegador real, contra uma instância da API ligada ao `cmms_test`.

**Perguntas prováveis**

1. *Se a transação de fechamento é desfeita, como a tela sabe o que mostrar?*
   A API responde 409 com `codigo: ESTOQUE_INSUFICIENTE` e `detalhes: { pecaId, codigo, solicitado, disponivel }`. O front usa esses dados para montar a mensagem e para achar, pelo `pecaId`, a linha do formulário que deve ser destacada. Em seguida recarrega a OS: como a API mudou o status para `AGUARDANDO_PECA` numa segunda transação, a tela de trás já mostra o status novo e a entrada correspondente no histórico. No teste, conferimos pela API que o estoque da **outra** peça, que tinha saldo e foi baixada primeiro, voltou ao valor original. É a prova visível do ROLLBACK.

2. *Por que o histórico começa com "Aberta" se a trigger de auditoria só registra UPDATE?*
   A abertura é um INSERT, e a trigger `trg_auditoria_os` é `AFTER UPDATE OF status`. Então a primeira linha do histórico é montada com os dados da própria OS (`aberta_em` e `aberta_por`), e as seguintes vêm de `os_auditoria`. As OS geradas pelo seed foram inseridas já fechadas, sem passar por UPDATE. Para elas, a tela avisa que as mudanças anteriores à auditoria não foram registradas, em vez de inventar um histórico.

3. *Como você testou assumir e fechar sem estragar os dados da demo?*
   Com uma segunda instância da API, iniciada com `NODE_ENV=test` na porta 3001, que usa o banco `cmms_test`. Um script cria usuários, um equipamento, duas peças (uma com estoque baixo) e quatro OS em estados diferentes. O navegador automatizado executa o fluxo **de verdade**: assume, fecha, provoca o 409, o supervisor repõe o estoque e o técnico fecha de novo. No final o script apaga tudo e confere que o `cmms_test` ficou vazio. O banco de desenvolvimento, usado na apresentação, nunca é tocado.

---

## Gestão de usuários (issue #28)

**O que foi feito**

1. **Banco:** o script `05_usuarios_ativo.sql` cria a coluna `ativo BOOLEAN NOT NULL DEFAULT true` em `usuarios` e pode ser rodado de novo sem erro (`IF NOT EXISTS`). Foi aplicado no `cmms` e no `cmms_test`. Usuário **nunca é apagado, só desativado**: `ordens_servico`, `movimentacoes` e `os_auditoria` têm chave estrangeira para ele, e apagar quebraria (ou, com CASCADE, apagaria) o histórico.
2. **API do SUPERVISOR:**
   - `GET /api/usuarios` lista os usuários;
   - `POST /api/usuarios` cadastra, com o e-mail normalizado em minúsculas; e-mail duplicado dá 409, pela UNIQUE do banco;
   - `PATCH /api/usuarios/:id/ativo` ativa ou desativa; o supervisor não pode se desativar (409).

   Para qualquer usuário logado, `POST /api/auth/senha` troca a própria senha, conferindo a atual.
3. **Política de senha:** mínimo de 10 caracteres, com letra e número, e até 72 bytes. A senha é sempre guardada com bcrypt (custo 10). As consultas listam as colunas explicitamente, então **nenhuma resposta devolve o hash**, e um teste procura `senha_hash` e `$2b$` em todas as respostas.
4. **Usuário desativado:**
   - no login, recebe a mesma mensagem de senha errada;
   - o middleware `autenticar` passou a consultar o banco a cada requisição, então um token já emitido é recusado com **401 na hora**, sem esperar as 8 horas;
   - o perfil usado na autorização também passou a vir do banco.
5. **Front:**
   - `usuarios.html` (o item do menu aparece só para o SUPERVISOR) com lista, cadastro em drawer e ativar/desativar;
   - "Trocar senha" no rodapé do menu, para todos os perfis;
   - os dois ajustes pendentes: o seletor de peça mostra código e estoque primeiro, e o pulso do card "Máquinas paradas" foi comprovado desligado com `prefers-reduced-motion`.

   São 12 testes de backend novos (78 no total) e 28 verificações no navegador real.

**Por que não existe cadastro aberto (autocadastro)?**
O Mini-CMMS é um sistema **interno** de uma fábrica, não um serviço público. Quem pode abrir OS, mexer no estoque ou ver custos é decidido pela empresa, não pela própria pessoa. Com um cadastro aberto, qualquer um que achasse o endereço na internet (o site fica numa VM pública na Azure) poderia criar uma conta e entrar. E, se pudesse escolher o perfil, viraria supervisor. Por isso o cadastro é exclusivo do SUPERVISOR, que define o perfil de cada pessoa (*privilégio mínimo*), e a API recusa com 403 qualquer outro perfil. A senha inicial é combinada pessoalmente, e o próprio usuário pode trocá-la depois em "Trocar senha". Isso também reduz a superfície de ataque: não existe rota pública de criação de conta para ser abusada, por exemplo com criação em massa de contas.

**Perguntas prováveis**

1. *Se o JWT é válido por 8 horas, como desativar alguém tira o acesso na hora?*
   O JWT sozinho não pode ser "cancelado": ele continua com assinatura válida até expirar. Por isso o middleware `autenticar`, além de verificar a assinatura, faz `SELECT ativo FROM usuarios WHERE id = $1` a cada requisição. Se o usuário foi desativado, a resposta é 401, e o front leva a pessoa para o login com "sessão expirou". O custo é uma consulta simples por chave primária, irrelevante neste volume. Outra opção seria uma lista de tokens revogados, mas a coluna `ativo` resolve com menos peças. No teste, uma aba aberta da usuária desativada cai no login no clique seguinte.

2. *Por que a senha atual errada dá 400 e não 401?*
   Porque 401 significa "você não está autenticado", e o usuário **está**, porque o token é válido. Errar a senha atual é um dado inválido na requisição. Além disso, o `api.js` do front trata qualquer 401 como sessão perdida e manda para o login, então um 401 aqui derrubaria a sessão de quem só digitou errado. A rota tem rate limit próprio (o mesmo limite do login) para impedir adivinhar a senha atual por tentativa e erro a partir de uma sessão aberta.

3. *Por que exigir a senha atual para trocar, se o usuário já está logado?*
   Para proteger contra quem encontra um computador com a sessão aberta (no chão de fábrica, isso é comum) ou rouba um token. Sem conferir a senha atual, essa pessoa trocaria a senha e "sequestraria" a conta, trancando o dono do lado de fora. Exigir a senha atual garante que só quem a conhece pode trocá-la. Também recusamos uma nova senha igual à atual, e a política mínima (10 caracteres, com letra e número) vale tanto no cadastro quanto na troca.

---

## Telas de Equipamentos e Estoque (issue #26)

**O que foi feito**

1. **Equipamentos** (`equipamentos.html`):
   - resumo com total, operando e parados; o card de parados usa a cor crítica;
   - lista com tag, nome, linha, criticidade e status em semáforo (ponto + texto);
   - coluna de OS pendentes, com um link que abre a lista de OS já filtrada por aquele equipamento. A lista de OS passou a aceitar filtros pela URL.
2. **Cadastro de equipamento** em drawer, só para SUPERVISOR:
   - a linha de produção sugere as linhas existentes (`<datalist>`);
   - a tag repetida dá 409, vindo da UNIQUE do banco;
   - o equipamento novo nasce "Operando".
3. **Estoque** (`estoque.html`):
   - resumo com o total de peças, as abaixo do mínimo e o valor em estoque (quantidade × custo);
   - lista com as peças **abaixo do mínimo destacadas e no topo**;
   - busca e filtro "só abaixo do mínimo".
4. **Para o SUPERVISOR:** painel de **alertas pendentes** (criados pela trigger `trg_estoque_minimo`) e **"Entrada de estoque" em drawer**. O drawer pode ser aberto pelo botão geral, pela linha da peça ou pelo próprio alerta, já com a peça escolhida. Ele mostra a situação ("faltam 2 para o mínimo") e chama `POST /api/pecas/:id/entrada`, que executa `CALL sp_entrada_estoque`. O aviso diz quantos alertas foram resolvidos. A tela de outros perfis nem chama `/api/alertas`, então não aparece nenhum 403 no console.
5. O menu agora tem só o Dashboard como "em breve", e ele fica só com indicadores e gráficos. Teste de ponta a ponta: **29/29** no navegador, contra o `cmms_test`, cobrindo a entrada parcial (o alerta continua) e a entrada completa (o alerta é resolvido). O teste pegou um bug de usabilidade: o aviso flutuante cobria o botão "Entrada" da tabela. Agora o aviso não bloqueia cliques (`pointer-events: none`).

**Perguntas prováveis**

1. *Onde está a lógica de "estoque abaixo do mínimo": no banco ou no front?*
   No banco. A API devolve `abaixo_minimo` calculado no SQL (`estoque < estoque_min`), e o alerta é criado pela trigger `trg_estoque_minimo` quando o estoque **cruza** o mínimo. O front só **mostra**: destaca a linha, ordena as críticas primeiro e conta quantas são. Assim a regra fica num lugar só e vale também para quem usa a API direto ou o psql. Uma peça com mínimo 0 e estoque 0 não está "abaixo", porque 0 < 0 é falso, e o teste confere isso.

2. *Qual a diferença entre o destaque "abaixo do mínimo" e o "alerta pendente"?*
   O destaque é o **estado atual**: a peça está abaixo do mínimo agora. O alerta é um **registro de evento**: em tal data o estoque cruzou o mínimo, e alguém precisa agir. O alerta fica pendente até uma entrada fazer o estoque voltar ao mínimo. Aí a procedure `sp_entrada_estoque` marca `resolvido = true`. No teste, uma entrada de 1 unidade (2 → 3, com mínimo 4) **mantém** o alerta; a seguinte (3 → 8) o **resolve**.

3. *Por que filtrar e buscar no navegador, e não pela API?*
   Porque são listas pequenas e de tamanho limitado: os equipamentos e as peças de uma fábrica, dezenas de itens. Carregar tudo uma vez e filtrar no navegador deixa a busca instantânea a cada tecla, sem uma requisição por letra digitada. A lista de **OS**, que cresce sem limite com o tempo, continua paginada na API (`limit`/`offset`). A escolha depende do volume.

---

## Etapa 10 — Dashboard (issue #10)

**O que foi feito**

1. `dashboard.html` tem só indicadores e gráficos:
   - "Agora" (`/api/kpis/resumo`): cards que levam às telas filtradas;
   - "No período" (30, 90 ou 180 dias, via `sp_kpis_equipamento`): falhas, MTTR médio ponderado (tempo total de reparo ÷ total de falhas), disponibilidade média e custo de manutenção.
2. **Gráficos**, com o Chart.js servido localmente em `vendor/` (build UMD, sem `eval`, compatível com a CSP sem `unsafe-inline`):
   - MTTR por equipamento em barras **horizontais, ordenadas do maior para o menor**, com a linha da média ponderada. Na horizontal, as tags ficam legíveis sem girar o texto em 1366 px, e a ordem já mostra o ranking;
   - disponibilidade em **pontos**, também horizontal e ordenada do menos para o mais disponível;
   - na tabela "MTTR acima da média", a tela explica que a consulta BD2 compara com a **média simples** dos MTTR (`AVG` na subquery). O card "MTTR médio" é **ponderado pelas falhas** (tempo total de reparo ÷ total de falhas), e por isso os dois valores diferem um pouco;
   - Pareto: barras com a % de cada causa e linha com a % acumulada, no **mesmo eixo** de 0 a 100%, com a linha de corte de 80%;
   - top 5 peças em barras horizontais;
   - tabela "MTTR acima da média".
3. **As cores vêm dos design tokens** do CSS: o JS lê `--grafico-serie-1` e os outros com `getComputedStyle`. A paleta (azul e laranja) foi **validada por script** quanto à separação para daltonismo (ΔE 24,7) e ao contraste (3:1 ou mais). Referências como média e 80% usam tinta neutra tracejada, porque não são uma série.
4. Cada bloco traz um **rótulo discreto da técnica SQL** ("função sp_kpis_equipamento", "CTE + função de janela", "JOIN + GROUP BY / HAVING", "subquery", "COUNT(*) FILTER"). Os blocos com janela fixa no SQL dizem isso no subtítulo, porque o filtro de período vale só para o que vem da função.
5. **Acessibilidade:** cada gráfico tem `role="img"` com um resumo em texto e uma **tabela com os mesmos dados** ("Ver dados em tabela"). Os tooltips mostram os detalhes, a animação respeita `prefers-reduced-motion`, e cada bloco carrega e falha de forma independente. **Ajustes no Estoque:** o card "Abaixo do mínimo" (e o de máquinas paradas) e o quadro de alertas ficam neutros com zero e vermelhos só quando há itens.

**Perguntas prováveis**

1. *Por que o Pareto não usa dois eixos (quantidade à esquerda e % à direita), como nos livros?*
   Gráficos com dois eixos verticais de escalas diferentes enganam: dá para fazer duas séries parecerem correlacionadas, ou uma parecer maior que a outra, só escolhendo as escalas. Por isso as barras mostram a **% de cada causa**, e não a contagem, e a linha mostra a **% acumulada**, as duas na mesma escala de 0 a 100%. A leitura do Pareto (as "poucas vitais" até a linha de 80%) continua igual, e a quantidade de OS aparece no tooltip e na tabela.

2. *Por que a disponibilidade está em pontos e não em barras?*
   O comprimento de uma barra representa o valor, então ela **precisa começar no zero**. Como todos os equipamentos estão entre 92% e 96%, barras de 0 a 100% ficariam praticamente iguais, e cortar o eixo em 90% exageraria as diferenças. Com pontos, o que importa é a **posição**, então o eixo pode começar perto dos valores (o subtítulo diz onde ele começa) sem distorcer a leitura.

3. *O filtro de período muda todos os gráficos?*
   Não, e a tela deixa isso explícito. O período é passado para a função `sp_kpis_equipamento(inicio, fim)`, que alimenta os totais e os gráficos de MTTR e disponibilidade. As consultas BD2 (Pareto, top 5 peças, MTTR acima da média) são o **mesmo SQL** do arquivo `04_consultas_bd2.sql`, com janelas fixas (todas as OS, 30 dias, 90 dias), e cada bloco informa a sua janela no subtítulo. Parametrizar essas consultas é possível, mas mudaria o SQL entregue para a disciplina de BD2. *(Atualização da #34: as três consultas passaram a receber o período em `$1`/`$2`, e hoje o filtro vale para todos os blocos, menos o "Agora".)*

---

## Etapa 12 — CI, SonarCloud com cobertura e segurança (issue #12)

**O que foi feito**

1. **CI no GitHub Actions** (`.github/workflows/ci.yml`): a cada push e PR, sobe um PostgreSQL 18 em *service container*, aplica os scripts 01, 02, 03 e 05, roda `npm audit`, os 81 testes e as consultas BD2. O Neon nunca é usado na CI.
2. **Cobertura com c8** (`npm run test:cobertura`): 98,5% das linhas e 90,7% dos ramos de `backend/src`. O `lcov.info` vai para o SonarCloud, que passou da *Automatic Analysis* para a análise pela CI (a automática não recebe cobertura, por isso mostrava 0,0%). No Sonar a cobertura ficou em **96,8%** e o Quality Gate passou.
3. **Issues abertas no Sonar corrigidas:** log injection no erro 500 (S5145), `main()` sem `await` no seed (S9383); o `| 0` do mulberry32 (S7767) e o `CHAR` do schema (regra do Oracle) foram justificados como não aplicáveis.
4. **Dependências e segredos:** actions fixadas por SHA e `npm ci --ignore-scripts` (apontados pelo próprio Sonar no workflow), `npm audit` zerado nos três pacotes (com `overrides` para `glob`/`minimatch`), Dependabot semanal para npm e Actions, e varredura do histórico do git sem nenhum segredo.
5. A CI achou um problema real: os testes dependiam do `LOGIN_RATE_LIMIT_MAX=100` do `.env` local. Tudo está consolidado em `docs/qss-relatorio.md`.

**Perguntas prováveis**

1. *Por que a CI usa um PostgreSQL próprio e não o Neon?*
   Porque a CI precisa ser **reprodutível e isolada**: cada execução começa com um banco vazio, aplica os scripts do repositório e é destruída no fim. Assim os testes provam que os scripts SQL funcionam do zero, em PostgreSQL padrão (a mesma portabilidade exigida para a VM da Azure), e nenhuma credencial do Neon precisa ir para o GitHub. Execuções paralelas também não disputam o mesmo banco.

2. *98,5% de cobertura quer dizer que o sistema não tem bugs?*
   Não. Cobertura mede quais linhas **foram executadas** pelos testes, não se o resultado foi conferido. Um teste sem `assert` também "cobre" o código. Ela serve para achar o que **nunca** é testado (aqui, por exemplo, alguns erros de configuração no `config.js`). A qualidade vem das asserções: os testes conferem status HTTP, corpo da resposta, estoque, auditoria e rollback no banco real.

3. *Se o Sonar apontou um problema, por que não corrigir todos? Por que ignorar dois?*
   Porque a ferramenta pode errar, e quem decide é quem conhece o código. O `| 0` do gerador mulberry32 é intencional (faz o *overflow* de 32 bits do algoritmo; `Math.trunc` mudaria a sequência). A regra "use VARCHAR2" é do Oracle e não existe no PostgreSQL. Os dois foram marcados **com a justificativa escrita**, no código e no `sonar-project.properties`, para que o revisor veja o motivo. Ignorar sem explicar seria esconder o problema.

---

## Ajustes finais de interface (issue #34)

**O que foi feito**

1. No dashboard, os rótulos de técnica SQL e os textos explicativos longos saíram da tela. Cada bloco ganhou um ícone ⓘ cujo tooltip mostra a técnica SQL e a explicação. Ele abre com o mouse e com o teclado (Tab), continua aberto com o ponteiro sobre o texto, fecha com Esc e é a descrição do botão (`aria-describedby`) para leitores de tela.
2. Top 5 peças, Pareto e MTTR acima da média agora seguem o filtro 30/90/180 dias. As três consultas de `04_consultas_bd2.sql` recebem `$1`/`$2`, e a API passa as datas como parâmetros. No psql, o `\bind` manda os mesmos valores, com padrão de 90 dias calculado no cabeçalho do arquivo.
3. Os subtítulos mostram o período usado, que a API devolve junto das linhas (`{ inicio, fim, linhas }`). Se o período for trocado rápido, as respostas antigas são descartadas.
4. O "1 analysis warning" do SonarCloud na `main` não era o `fetch-depth` (já era `0`). Era o analisador PL/SQL do Oracle lendo os `.sql` do PostgreSQL. Os `.sql` saíram da análise, com a justificativa no `sonar-project.properties`.
5. Conferido no navegador: o seletor de peça do fechamento mostra código, estoque e o começo da descrição sem corte.

**Perguntas prováveis**

1. *Por que `$1` e `$2` em vez de montar a data dentro do texto do SQL?*
   Porque o valor nunca vira parte do comando: o banco recebe o SQL e os parâmetros separados, e não há como uma data maliciosa mudar a consulta (SQL injection). O plano também pode ser reaproveitado. As datas ainda são validadas na rota (formato `AAAA-MM-DD`, data real, início ≤ fim) antes de chegar ao banco.

2. *Como o mesmo arquivo roda no psql, se o psql não sabe o que é `$1`?*
   O comando `\bind` do psql (versão 16+) define os valores dos parâmetros da próxima consulta, e o psql usa o protocolo estendido, igual ao driver `pg` da API. O cabeçalho calcula o padrão (`SELECT CURRENT_DATE - 90 ... \gset`) só se `data_ini`/`data_fim` não vierem por `-v`. A API ignora tudo o que vem antes do primeiro `-- @consulta` e as linhas que começam com `\`, então os dois rodam exatamente o mesmo SQL.

3. *Tirar os `.sql` do SonarCloud não é esconder problema?*
   Não, porque o SonarCloud não analisa PostgreSQL: ele trata os arquivos como PL/SQL do Oracle, não consegue ler a sintaxe (16 erros de parse), pede uma conexão com um banco Oracle (o aviso) e aplica regras do Oracle (a única que apontou algo era falso positivo). O SQL continua verificado por ferramentas que entendem PostgreSQL: a CI aplica os scripts num PostgreSQL 18 real e roda as consultas no psql, e os testes da API conferem triggers, função e procedure com números calculados à mão.

---

## Segurança (QSS)

Registro das correções e dos controles de segurança, para o relatório do QSS.

### S1 — ReDoS na leitura das consultas BD2 (PR #22, regra Sonar S5852, severidade crítica)

**O que é ReDoS.** *Regular expression Denial of Service* é uma negação de serviço causada por uma expressão regular. Os motores de regex do JavaScript (e da maioria das linguagens) testam as alternativas com *backtracking*: quando uma tentativa falha, voltam e tentam outra divisão do texto. Se a regex tem **quantificadores aninhados** que podem casar o mesmo trecho de mais de uma forma, como `(a*)*` ou `(x\s*)*` com `\s*` dos dois lados, o número de divisões possíveis cresce **exponencialmente** com o tamanho do texto. Uma entrada pequena e maliciosa, que quase casa mas falha no fim, pode travar o processo por segundos ou minutos. Como o Node.js roda o JavaScript numa única thread, enquanto a regex roda **nenhuma outra requisição é atendida**: a API inteira para.

**Por que o Sonar apontou.** Em `backend/src/consultasBd2.js`, a remoção do `;` final usava `/;\s*(--[^\n]*\s*)*$/`. O grupo `(--[^\n]*\s*)*` é repetido por `*`, e dentro dele `[^\n]*` e `\s*` podem dividir os espaços entre si de várias formas. Quando o `$` final não casa, o motor experimenta todas as combinações. Medição feita com entradas do tipo `;` + `--` repetido n vezes + `x`:

| n | Tamanho da entrada | Tempo da regex antiga |
|---|---|---|
| 14 | 37 caracteres | 63 ms |
| 16 | 41 caracteres | 251 ms |
| 18 | 45 caracteres | 1.055 ms |
| 20 | 49 caracteres | **10.583 ms** |

Cada 4 caracteres a mais multiplicam o tempo por 4 a 10. A regex que validava o início (`^\s*(--[^\n]*\n\s*)*(SELECT|WITH)`) tinha o mesmo padrão aninhado e também foi removida. O Quality Gate do PR reprovou com `new_security_rating = E` (o limite é A).

**Risco real neste caso.** Baixo: o texto analisado é um arquivo do próprio repositório, lido uma vez quando a API sobe, e não vem do usuário. Mesmo assim, a correção é obrigatória. O código poderia ser reaproveitado com entrada externa, e o padrão é uma vulnerabilidade conhecida (CWE-1333).

**Como foi corrigido.** O parser foi reescrito para processar o arquivo **linha a linha**, só com operações simples de string, **sem nenhuma expressão regular**:
- `split('\n')` separa as linhas, e `endsWith('\r')` trata as quebras de linha do Windows;
- `startsWith('-- @consulta ')` identifica o marcador de cada consulta;
- linhas que começam com `\` (como `\echo`) são ignoradas;
- a consulta termina na primeira linha cujo `trimEnd()` termina em `;`, e o `;` é retirado com `slice`;
- depois do `;` só podem vir comentários ou linhas vazias; caso contrário, o arquivo é recusado por ter "mais de um comando";
- a primeira linha útil precisa começar com `SELECT` ou `WITH`, e o nome da consulta só aceita `a-z`, `0-9` e `-`.

Cada linha é examinada uma vez, então o tempo é **linear**: a mesma entrada patológica, com 100.000 caracteres, é processada em **0,4 ms**. As 3 consultas geradas são **idênticas, byte a byte**, às da versão anterior, e a API devolve os mesmos resultados. Há um teste de desempenho que falha se o parser levar mais de 200 ms com essa entrada, além de testes de CRLF, comentários depois do `;`, dois comandos, ausência de `;`, nome inválido e consulta duplicada.

**Perguntas prováveis**

1. *Se o arquivo SQL não vem do usuário, por que corrigir?*
   Porque a vulnerabilidade está no **código**, não só no uso atual. Amanhã alguém pode reaproveitar a função com um texto vindo de uma requisição. Além disso, o Quality Gate trata qualquer vulnerabilidade nova como bloqueante, e o QSS avalia justamente esse processo: detectar, corrigir e comprovar com o relatório de antes e depois.

2. *Toda regex é perigosa?*
   Não. O perigo está em quantificadores **aninhados** ou **alternativas sobrepostas**, que deixam o mesmo trecho ser casado de várias formas, como `(a+)+`, `(a|a)*` ou `(\s*x)*`. Regex simples, sem repetição dentro de repetição, como `^\d{4}-\d{2}-\d{2}$` (usada na validação de datas), rodam em tempo linear. Quando a regra é simples, operações de string também são mais legíveis.

3. *Por que o ReDoS é tão grave no Node.js em particular?*
   Porque o Node executa o JavaScript num único *event loop*. Uma regex presa em backtracking ocupa essa thread, e todas as outras requisições, inclusive as de outros usuários, ficam esperando. Com 50 caracteres, um atacante segura a API por 10 segundos. Repetindo a chamada, deixa o sistema indisponível.

### S2 — XSS e Content-Security-Policy no front (PR da #8)

- **Controle 1, saída segura:** dados da API entram na página só por `textContent` (função `el()` de `js/ui.js`). O teste `tests/front.test.js` falha se aparecer `innerHTML`, `outerHTML`, `insertAdjacentHTML` ou `document.write` no JS do front.
- **Controle 2, CSP sem `'unsafe-inline'`:** os padrões do helmet liberam `style-src 'unsafe-inline'`, então a política foi escrita à mão: `default-src 'self'`, `script-src 'self'`, `script-src-attr 'none'`, `style-src 'self'`, `object-src 'none'`, `frame-ancestors 'none'` (contra clickjacking), `base-uri 'self'` e `form-action 'self'`. O `upgrade-insecure-requests` só é ligado em produção (HTTPS). Um teste confere o cabeçalho e outro garante que os HTML não têm script, estilo ou `on*=` inline.
- **Comprovação:** num navegador real, uma resposta da API com `<img src=x onerror=...>` e `<script>` nos campos aparece como texto, sem executar nada, e o console fica sem nenhuma violação de CSP.

### Q1 — Promessas sem tratamento no front (PR da #8, regra Sonar S9383, confiabilidade)

- **O que o Sonar apontou:** 3 chamadas de `carregarLista()` em tratadores de evento sem `await`, `.catch()` ou `void`, ou seja, promessas "soltas". Uma promessa rejeitada sem tratamento vira um erro silencioso (*unhandled rejection*): a tela para de atualizar e ninguém fica sabendo por quê. Isso derrubou a nota de confiabilidade do PR para C e reprovou o Quality Gate.
- **Risco real:** nenhum erro se perdia, porque `carregarLista()` captura as próprias exceções e mostra a mensagem na tela; ela nunca rejeita. Mas o código não deixava essa intenção visível.
- **Correção:** `recarregarDoInicio()` passou a devolver a promessa e é aguardada com `await` depois de abrir uma OS. Nos tratadores de evento, onde não há o que aguardar, a promessa é ignorada de forma **explícita** com `void carregarLista()`, com um comentário explicando por que é seguro.

### S3 — Rate limit configurável, 404 do front e arquivos internos (PR da #24)

- **Rate limit de login:** a variável `LOGIN_RATE_LIMIT_MAX` tem padrão **10 tentativas por IP a cada 15 min**, que é o valor de produção. Valores inválidos impedem a API de subir (inteiro de 1 a 10.000, com teste). O limite maior (100) existe só no `.env` de desenvolvimento, para os testes automatizados de navegador.
- **404 do front:** endereços inexistentes fora de `/api` devolvem a página `404.html`, sem detalhes internos. Dentro de `/api`, a resposta continua sendo o JSON padronizado.
- **Exposição de arquivos:** como o Express serve a pasta `frontend/`, os caminhos `package.json`, `package-lock.json`, `scripts/` e `node_modules/` respondem 404 (com teste). Assim não se revelam versões de dependências, que ajudariam a escolher um exploit. No NGINX do deploy, os mesmos caminhos devem ser bloqueados.
- **Sem recursos externos:** um teste falha se algum HTML, CSS ou JS do front apontar para uma URL externa ou usar `@import`. No navegador, a verificação "nenhuma requisição a domínio externo" passou.

### S4 — Gestão de usuários e senhas (PR da #28)

| Controle | Como foi feito | Teste |
|---|---|---|
| Senhas com hash forte | bcrypt com custo 10 e *salt* aleatório por senha | o hash gravado começa com `$2b$10$` e o `bcrypt.compare` confere |
| Hash nunca exposto | colunas listadas explicitamente (sem `SELECT *`); `RETURNING` sem `senha_hash` | nenhuma resposta contém `senha_hash` nem `$2b$` |
| Política de senha | 10+ caracteres, letra e número, até 72 bytes (limite do bcrypt), no cadastro e na troca | 4 casos inválidos devolvem 400 com o motivo |
| Sem enumeração de contas | e-mail inexistente, senha errada e usuário inativo recebem a mesma resposta e levam o mesmo tempo (bcrypt sempre roda) | as respostas de inativo e de senha errada são idênticas |
| Revogação imediata | o middleware consulta `ativo` (e o perfil) no banco a cada requisição | token emitido antes da desativação dá 401 em `/me` e `/os` |
| Privilégio mínimo | só o SUPERVISOR lista, cadastra e (des)ativa; sem autocadastro | OPERADOR e TECNICO recebem 403 em todas as rotas |
| Contra se trancar fora | o supervisor não desativa a si mesmo | 409 `AUTO_DESATIVACAO`, e ele continua ativo |
| Força bruta na troca de senha | rate limit próprio em `POST /api/auth/senha` e confirmação da senha atual | senha atual errada dá 400, e a senha não muda |
| Histórico preservado | usuário nunca é apagado, só desativado | as FKs de OS, movimentações e auditoria continuam válidas |
