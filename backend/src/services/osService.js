// Regras de negócio das ordens de serviço (OS).
// Toda escrita roda em transacao(), com o contexto da requisição (empresa e usuário; a
// auditoria lê app.usuario_id). A RLS faz a OS, o equipamento e a peça de outra empresa
// simplesmente não existirem para a consulta: o resultado é 404, como um id inexistente.
import { query, transacao } from '../db.js';
import { ErroConflito, ErroNaoEncontrado, ErroProibido } from '../errors.js';

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
  const osId = await transacao(async (client) => {
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

// esperado: um status ou uma lista de status aceitos
function exigirStatus(os, esperado, acao) {
  const aceitos = [esperado].flat();
  if (!aceitos.includes(os.status)) {
    throw new ErroConflito(
      'STATUS_INVALIDO',
      `Não é possível ${acao} a OS ${os.id}: status atual ${os.status}, esperado ${aceitos.join(' ou ')}`,
      { statusAtual: os.status, statusEsperado: esperado },
    );
  }
}

// Assumir OS (H3): só OS ABERTA. Grava técnico, início e status EM_ANDAMENTO.
// A trigger trg_auditoria_os registra ABERTA -> EM_ANDAMENTO com o usuário de app.usuario_id.
export async function assumirOs(id, tecnicoId) {
  await transacao(async (client) => {
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

// Baixa de UMA peça: UPDATE condicional (só baixa se houver saldo). Se nenhuma linha for
// afetada, descobre se a peça não existe (404) ou se falta estoque (409).
async function baixarPeca(client, { pecaId, qtd }) {
  const r = await client.query(
    `UPDATE pecas SET estoque = estoque - $1
      WHERE id = $2 AND estoque >= $1
     RETURNING custo_unit`,
    [qtd, pecaId],
  );
  if (r.rowCount) return r.rows[0].custo_unit;

  const { rows } = await client.query('SELECT codigo, estoque FROM pecas WHERE id = $1', [pecaId]);
  if (!rows.length) throw new ErroNaoEncontrado(`Peça ${pecaId} não encontrada`);
  throw new ErroConflito(
    'ESTOQUE_INSUFICIENTE',
    `Estoque insuficiente da peça ${rows[0].codigo}: solicitado ${qtd}, disponível ${rows[0].estoque}`,
    { pecaId, codigo: rows[0].codigo, solicitado: qtd, disponivel: rows[0].estoque },
  );
}

// Fechar OS (H4) — transação principal do DBE2. Tudo ou nada:
//   1. trava OS e equipamento; confere status (EM_ANDAMENTO ou AGUARDANDO_PECA) e permissão
//   2. para cada peça: baixa condicional do estoque, os_pecas (custo do momento), movimentação SAIDA
//   3. OS -> FECHADA com fechada_em, horas, causa e solução
//   4. equipamento -> OPERANDO, só se não houver OUTRA OS pendente para ele
//      (ABERTA, EM_ANDAMENTO ou AGUARDANDO_PECA: todas mantêm o equipamento PARADO)
//   5. COMMIT. Qualquer erro => ROLLBACK (nada do que foi feito acima fica gravado).
// Se o erro for estoque insuficiente, uma SEGUNDA transação, separada, coloca a OS em
// AGUARDANDO_PECA (a primeira já foi desfeita, então só o status muda) e o 409 é repassado.
export async function fecharOs(id, { causa, solucao, horas, pecas }, usuario) {
  // ordem fixa de travamento das peças (por id) evita deadlock entre dois fechamentos
  const pecasOrdenadas = [...pecas].sort((a, b) => a.pecaId - b.pecaId);

  try {
    await transacao(async (client) => {
      const os = await travarOs(client, id);
      exigirStatus(os, ['EM_ANDAMENTO', 'AGUARDANDO_PECA'], 'fechar');
      if (usuario.perfil === 'TECNICO' && os.tecnico_id !== usuario.id) {
        throw new ErroProibido('Só o técnico que assumiu a OS (ou um supervisor) pode fechá-la');
      }

      // trava o equipamento: dois fechamentos de OS do mesmo equipamento ficam em fila,
      // e o segundo já enxerga o primeiro como FECHADA na verificação do passo 4
      await client.query('SELECT id FROM equipamentos WHERE id = $1 FOR UPDATE', [os.equipamento_id]);

      for (const peca of pecasOrdenadas) {
        const custoUnit = await baixarPeca(client, peca);
        await client.query(
          'INSERT INTO os_pecas (os_id, peca_id, qtd, custo_unit) VALUES ($1, $2, $3, $4)',
          [id, peca.pecaId, peca.qtd, custoUnit],
        );
        await client.query(
          `INSERT INTO movimentacoes (peca_id, tipo, qtd, os_id, usuario_id)
           VALUES ($1, 'SAIDA', $2, $3, $4)`,
          [peca.pecaId, peca.qtd, id, usuario.id],
        );
      }

      await client.query(
        `UPDATE ordens_servico
            SET status = 'FECHADA', fechada_em = now(), horas = $1, causa = $2, solucao = $3
          WHERE id = $4`,
        [horas, causa, solucao, id],
      );

      await client.query(
        `UPDATE equipamentos SET status = 'OPERANDO'
          WHERE id = $1
            AND NOT EXISTS (SELECT 1 FROM ordens_servico
                             WHERE equipamento_id = $1 AND id <> $2
                               AND status IN ('ABERTA', 'EM_ANDAMENTO', 'AGUARDANDO_PECA'))`,
        [os.equipamento_id, id],
      );
    });
  } catch (erro) {
    if (erro.codigo === 'ESTOQUE_INSUFICIENTE') {
      await transacao((client) => client.query(
        `UPDATE ordens_servico SET status = 'AGUARDANDO_PECA'
          WHERE id = $1 AND status = 'EM_ANDAMENTO'`,
        [id],
      ));
    }
    throw erro;
  }

  return buscarOs(id);
}

// Lista OS com filtros opcionais e paginação (limit/offset).
// Os filtros entram como parâmetros ($n), nunca concatenados no texto do SQL.
// Página e total numa ÚNICA consulta (COUNT(*) OVER () = total sem o LIMIT): uma viagem ao
// banco a menos. Só numa página vazia além do fim o total precisa de uma consulta à parte.
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

  const { rows } = await query(
    `SELECT ${COLUNAS_OS}, COUNT(*) OVER ()::int AS total_filtro ${FROM_OS} ${where}
     ORDER BY os.aberta_em DESC, os.id DESC
     LIMIT $${parametros.length + 1} OFFSET $${parametros.length + 2}`,
    [...parametros, limit, offset],
  );
  let total = rows[0]?.total_filtro ?? 0;
  if (!rows.length && offset > 0) {
    total = (await query(`SELECT COUNT(*)::int AS total FROM ordens_servico os ${where}`, parametros)).rows[0].total;
  }
  const dados = rows.map(({ total_filtro: _total, ...os }) => os);
  return { dados, paginacao: { limit, offset, total } };
}

// Detalhe da OS com peças usadas e histórico de auditoria (H9), numa ÚNICA consulta: as
// listas vêm de subconsultas com json_agg, em vez de duas consultas a mais.
export async function buscarOs(id) {
  const { rows } = await query(
    `SELECT ${COLUNAS_OS},
            COALESCE((SELECT json_agg(json_build_object(
                               'peca_id', op.peca_id, 'codigo', p.codigo, 'descricao', p.descricao,
                               'qtd', op.qtd, 'custo_unit', op.custo_unit) ORDER BY p.codigo)
                        FROM os_pecas op JOIN pecas p ON p.id = op.peca_id
                       WHERE op.os_id = os.id), '[]') AS pecas,
            COALESCE((SELECT json_agg(json_build_object(
                               'status_de', a.status_de, 'status_para', a.status_para,
                               'usuario_id', a.usuario_id, 'usuario_nome', u.nome, 'data', a.data)
                               ORDER BY a.data, a.id)
                        FROM os_auditoria a LEFT JOIN usuarios u ON u.id = a.usuario_id
                       WHERE a.os_id = os.id), '[]') AS auditoria
       ${FROM_OS} WHERE os.id = $1`,
    [id],
  );
  if (!rows.length) throw new ErroNaoEncontrado(`OS ${id} não encontrada`);
  return rows[0];
}
