// Rotas de equipamentos: /api/equipamentos
import { Router } from 'express';
import { autenticar } from '../middlewares/auth.js';
import { exigirPerfil } from '../middlewares/perfil.js';
import { criarValidador } from '../validacao.js';
import * as equipamentoService from '../services/equipamentoService.js';

const router = Router();
router.use(autenticar);

// GET /api/equipamentos  ->  lista com status e nº de OS pendentes (qualquer perfil logado:
// o operador escolhe o equipamento ao abrir a OS)
router.get('/', async (_req, res) => {
  res.json(await equipamentoService.listarEquipamentos());
});

// POST /api/equipamentos  { tag, nome, linha, criticidade }  ->  201. Só SUPERVISOR.
router.post('/', exigirPerfil('SUPERVISOR'), async (req, res) => {
  const v = criarValidador();
  const body = req.body ?? {};
  const dados = {
    tag: v.texto(body.tag, 'tag', { min: 2, max: 20 })?.toUpperCase(),
    nome: v.texto(body.nome, 'nome', { min: 3, max: 100 }),
    linha: v.texto(body.linha, 'linha', { min: 2, max: 50 }),
    criticidade: v.opcao(body.criticidade, 'criticidade', equipamentoService.CRITICIDADES),
  };
  v.verificar('Dados do equipamento inválidos');

  const equipamento = await equipamentoService.criarEquipamento(dados);
  res.status(201).json(equipamento);
});

export default router;
