// Pedidos de acesso feitos na landing (formulário público).
// Dados mínimos (LGPD): empresa, responsável, e-mail, cidade/UF e nº aproximado de
// equipamentos, mais a data e a versão do termo aceito. Nada de CPF, telefone ou IP.
import { query } from '../db.js';

export const UFS = Object.freeze(['AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG', 'PA',
  'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO']);
// versão do aviso de privacidade (frontend/privacidade.html) que a pessoa aceitou
export const TERMO_VERSAO = '2026-11';

// Grava como PENDENTE. Um segundo pedido PENDENTE com o mesmo e-mail é ignorado em
// silêncio (índice único parcial no banco): a resposta é a mesma, para não revelar se o
// e-mail já tinha pedido acesso. A política de RLS só aceita INSERT com status PENDENTE.
export async function criarSolicitacao({ empresa, responsavel, email, cidade, uf, equipamentos }) {
  try {
    await query(
      `INSERT INTO solicitacoes_acesso
         (empresa_nome, responsavel, email, cidade, uf, equipamentos_aprox, consentimento_em, termo_versao)
       VALUES ($1, $2, $3, $4, $5, $6, now(), $7)`,
      [empresa, responsavel, email, cidade, uf, equipamentos, TERMO_VERSAO],
    );
  } catch (erro) {
    if (erro.code !== '23505') throw erro;
  }
}
