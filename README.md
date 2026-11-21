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

## Como rodar a API

```bash
cd backend
npm install
npm start          # http://localhost:3000  (npm run dev reinicia ao salvar)
npm test           # node:test + supertest; usa o banco do DATABASE_URL
```

O `JWT_SECRET` do `backend/.env` precisa ter pelo menos 32 caracteres; a API não sobe sem ele.
Os testes criam e apagam os próprios usuários (prefixo `teste-`); só exigem os scripts
`01..03` aplicados.

### Endpoints

| Método | Rota | Perfil | Descrição |
|---|---|---|---|
| GET | `/api/health` | público | verificação de vida |
| POST | `/api/auth/login` | público | `{ email, senha }` → `{ token, expiraEm, usuario }` (10 tentativas/15 min) |
| GET | `/api/auth/me` | qualquer logado | dados do usuário do token |

Erros seguem sempre o formato `{ "erro": { "codigo", "mensagem", "detalhes" } }`:
400 validação · 401 sem token/token inválido · 403 perfil sem permissão · 404 não encontrado ·
409 estoque insuficiente ou status inválido.

## Fluxo de trabalho
- Uma issue por funcionalidade, board no GitHub Projects (To Do / In Progress / Done).
- Branch `feature/<issue>-<nome>`, commits pequenos, PR com `Closes #N`, revisão e merge na `main`.
- `.env` nunca é versionado; use `backend/.env.example` como modelo.
