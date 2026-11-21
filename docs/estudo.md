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
