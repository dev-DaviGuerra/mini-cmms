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
