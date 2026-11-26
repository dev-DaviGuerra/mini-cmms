// Painel do administrador da plataforma (perfil PLATAFORMA).
// Ele vê só as solicitações de acesso e a lista de empresas: nunca grava app.empresa_id,
// então a RLS não lhe mostra nenhuma OS, peça, equipamento ou usuário das empresas.
import { randomInt } from 'node:crypto';
import bcrypt from 'bcrypt';
import { query } from '../db.js';
import { ErroConflito, ErroNaoEncontrado, ErroProibido } from '../errors.js';
import { CUSTO_BCRYPT } from './authService.js';

export const STATUS_SOLICITACAO = Object.freeze(['PENDENTE', 'APROVADA', 'RECUSADA']);
const COLUNAS = `id, empresa_nome, responsavel, email, cidade, uf, equipamentos_aprox, status,
                 criada_em, decidida_em, motivo_recusa, empresa_id`;

export async function listarSolicitacoes(status) {
  const { rows } = await query(
    `SELECT ${COLUNAS} FROM solicitacoes_acesso WHERE status = $1 ORDER BY criada_em DESC, id DESC LIMIT 200`,
    [status],
  );
  return rows;
}

export async function listarEmpresas() {
  const { rows } = await query('SELECT id, nome, cidade, uf, ativa, criada_em FROM empresas ORDER BY criada_em DESC, id DESC');
  return rows;
}

// Senha temporária legível (sem 0/O, 1/I/L), em 3 grupos de 4: XXXX-XXXX-XXXX. Tem letra e
// número (exigência da política de senha) e cerca de 59 bits de entropia. Só vale até a
// troca obrigatória no primeiro login.
const ALFABETO = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const grupo = () => Array.from({ length: 4 }, () => ALFABETO[randomInt(ALFABETO.length)]).join('');
export function gerarSenhaTemporaria() {
  let senha;
  do {
    senha = [grupo(), grupo(), grupo()].join('-');
  } while (!/\d/.test(senha) || !/[A-Z]/.test(senha));
  return senha;
}

// Aprovar: cria a empresa e o primeiro SUPERVISOR (fn_aprovar_solicitacao, uma transação no
// banco). A senha temporária volta UMA vez, nesta resposta; no banco fica só o hash.
export async function aprovar(id) {
  const senhaTemporaria = gerarSenhaTemporaria();
  const hash = await bcrypt.hash(senhaTemporaria, CUSTO_BCRYPT);
  try {
    const { rows } = await query(
      `SELECT empresa_id, empresa_nome, supervisor_id, supervisor_nome, supervisor_email
         FROM fn_aprovar_solicitacao($1, $2)`,
      [id, hash],
    );
    const r = rows[0];
    return {
      empresa: { id: r.empresa_id, nome: r.empresa_nome },
      supervisor: { id: r.supervisor_id, nome: r.supervisor_nome, email: r.supervisor_email },
      senhaTemporaria,
    };
  } catch (erro) {
    if (erro.code === 'P0002') throw new ErroNaoEncontrado(`Solicitação ${id} não encontrada`);
    if (erro.code === '55000') throw new ErroConflito('JA_DECIDIDA', `A solicitação ${id} já foi decidida`);
    if (erro.code === '23505') {
      throw new ErroConflito('EMAIL_EM_USO', 'Já existe um usuário com este e-mail na plataforma. Recuse a solicitação ou peça outro e-mail.');
    }
    if (erro.code === '42501') throw new ErroProibido();
    throw erro;
  }
}

export async function recusar(id, motivo) {
  const { rows } = await query(
    `UPDATE solicitacoes_acesso
        SET status = 'RECUSADA', decidida_em = now(), motivo_recusa = $2,
            decidida_por = NULLIF(current_setting('app.usuario_id', true), '')::int
      WHERE id = $1 AND status = 'PENDENTE'
     RETURNING ${COLUNAS}`,
    [id, motivo],
  );
  if (rows.length) return rows[0];
  const existe = await query('SELECT status FROM solicitacoes_acesso WHERE id = $1', [id]);
  if (!existe.rows.length) throw new ErroNaoEncontrado(`Solicitação ${id} não encontrada`);
  throw new ErroConflito('JA_DECIDIDA', `A solicitação ${id} já foi decidida`);
}
