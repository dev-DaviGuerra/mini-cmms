// Regras de negócio das ordens de serviço (OS).
// Toda escrita roda em transacao(), que grava app.usuario_id para a auditoria.
import { query, transacao } from '../db.js';
import { ErroConflito, ErroNaoEncontrado } from '../errors.js';

export const TIPOS = Object.freeze(['CORRETIVA', 'PREVENTIVA']);
export const PRIORIDADES = Object.freeze(['BAIXA', 'MEDIA', 'ALTA', 'EMERGENCIA']);
export const STATUS = Object.freeze(['ABERTA', 'EM_ANDAMENTO', 'AGUARDANDO_PECA', 'FECHADA', 'CANCELADA']);

const COLUNAS_OS = `
  os.id, os.equipamento_id, e.tag AS equipamento_tag, e.nome AS equipamento_nome,
  os.aberta_por, ua.nome AS aberta_por_nome, os.tecnico_id, ut.nome AS tecnico_nome,
  os.tipo, os.prioridade, os.status, os.descricao, os.causa, os.solucao,
  os.aberta_em, os.iniciada_em, os.fechada_em, os.horas`;

const FROM_OS = `
  FROM ordens_servico os
  JOIN equipamentos e  ON e.id  = os.equipamento_id
  JOIN usuarios     ua ON ua.id = os.aberta_por
  LEFT JOIN usuarios ut ON ut.id = os.tecnico_id`;

// Abrir OS (H2): numa única transação, cria a OS e coloca o equipamento como PARADO.
export async function abrirOs({ equipamentoId, tipo, prioridade, descricao }, usuarioId) {
  const osId = await transacao(usuarioId, async (client) => {
    // FOR UPDATE trava a linha do equipamento até o COMMIT: duas aberturas simultâneas
    // no mesmo equipamento ficam em fila, sem atualização perdida.
    const eq = await client.query('SELECT id FROM equipamentos WHERE id = $1 FOR UPDATE', [equipamentoId]);
    if (!eq.rowCount) throw new ErroNaoEncontrado(`Equipamento ${equipamentoId} não encontrado`);

    const { rows } = await client.query(
      `INSERT INTO ordens_servico (equipamento_id, aberta_por, tipo, prioridade, descricao)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [equipamentoId, usuarioId, tipo, prioridade, descricao],
    );

    await client.query("UPDATE equipamentos SET status = 'PARADO' WHERE id = $1", [equipamentoId]);
    return rows[0].id;
  });

  return buscarOs(osId);
}

// Lê a OS travando a linha (FOR UPDATE) até o fim da transação. Duas requisições
// simultâneas sobre a mesma OS ficam em fila: a segunda já enxerga o status novo.
async function travarOs(client, id) {
  const { rows } = await client.query(
    'SELECT id, equipamento_id, status, tecnico_id FROM ordens_servico WHERE id = $1 FOR UPDATE',
    [id],
  );
  if (!rows.length) throw new ErroNaoEncontrado(`OS ${id} não encontrada`);
  return rows[0];
}

function exigirStatus(os, esperado, acao) {
  if (os.status !== esperado) {
    throw new ErroConflito(
      'STATUS_INVALIDO',
      `Não é possível ${acao} a OS ${os.id}: status atual ${os.status}, esperado ${esperado}`,
      { statusAtual: os.status, statusEsperado: esperado },
    );
  }
}

// Assumir OS (H3): só OS ABERTA. Grava técnico, início e status EM_ANDAMENTO.
// A trigger trg_auditoria_os registra ABERTA -> EM_ANDAMENTO com o usuário de app.usuario_id.
export async function assumirOs(id, tecnicoId) {
  await transacao(tecnicoId, async (client) => {
    const os = await travarOs(client, id);
    exigirStatus(os, 'ABERTA', 'assumir');
    await client.query(
      `UPDATE ordens_servico
          SET status = 'EM_ANDAMENTO', tecnico_id = $1, iniciada_em = now()
        WHERE id = $2`,
      [tecnicoId, id],
    );
  });
  return buscarOs(id);
}

// Lista OS com filtros opcionais e paginação (limit/offset).
// Os filtros entram como parâmetros ($n), nunca concatenados no texto do SQL.
export async function listarOs({ status, prioridade, equipamentoId, limit, offset }) {
  const condicoes = [];
  const parametros = [];
  const filtrar = (sql, valor) => {
    parametros.push(valor);
    condicoes.push(`${sql} $${parametros.length}`);
  };

  if (status) filtrar('os.status =', status);
  if (prioridade) filtrar('os.prioridade =', prioridade);
  if (equipamentoId) filtrar('os.equipamento_id =', equipamentoId);
  const where = condicoes.length ? `WHERE ${condicoes.join(' AND ')}` : '';

  const [total, pagina] = await Promise.all([
    query(`SELECT COUNT(*)::int AS total FROM ordens_servico os ${where}`, parametros),
    query(
      `SELECT ${COLUNAS_OS} ${FROM_OS} ${where}
       ORDER BY os.aberta_em DESC, os.id DESC
       LIMIT $${parametros.length + 1} OFFSET $${parametros.length + 2}`,
      [...parametros, limit, offset],
    ),
  ]);

  return { dados: pagina.rows, paginacao: { limit, offset, total: total.rows[0].total } };
}

// Detalhe da OS com peças usadas e histórico de auditoria (H9).
export async function buscarOs(id) {
  const { rows } = await query(`SELECT ${COLUNAS_OS} ${FROM_OS} WHERE os.id = $1`, [id]);
  if (!rows.length) throw new ErroNaoEncontrado(`OS ${id} não encontrada`);

  const [pecas, auditoria] = await Promise.all([
    query(
      `SELECT op.peca_id, p.codigo, p.descricao, op.qtd, op.custo_unit
         FROM os_pecas op JOIN pecas p ON p.id = op.peca_id
        WHERE op.os_id = $1 ORDER BY p.codigo`,
      [id],
    ),
    query(
      `SELECT a.status_de, a.status_para, a.usuario_id, u.nome AS usuario_nome, a.data
         FROM os_auditoria a LEFT JOIN usuarios u ON u.id = a.usuario_id
        WHERE a.os_id = $1 ORDER BY a.data, a.id`,
      [id],
    ),
  ]);

  return { ...rows[0], pecas: pecas.rows, auditoria: auditoria.rows };
}
