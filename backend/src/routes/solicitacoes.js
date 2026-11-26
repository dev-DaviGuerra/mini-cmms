// Cadastro público: POST /api/solicitacoes (sem login).
// Defesas: rate limit por IP, campo "armadilha" (honeypot) contra robôs, validação no
// servidor e consentimento obrigatório. A resposta é sempre a mesma (202), para não revelar
// se o e-mail já existe nem se o robô foi detectado.
import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import { criarValidador } from '../validacao.js';
import * as solicitacaoService from '../services/solicitacaoService.js';

const RESPOSTA = Object.freeze({
  mensagem: 'Recebemos sua solicitação. Vamos analisar e responder pelo e-mail informado.',
});

// O campo "site" fica escondido no formulário (fora da tela, sem foco pelo Tab): pessoas
// não o preenchem; robôs que preenchem todos os campos, sim.
export const CAMPO_ARMADILHA = 'site';

function validar(body) {
  const v = criarValidador();
  const dados = {
    empresa: v.texto(body.empresa, 'empresa', { min: 2, max: 120 }),
    responsavel: v.texto(body.responsavel, 'responsavel', { min: 3, max: 100 }),
    email: v.email(body.email, 'email'),
    cidade: v.texto(body.cidade, 'cidade', { min: 2, max: 80 }),
    uf: v.opcao(typeof body.uf === 'string' ? body.uf.toUpperCase() : body.uf, 'uf', solicitacaoService.UFS),
    equipamentos: v.inteiroEntre(body.equipamentos, 'equipamentos', 1, 100000),
  };
  if (body.consentimento !== true) v.erro('consentimento é obrigatório: aceite o aviso de privacidade');
  v.verificar('Dados da solicitação inválidos');
  return dados;
}

export function criarRotasSolicitacoes({ limite }) {
  const router = Router();
  router.post('/', rateLimit({
    windowMs: 60 * 60 * 1000,
    limit: limite,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: { erro: { codigo: 'MUITAS_SOLICITACOES', mensagem: 'Muitas solicitações deste endereço. Tente mais tarde.' } },
  }), async (req, res) => {
    const body = req.body ?? {};
    const armadilha = body[CAMPO_ARMADILHA];
    if (armadilha !== undefined && armadilha !== '') {
      return res.status(202).json(RESPOSTA); // robô: finge que deu certo e não grava nada
    }
    await solicitacaoService.criarSolicitacao(validar(body));
    return res.status(202).json(RESPOSTA);
  });
  return router;
}
