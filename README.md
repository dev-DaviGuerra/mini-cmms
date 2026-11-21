# Mini-CMMS

Sistema de Ordens de Manutenção e Estoque de Peças — projeto da AVD2 (Módulo IV).

Permite cadastrar equipamentos, abrir ordens de serviço (OS), fechá-las consumindo peças do
estoque numa transação atômica e acompanhar indicadores de manutenção (MTTR, MTBF,
disponibilidade e custo). **Todos os dados são fictícios**, gerados pelo `database/seed.js`.

## Stack
- **Banco:** PostgreSQL (tabelas, triggers, função de KPIs, consultas BD2)
- **API:** Node.js 20 + Express (ES Modules), JWT, bcrypt, helmet, express-rate-limit
- **Front:** HTML + JavaScript vanilla + Chart.js

## Estrutura
```
backend/     API Express (src/routes, src/middlewares, src/services)
frontend/    telas HTML + js/ + css/
database/    01_schema.sql, 02_triggers.sql, 03_procedures.sql, 04_consultas_bd2.sql, seed.js
docs/        estudo.md (resumo de cada etapa + perguntas de banca)
```

## Como rodar o banco localmente

Pré-requisitos: PostgreSQL 14+ e Node.js 20.

```bash
# 1. criar o banco
createdb -U postgres cmms

# 2. configurar variáveis
cp backend/.env.example backend/.env   # edite DATABASE_URL com sua senha

# 3. criar tabelas, triggers e função de KPIs
psql "postgres://postgres:SENHA@localhost:5432/cmms" \
  -f database/01_schema.sql -f database/02_triggers.sql -f database/03_procedures.sql

# 4. popular com dados fictícios
cd database && npm install && npm run seed

# 5. rodar as consultas BD2
psql "postgres://postgres:SENHA@localhost:5432/cmms" -f database/04_consultas_bd2.sql
```

Usuários criados pelo seed (senha = `SEED_PASSWORD` do `.env`):

| E-mail | Perfil |
|---|---|
| operador@cmms.local | OPERADOR |
| tecnico@cmms.local | TECNICO |
| tecnico2@cmms.local | TECNICO |
| supervisor@cmms.local | SUPERVISOR |

## Fluxo de trabalho
- Uma issue por funcionalidade, board no GitHub Projects (To Do / In Progress / Done).
- Branch `feature/<issue>-<nome>`, commits pequenos, PR com `Closes #N`, revisão e merge na `main`.
- `.env` nunca é versionado; use `backend/.env.example` como modelo.
