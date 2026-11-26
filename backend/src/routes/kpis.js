// Rotas de indicadores: /api/kpis  (qualquer usuário logado)
import { Router } from 'express';
import { autenticar } from '../middlewares/auth.js';
import { criarValidador } from '../validacao.js';
import * as kpiService from '../services/kpiService.js';

const router = Router();
router.use(autenticar);

// ?inicio=AAAA-MM-DD&fim=AAAA-MM-DD, os dois opcionais (padrão: últimos 90 dias até hoje).
// Vale para /api/kpis e para as três consultas BD2.
function lerPeriodo(query) {
  const v = criarValidador();
  const inicio = v.data(query.inicio, 'inicio');
  const fim = v.data(query.fim, 'fim');
  if (inicio && fim && inicio > fim) v.erro('inicio deve ser anterior ou igual a fim');
  v.verificar('Período inválido');
  return { inicio, fim };
}

// GET /api/kpis?inicio&fim
//   ->  { inicio, fim, equipamentos: [{ tag, n_falhas, mttr_h, mtbf_h, disponibilidade, custo_total, ... }] }
router.get('/', async (req, res) => {
  res.json(await kpiService.kpisPorEquipamento(lerPeriodo(req.query)));
});

// GET /api/kpis/resumo  ->  totais para os cards do dashboard
router.get('/resumo', async (_req, res) => {
  res.json(await kpiService.resumo());
});

// Consultas BD2 (SQL de database/04_consultas_bd2.sql), no período ?inicio&fim
//   ->  { inicio, fim, linhas: [...] }
router.get('/mttr-acima-media', async (req, res) => res.json(await kpiService.mttrAcimaDaMedia(lerPeriodo(req.query))));
router.get('/top-pecas', async (req, res) => res.json(await kpiService.topPecas(lerPeriodo(req.query))));
router.get('/pareto-causas', async (req, res) => res.json(await kpiService.paretoCausas(lerPeriodo(req.query))));

export default router;
