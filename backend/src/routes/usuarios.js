// Rotas de gestão de usuários: /api/usuarios (só SUPERVISOR)
import { Router } from 'express';
import { autenticar } from '../middlewares/auth.js';
import { exigirPerfil } from '../middlewares/perfil.js';
import { criarValidador } from '../validacao.js';
import * as usuarioService from '../services/usuarioService.js';

const router = Router();
router.use(autenticar, exigirPerfil('SUPERVISOR'));

// GET /api/usuarios  ->  [{ id, nome, email, perfil, ativo }]  (nunca o hash da senha)
router.get('/', async (_req, res) => {
  res.json(await usuarioService.listarUsuarios());
});

// POST /api/usuarios  { nome, email, perfil, senha }  ->  201
router.post('/', async (req, res) => {
  const v = criarValidador();
  const body = req.body ?? {};
  const dados = {
    nome: v.texto(body.nome, 'nome', { min: 3, max: 100 }),
    email: v.email(body.email, 'email'),
    perfil: v.opcao(body.perfil, 'perfil', usuarioService.PERFIS),
    senha: v.senha(body.senha, 'senha'),
  };
  v.verificar('Dados do usuário inválidos');

  res.status(201).json(await usuarioService.criarUsuario(dados));
});

// PATCH /api/usuarios/:id/ativo  { ativo: true|false }  ->  200 + usuário
router.patch('/:id/ativo', async (req, res) => {
  const v = criarValidador();
  const id = v.inteiroPositivo(req.params.id, 'id');
  const ativo = v.booleano(req.body?.ativo, 'ativo');
  v.verificar('Dados inválidos');

  res.json(await usuarioService.definirAtivo(id, ativo, req.usuario.id));
});

export default router;
