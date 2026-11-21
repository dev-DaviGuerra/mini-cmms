// Rotas de indicadores: /api/kpis  (qualquer usuário logado)
import { Router } from 'express';
import { autenticar } from '../middlewares/auth.js';
import { criarValidador } from '../validacao.js';
import * as kpiService from '../services/kpiService.js';

const router = Router();
router.use(autenticar);

// GET /api/kpis?inicio=AAAA-MM-DD&fim=AAAA-MM-DD  (padrão: últimos 90 dias)
//   ->  { inicio, fim, equipamentos: [{ tag, n_falhas, mttr_h, mtbf_h, disponibilidade, custo_total, ... }] }
router.get('/', async (req, res) => {
  const v = criarValidador();
  const inicio = v.data(req.query.inicio, 'inicio');
  const fim = v.data(req.query.fim, 'fim');
  if (inicio && fim && inicio > fim) v.erro('inicio deve ser anterior ou igual a fim');
  v.verificar('Período inválido');

  res.json(await kpiService.kpisPorEquipamento({ inicio, fim }));
});

// GET /api/kpis/resumo  ->  totais para os cards do dashboard
router.get('/resumo', async (_req, res) => {
  res.json(await kpiService.resumo());
});

// Consultas BD2 (SQL de database/04_consultas_bd2.sql)
router.get('/mttr-acima-media', async (_req, res) => res.json(await kpiService.mttrAcimaDaMedia()));
router.get('/top-pecas', async (_req, res) => res.json(await kpiService.topPecas30Dias()));
router.get('/pareto-causas', async (_req, res) => res.json(await kpiService.paretoCausas()));

export default router;
