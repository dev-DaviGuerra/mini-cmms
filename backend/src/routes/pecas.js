// Rotas de peças e alertas: /api/pecas e /api/alertas
import { Router } from 'express';
import { autenticar } from '../middlewares/auth.js';
import { exigirPerfil } from '../middlewares/perfil.js';
import { criarValidador } from '../validacao.js';
import * as pecaService from '../services/pecaService.js';

export const pecasRouter = Router();
pecasRouter.use(autenticar);

// GET /api/pecas  ->  lista com estoque e flag abaixo_minimo (qualquer perfil logado:
// o técnico escolhe as peças ao fechar a OS)
pecasRouter.get('/', async (_req, res) => {
  res.json(await pecaService.listarPecas());
});

// POST /api/pecas  { codigo, descricao, estoqueMin, custoUnit }  ->  201 (estoque 0). Só SUPERVISOR.
pecasRouter.post('/', exigirPerfil('SUPERVISOR'), async (req, res) => {
  const v = criarValidador();
  const body = req.body ?? {};
  const dados = {
    codigo: v.texto(body.codigo, 'codigo', { min: 2, max: 20 })?.toUpperCase(),
    descricao: v.texto(body.descricao, 'descricao', { min: 3, max: 150 }),
    estoqueMin: v.inteiroEntre(body.estoqueMin, 'estoqueMin', 0, 100000, 0),
    custoUnit: v.decimalEntre(body.custoUnit, 'custoUnit', 0, 1000000),
  };
  v.verificar('Dados da peça inválidos');

  res.status(201).json(await pecaService.criarPeca(dados));
});

// POST /api/pecas/:id/entrada  { qtd }  ->  200 { peca, alertasResolvidos }. Só SUPERVISOR.
// Chama a procedure sp_entrada_estoque (CALL).
pecasRouter.post('/:id/entrada', exigirPerfil('SUPERVISOR'), async (req, res) => {
  const v = criarValidador();
  const id = v.inteiroPositivo(req.params.id, 'id');
  const qtd = v.inteiroEntre(req.body?.qtd, 'qtd', 1, 100000);
  v.verificar('Dados da entrada inválidos');

  res.json(await pecaService.entradaEstoque(id, qtd, req.usuario.id));
});

export const alertasRouter = Router();
alertasRouter.use(autenticar);

// GET /api/alertas  ->  alertas de estoque mínimo pendentes. Só SUPERVISOR (H7).
alertasRouter.get('/', exigirPerfil('SUPERVISOR'), async (_req, res) => {
  res.json(await pecaService.listarAlertasPendentes());
});
