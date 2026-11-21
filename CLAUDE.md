# CLAUDE.md — Regras do projeto Mini-CMMS

Projeto individual da AVD2 (Módulo IV). Apresentação: **01/12/2026**.
Referência completa: `Mini-CMMS_Projeto_AVD2.pdf` (local, fora do git).

## Escopo MVP (não adicionar nada além disto)

**PostgreSQL**
- Tabelas da seção 5 do PDF: usuarios, equipamentos, pecas, ordens_servico, os_pecas,
  movimentacoes, alertas_estoque, os_auditoria.
- Triggers `trg_estoque_minimo` e `trg_auditoria_os`.
- Função `sp_kpis_equipamento(data_ini, data_fim)` (MTTR, MTBF, disponibilidade, custo).
- 3 consultas BD2 em `database/04_consultas_bd2.sql`.
- `database/seed.js`: 10 equipamentos, 30 peças, ~200 OS fictícias em 90 dias.

**API** — Node 20 + Express (ES Modules)
- Login JWT com perfis OPERADOR / TECNICO / SUPERVISOR; senhas com bcrypt.
- Rotas: OS (abrir, assumir, fechar com transação e ROLLBACK), equipamentos, peças, KPIs.
- Sempre queries parametrizadas; `helmet`; `express-rate-limit`.

**Front** — HTML + JS vanilla + Chart.js
- Telas: login, lista de OS, detalhe/fechamento da OS, dashboard.

Fora do escopo (só se o usuário pedir): tela de estoque, cancelamento de OS, entrada de nota,
deploy, SonarCloud, artigo, slides.

## Regras de trabalho
1. Manter `README.md` e este `CLAUDE.md` atualizados.
2. Uma issue por funcionalidade (via `gh`) e GitHub Project com colunas To Do / In Progress / Done.
3. Cada funcionalidade em `feature/<issue>-<nome>`, commits pequenos, PR com `Closes #N`.
   **O usuário revisa e faz o merge** — nunca fazer merge nem push na `main` diretamente.
4. Ao terminar cada etapa, adicionar em `docs/estudo.md`: explicação de 5 linhas do que foi feito
   + 3 perguntas que um professor poderia fazer, com as respostas.
5. Nunca commitar `.env`. Manter `.env.example` sem segredos reais.

## Decisões de negócio (seção 6.2 do PDF)
- Prioridades: BAIXA / MEDIA / ALTA / EMERGENCIA.
- Status da OS: ABERTA, EM_ANDAMENTO, AGUARDANDO_PECA, FECHADA, CANCELADA.
- MTTR medido de `aberta_em` até `fechada_em` (tempo de equipamento parado), só OS CORRETIVAS fechadas.
- Custo da hora técnica: parâmetro `p_custo_hora` da função de KPIs (padrão R$ 80,00).
- Usuário da auditoria: a API faz `SET LOCAL app.usuario_id = <id>` na transação; a trigger lê
  com `current_setting('app.usuario_id', true)`.
- Todos os dados são fictícios (repositório público).

## Comandos
```bash
# aplicar o banco (psql do PostgreSQL local)
psql "$DATABASE_URL" -f database/01_schema.sql -f database/02_triggers.sql -f database/03_procedures.sql
cd database && npm install && npm run seed
psql "$DATABASE_URL" -f database/04_consultas_bd2.sql
```
