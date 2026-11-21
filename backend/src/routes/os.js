// Rotas de ordens de serviço: /api/os
// A camada de rota só valida a entrada e chama o service; regra de negócio fica no service.
import { Router } from 'express';
import { autenticar } from '../middlewares/auth.js';
import { exigirPerfil } from '../middlewares/perfil.js';
import { criarValidador } from '../validacao.js';
import * as osService from '../services/osService.js';

const router = Router();
router.use(autenticar); // todas as rotas de OS exigem login

// POST /api/os  { equipamentoId, descricao, tipo?, prioridade? }  ->  201 + OS criada
// Abre a OS e coloca o equipamento como PARADO. Perfis: OPERADOR e SUPERVISOR.
router.post('/', exigirPerfil('OPERADOR', 'SUPERVISOR'), async (req, res) => {
  const v = criarValidador();
  const body = req.body ?? {};
  const dados = {
    equipamentoId: v.inteiroPositivo(body.equipamentoId, 'equipamentoId'),
    descricao: v.texto(body.descricao, 'descricao', { min: 5, max: 1000 }),
    tipo: v.opcao(body.tipo, 'tipo', osService.TIPOS, { padrao: 'CORRETIVA' }),
    prioridade: v.opcao(body.prioridade, 'prioridade', osService.PRIORIDADES, { padrao: 'MEDIA' }),
  };
  v.verificar('Dados da OS inválidos');

  const os = await osService.abrirOs(dados, req.usuario.id);
  res.status(201).location(`/api/os/${os.id}`).json(os);
});

// GET /api/os?status=&prioridade=&equipamentoId=&limit=&offset=
//   ->  { dados: [...], paginacao: { limit, offset, total } }   (mais recentes primeiro)
// limit: padrão 50, máximo 200 · offset: padrão 0
router.get('/', async (req, res) => {
  const v = criarValidador();
  const filtros = {
    status: v.opcao(req.query.status, 'status', osService.STATUS, { padrao: null }),
    prioridade: v.opcao(req.query.prioridade, 'prioridade', osService.PRIORIDADES, { padrao: null }),
    equipamentoId: v.inteiroPositivo(req.query.equipamentoId, 'equipamentoId', { obrigatorio: false }),
    limit: v.inteiroEntre(req.query.limit, 'limit', 1, 200, 50),
    offset: v.inteiroEntre(req.query.offset, 'offset', 0, 1_000_000, 0),
  };
  v.verificar('Filtros inválidos');

  res.json(await osService.listarOs(filtros));
});

// POST /api/os/:id/assumir  ->  200 + OS (EM_ANDAMENTO). Só TECNICO; só OS ABERTA (senão 409).
router.post('/:id/assumir', exigirPerfil('TECNICO'), async (req, res) => {
  const v = criarValidador();
  const id = v.inteiroPositivo(req.params.id, 'id');
  v.verificar('Id inválido');

  res.json(await osService.assumirOs(id, req.usuario.id));
});

// GET /api/os/:id  ->  OS com peças e histórico de auditoria
router.get('/:id', async (req, res) => {
  const v = criarValidador();
  const id = v.inteiroPositivo(req.params.id, 'id');
  v.verificar('Id inválido');

  res.json(await osService.buscarOs(id));
});

export default router;
