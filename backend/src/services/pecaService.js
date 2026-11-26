// Regras de negócio de peças, entrada de estoque (H6) e alertas (H7).
import { query, transacao } from '../db.js';
import { ErroConflito, ErroNaoEncontrado } from '../errors.js';

const COLUNAS_PECA = `id, codigo, descricao, estoque, estoque_min, custo_unit,
                      (estoque < estoque_min) AS abaixo_minimo`;

export async function listarPecas() {
  const { rows } = await query(`SELECT ${COLUNAS_PECA} FROM pecas ORDER BY codigo`);
  return rows;
}

async function buscarPeca(id) {
  const { rows } = await query(`SELECT ${COLUNAS_PECA} FROM pecas WHERE id = $1`, [id]);
  if (!rows.length) throw new ErroNaoEncontrado(`Peça ${id} não encontrada`);
  return rows[0];
}

// Cadastra uma peça com estoque 0. O saldo entra depois por POST /api/pecas/:id/entrada,
// para que toda quantidade em estoque tenha uma movimentação ENTRADA rastreável.
export async function criarPeca({ codigo, descricao, estoqueMin, custoUnit }) {
  try {
    const { rows } = await query(
      `INSERT INTO pecas (codigo, descricao, estoque, estoque_min, custo_unit)
       VALUES ($1, $2, 0, $3, $4)
       RETURNING ${COLUNAS_PECA}`,
      [codigo, descricao, estoqueMin, custoUnit],
    );
    return rows[0];
  } catch (erro) {
    if (erro.code === '23505') {
      throw new ErroConflito('CODIGO_DUPLICADO', `Já existe uma peça com o código ${codigo}`, { codigo });
    }
    throw erro;
  }
}

// Entrada de estoque: chama a PROCEDURE sp_entrada_estoque (CALL), que soma o estoque,
// grava a movimentação ENTRADA e resolve os alertas se o estoque voltar ao mínimo.
// A peça é travada antes para responder 404 com mensagem clara, em vez do RAISE da procedure.
export async function entradaEstoque(pecaId, qtd, usuarioId) {
  const alertasResolvidos = await transacao(async (client) => {
    const peca = await client.query('SELECT id FROM pecas WHERE id = $1 FOR UPDATE', [pecaId]);
    if (!peca.rowCount) throw new ErroNaoEncontrado(`Peça ${pecaId} não encontrada`);

    const pendentes = await client.query(
      'SELECT COUNT(*)::int AS n FROM alertas_estoque WHERE peca_id = $1 AND NOT resolvido', [pecaId]);
    await client.query('CALL sp_entrada_estoque($1, $2, $3)', [pecaId, qtd, usuarioId]);
    const restantes = await client.query(
      'SELECT COUNT(*)::int AS n FROM alertas_estoque WHERE peca_id = $1 AND NOT resolvido', [pecaId]);

    return pendentes.rows[0].n - restantes.rows[0].n;
  });

  return { peca: await buscarPeca(pecaId), alertasResolvidos };
}

// Alertas de estoque mínimo ainda não resolvidos (criados pela trigger trg_estoque_minimo).
export async function listarAlertasPendentes() {
  const { rows } = await query(`
    SELECT a.id, a.criado_em, a.peca_id, p.codigo, p.descricao, p.estoque, p.estoque_min
      FROM alertas_estoque a
      JOIN pecas p ON p.id = a.peca_id
     WHERE NOT a.resolvido
     ORDER BY a.criado_em DESC, a.id DESC`);
  return rows;
}
