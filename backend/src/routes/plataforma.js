// Painel da plataforma: /api/plataforma (só o perfil PLATAFORMA)
import { Router } from 'express';
import { autenticarPlataforma } from '../middlewares/auth.js';
import { criarValidador } from '../validacao.js';
import * as plataformaService from '../services/plataformaService.js';

const router = Router();
router.use(autenticarPlataforma);

// GET /api/plataforma/solicitacoes?status=PENDENTE|APROVADA|RECUSADA (padrão PENDENTE)
router.get('/solicitacoes', async (req, res) => {
  const v = criarValidador();
  const status = v.opcao(req.query.status, 'status', plataformaService.STATUS_SOLICITACAO, { padrao: 'PENDENTE' });
  v.verificar('Filtro inválido');
  res.json(await plataformaService.listarSolicitacoes(status));
});

// POST /api/plataforma/solicitacoes/:id/aprovar  ->  201 { empresa, supervisor, senhaTemporaria }
// A senha temporária aparece só nesta resposta: no-store impede que fique em cache.
router.post('/solicitacoes/:id/aprovar', async (req, res) => {
  const v = criarValidador();
  const id = v.inteiroPositivo(req.params.id, 'id');
  v.verificar('Id inválido');
  res.set('Cache-Control', 'no-store');
  res.status(201).json(await plataformaService.aprovar(id));
});

// POST /api/plataforma/solicitacoes/:id/recusar  { motivo? }  ->  200 + solicitação
router.post('/solicitacoes/:id/recusar', async (req, res) => {
  const v = criarValidador();
  const id = v.inteiroPositivo(req.params.id, 'id');
  const bruto = req.body?.motivo;
  const motivo = bruto === undefined || bruto === null || bruto === '' ? null : v.texto(bruto, 'motivo', { min: 3, max: 300 });
  v.verificar('Dados inválidos');
  res.json(await plataformaService.recusar(id, motivo));
});

// GET /api/plataforma/empresas  ->  só nome, cidade/UF, ativa e data (nada operacional)
router.get('/empresas', async (_req, res) => {
  res.json(await plataformaService.listarEmpresas());
});

export default router;
