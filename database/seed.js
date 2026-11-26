// =====================================================================
// MaintOS — seed.js
// Popula o banco com dados FICTÍCIOS de DUAS empresas (multiempresa, #41):
//   Empresa Demonstração: 4 usuários, 10 equipamentos, 30 peças, ~200 OS em 90 dias;
//   Metalúrgica Exemplo:  3 usuários, 6 equipamentos (tags repetidas de propósito,
//                         como R-01), 30 peças e as próprias OS;
// mais o administrador da plataforma (PLATAFORMA) e 2 solicitações de acesso pendentes.
//
// Uso:  cd database && npm install && npm run seed          (banco de desenvolvimento)
//       npm run seed:teste                                  (banco de teste, cmms_test)
// Lê DATABASE_URL_ADMIN (ou DATABASE_URL_TEST_ADMIN) e SEED_PASSWORD de backend/.env: o
// seed precisa do DONO das tabelas, porque apaga e recria tudo (TRUNCATE).
// Pré-requisito: 01, 02, 03, 05 e 06 aplicados.
//
// O gerador aleatório tem semente fixa: toda execução gera os mesmos dados,
// o que ajuda a ensaiar a apresentação.
// =====================================================================
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import dotenv from 'dotenv';
import pg from 'pg';
import bcrypt from 'bcrypt';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', 'backend', '.env') });

const CHAVE_URL = process.argv.includes('--teste') ? 'DATABASE_URL_TEST_ADMIN' : 'DATABASE_URL_ADMIN';
const DATABASE_URL = process.env[CHAVE_URL];
const { SEED_PASSWORD } = process.env;
if (!DATABASE_URL || !SEED_PASSWORD) {
  console.error(`Defina ${CHAVE_URL} e SEED_PASSWORD em backend/.env (veja .env.example).`);
  process.exit(1);
}

// Banco remoto (ex.: Neon) => SSL com verificação de certificado; local => sem SSL.
// Mesma regra de backend/src/db.js (sslmode/channel_binding são parâmetros do psql).
function configConexao(url) {
  const u = new URL(url);
  u.searchParams.delete('sslmode');
  u.searchParams.delete('channel_binding');
  const local = ['localhost', '127.0.0.1', '::1'].includes(u.hostname.replace(/^\[|\]$/g, ''));
  return { connectionString: u.toString(), ssl: local ? false : { rejectUnauthorized: true } };
}

// ---------------------------------------------------------------------
// Gerador pseudoaleatório com semente (mulberry32)
// ---------------------------------------------------------------------
function mulberry32(seed) {
  return () => {
    // "| 0" é intencional: reduz a soma a inteiro de 32 bits (overflow circular), que é o
    // que o mulberry32 exige. Math.trunc não faz isso, e mudaria a sequência gerada.
    seed = (seed + 0x6d2b79f5) | 0; // NOSONAR (S7767)
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(20261201);
const entre = (min, max) => min + rand() * (max - min);
const inteiro = (min, max) => Math.floor(entre(min, max + 1));
const escolher = (lista) => lista[Math.floor(rand() * lista.length)];
function escolherPonderado(pares) {          // [[valor, peso], ...]
  const total = pares.reduce((s, [, p]) => s + p, 0);
  let r = rand() * total;
  for (const [valor, peso] of pares) {
    if ((r -= peso) < 0) return valor;
  }
  return pares[pares.length - 1][0];
}
const HORA = 3600 * 1000;

// ---------------------------------------------------------------------
// Dados fictícios
// ---------------------------------------------------------------------

// [tag, nome, linha, criticidade, falhas esperadas em 90 dias]
const EQUIPAMENTOS_DEMO = [
  ['R-01', 'Robô de solda 01', 'Linha 1 - Soldagem', 'A', 24],
  ['R-02', 'Robô de solda 02', 'Linha 1 - Soldagem', 'A', 20],
  ['R-03', 'Robô de solda 03', 'Linha 1 - Soldagem', 'A', 28],
  ['PH-01', 'Prensa hidráulica 01', 'Linha 2 - Estamparia', 'A', 26],
  ['PH-02', 'Prensa hidráulica 02', 'Linha 2 - Estamparia', 'B', 18],
  ['TC-01', 'Torno CNC 01', 'Linha 3 - Usinagem', 'B', 16],
  ['FR-01', 'Fresadora CNC 01', 'Linha 3 - Usinagem', 'B', 14],
  ['EST-01', 'Esteira transportadora 01', 'Linha 4 - Montagem', 'C', 20],
  ['CP-01', 'Compressor de ar 01', 'Utilidades', 'A', 18],
  ['CLD-01', 'Caldeira 01', 'Utilidades', 'C', 12],
];

// [codigo, descricao, estoque_min, custo_unit]
const PECAS = [
  ['ROL-6205', 'Rolamento 6205 2RS', 6, 38.5],
  ['ROL-6308', 'Rolamento 6308 ZZ', 4, 92.0],
  ['COR-A42', 'Correia em V A-42', 5, 45.9],
  ['COR-B60', 'Correia em V B-60', 4, 67.3],
  ['SEN-IND12', 'Sensor indutivo M12', 5, 129.0],
  ['SEN-FOT18', 'Sensor fotoelétrico M18', 4, 210.0],
  ['FUS-10A', 'Fusível 10A NH', 10, 12.4],
  ['CON-25A', 'Contator 25A 220V', 3, 185.0],
  ['REL-TER', 'Relé térmico 9-13A', 3, 142.5],
  ['VED-HID50', 'Kit vedação cilindro 50mm', 3, 260.0],
  ['MAN-HID', 'Mangueira hidráulica 1/2"', 4, 155.0],
  ['FIL-OLE', 'Filtro de óleo hidráulico', 5, 88.0],
  ['FIL-AR', 'Filtro de ar compressor', 4, 74.0],
  ['OLE-68', 'Óleo hidráulico ISO 68 (L)', 20, 21.5],
  ['GRX-EP2', 'Graxa EP2 (kg)', 8, 34.0],
  ['BIC-SOL', 'Bico de contato solda MIG', 30, 4.2],
  ['TOC-SOL', 'Tocha de solda MIG 350A', 2, 980.0],
  ['CAB-SOL', 'Cabo de solda 35mm (m)', 15, 18.0],
  ['MOT-1CV', 'Motor elétrico 1 CV', 1, 890.0],
  ['INV-2CV', 'Inversor de frequência 2 CV', 1, 1450.0],
  ['ENC-INC', 'Encoder incremental 1024ppr', 2, 620.0],
  ['PAS-FRE', 'Pastilha de metal duro', 20, 27.0],
  ['POR-FER', 'Porta-ferramenta CNC', 2, 340.0],
  ['VAL-SOL', 'Válvula solenoide 1/2"', 3, 210.0],
  ['VAL-ALV', 'Válvula de alívio 10 bar', 2, 175.0],
  ['PRE-MAN', 'Pressostato 0-12 bar', 2, 198.0],
  ['TER-PT100', 'Termopar PT100', 3, 96.0],
  ['ROD-EST', 'Roletes de esteira 50mm', 10, 32.0],
  ['MAN-EST', 'Manta de esteira (m)', 5, 145.0],
  ['ACO-ELA', 'Acoplamento elástico', 3, 118.0],
];

// Peças "preferidas" por tipo de equipamento (prefixo da tag)
const PECAS_POR_TIPO = {
  R: ['BIC-SOL', 'TOC-SOL', 'CAB-SOL', 'SEN-IND12', 'ENC-INC', 'CON-25A', 'FUS-10A'],
  PH: ['VED-HID50', 'MAN-HID', 'FIL-OLE', 'OLE-68', 'VAL-SOL', 'SEN-IND12', 'PRE-MAN'],
  TC: ['ROL-6205', 'PAS-FRE', 'POR-FER', 'ENC-INC', 'COR-A42', 'INV-2CV', 'GRX-EP2'],
  FR: ['ROL-6205', 'PAS-FRE', 'POR-FER', 'COR-B60', 'MOT-1CV', 'GRX-EP2'],
  EST: ['ROD-EST', 'MAN-EST', 'ROL-6205', 'MOT-1CV', 'INV-2CV', 'ACO-ELA', 'SEN-FOT18'],
  CP: ['FIL-AR', 'VAL-ALV', 'PRE-MAN', 'ROL-6308', 'COR-B60', 'REL-TER', 'OLE-68'],
  CLD: ['TER-PT100', 'VAL-SOL', 'VAL-ALV', 'CON-25A', 'REL-TER', 'FUS-10A'],
};


// Causas com pesos desiguais, para o Pareto ter "poucas vitais"
const CAUSAS = [
  ['Desgaste de rolamento', 22],
  ['Falha elétrica', 18],
  ['Vazamento hidráulico', 14],
  ['Sensor com defeito', 12],
  ['Correia rompida', 8],
  ['Superaquecimento', 6],
  ['Lubrificação insuficiente', 5],
  ['Desalinhamento', 4],
  ['Erro de operação', 3],
];

const SOLUCOES = {
  'Desgaste de rolamento': 'Substituição do rolamento e relubrificação',
  'Falha elétrica': 'Troca de componente elétrico e reaperto de bornes',
  'Vazamento hidráulico': 'Troca de vedação/mangueira e reposição de óleo',
  'Sensor com defeito': 'Substituição e ajuste do sensor',
  'Correia rompida': 'Troca da correia e ajuste de tensão',
  Superaquecimento: 'Limpeza do sistema de arrefecimento e verificação de carga',
  'Lubrificação insuficiente': 'Lubrificação e revisão do plano de lubrificação',
  Desalinhamento: 'Realinhamento do conjunto motor/acoplamento',
  'Erro de operação': 'Reset do equipamento e orientação ao operador',
};

const DESCRICOES_CORRETIVA = [
  'Equipamento parou durante a produção',
  'Ruído anormal e vibração excessiva',
  'Alarme de falha no painel',
  'Vazamento visível no equipamento',
  'Equipamento não liga',
  'Temperatura acima do normal',
  'Peças saindo fora de especificação',
];
const DESCRICOES_PREVENTIVA = [
  'Preventiva mensal: inspeção geral e lubrificação',
  'Preventiva: troca de filtros',
  'Preventiva: reaperto e inspeção elétrica',
  'Preventiva: verificação de folgas e alinhamento',
];

// Mesmas tags R-01, PH-01, TC-01... da outra empresa: a unicidade é por empresa.
const EQUIPAMENTOS_METALURGICA = [
  ['R-01', 'Robô de solda 01', 'Linha A - Soldagem', 'A', 18],
  ['PH-01', 'Prensa hidráulica 01', 'Linha B - Estamparia', 'A', 22],
  ['TC-01', 'Torno CNC 01', 'Linha C - Usinagem', 'B', 14],
  ['TC-02', 'Torno CNC 02', 'Linha C - Usinagem', 'B', 12],
  ['CP-01', 'Compressor de ar 01', 'Utilidades', 'A', 10],
  ['EST-01', 'Esteira de expedição 01', 'Expedição', 'C', 8],
];

// Empresas fictícias. tagsComOsAberta: equipamentos que terminam o seed com uma OS ABERTA
// (na Demonstração, o R-03 fica livre para a demo). pecasNoMinimo: peças que terminam
// exatamente no mínimo, para a próxima baixa disparar a trigger trg_estoque_minimo.
const EMPRESAS = [
  {
    nome: 'Empresa Demonstração', cidade: 'Rio de Janeiro', uf: 'RJ',
    usuarios: [
      ['Olga Operadora', 'operador@cmms.local', 'OPERADOR'],
      ['Tiago Técnico', 'tecnico@cmms.local', 'TECNICO'],
      ['Tânia Técnica', 'tecnico2@cmms.local', 'TECNICO'],
      ['Sérgio Supervisor', 'supervisor@cmms.local', 'SUPERVISOR'],
    ],
    equipamentos: EQUIPAMENTOS_DEMO,
    tagsComOsAberta: ['PH-02', 'TC-01', 'EST-01'],
    pecasNoMinimo: ['ROL-6205', 'SEN-IND12', 'VED-HID50'],
  },
  {
    nome: 'Metalúrgica Exemplo', cidade: 'Joinville', uf: 'SC',
    usuarios: [
      ['Otávio Operador', 'operador@metalurgica.local', 'OPERADOR'],
      ['Telma Técnica', 'tecnico@metalurgica.local', 'TECNICO'],
      ['Sílvia Supervisora', 'supervisor@metalurgica.local', 'SUPERVISOR'],
    ],
    equipamentos: EQUIPAMENTOS_METALURGICA,
    tagsComOsAberta: ['PH-01', 'TC-02'],
    pecasNoMinimo: ['PAS-FRE'],
  },
];

const PLATAFORMA = ['Paula Plataforma', 'plataforma@maintos.local'];

// Pedidos de acesso fictícios (domínios .example não existem), para a demo do painel
const SOLICITACOES = [
  ['Fundição Serra Azul', 'Renato Lima', 'contato@fundicao-serra-azul.example', 'Caxias do Sul', 'RS', 35],
  ['Plásticos Vale Verde', 'Carla Souza', 'manutencao@valeverde-plasticos.example', 'Sorocaba', 'SP', 60],
];

// ---------------------------------------------------------------------
// Geração das OS em memória
// Para cada equipamento, a linha do tempo anda para frente: falha → reparo
// → próxima falha. Assim as OS de um mesmo equipamento nunca se sobrepõem,
// o que mantém o cálculo de MTBF coerente.
// ---------------------------------------------------------------------
function gerarOrdens(agora, equipamentos, idsOperadores, idsTecnicos, pecasPorCodigo, tagsComOsAberta) {
  const inicio = agora - 90 * 24 * HORA;
  const ordens = [];

  for (const eq of equipamentos) {
    const prefixo = eq.tag.split('-')[0];
    const intervaloMedio = (90 * 24 * HORA) / eq.falhasEsperadas;
    let t = inicio + rand() * intervaloMedio;

    while (t < agora) {
      const tipo = rand() < 0.25 ? 'PREVENTIVA' : 'CORRETIVA';
      const abertaEm = t;
      const iniciadaEm = abertaEm + entre(0.2, 3) * HORA;            // tempo de resposta
      const duracaoReparo = (tipo === 'PREVENTIVA' ? entre(1, 4) : entre(1, 14)) * HORA;
      const fechadaEm = iniciadaEm + duracaoReparo;

      let status = 'FECHADA';
      if (iniciadaEm > agora) status = 'ABERTA';
      else if (fechadaEm > agora) status = 'EM_ANDAMENTO';

      const causa = tipo === 'CORRETIVA' ? escolherPonderado(CAUSAS) : null;
      const prioridade = tipo === 'PREVENTIVA'
        ? 'BAIXA'
        : escolherPonderado(eq.criticidade === 'A'
          ? [['MEDIA', 3], ['ALTA', 5], ['EMERGENCIA', 2]]
          : [['BAIXA', 3], ['MEDIA', 5], ['ALTA', 2]]);

      const os = {
        equipamentoId: eq.id,
        abertaPor: escolher(idsOperadores),
        tecnicoId: status === 'ABERTA' ? null : escolher(idsTecnicos),
        tipo,
        prioridade,
        status,
        descricao: escolher(tipo === 'CORRETIVA' ? DESCRICOES_CORRETIVA : DESCRICOES_PREVENTIVA),
        causa: status === 'FECHADA' ? causa : null,
        solucao: status === 'FECHADA'
          ? (causa ? SOLUCOES[causa] : 'Preventiva executada conforme checklist')
          : null,
        abertaEm: new Date(abertaEm),
        iniciadaEm: status === 'ABERTA' ? null : new Date(iniciadaEm),
        fechadaEm: status === 'FECHADA' ? new Date(fechadaEm) : null,
        horas: status === 'FECHADA' ? Math.round((duracaoReparo / HORA) * 2) / 2 : null,
        pecas: [],
      };

      // Peças consumidas (só em OS fechadas): 0 a 3 peças distintas
      if (status === 'FECHADA') {
        const candidatas = [...PECAS_POR_TIPO[prefixo]];
        const nPecas = escolherPonderado([[0, 2], [1, 4], [2, 3], [3, 1]]);
        for (let i = 0; i < nPecas && candidatas.length; i++) {
          const codigo = candidatas.splice(Math.floor(rand() * candidatas.length), 1)[0];
          const peca = pecasPorCodigo[codigo];
          const qtdMax = peca.custoUnit < 50 ? 4 : peca.custoUnit < 300 ? 2 : 1;
          os.pecas.push({ peca, qtd: inteiro(1, qtdMax) });
        }
      }

      ordens.push(os);
      if (status !== 'FECHADA') break;                 // equipamento ainda em manutenção
      t = fechadaEm + entre(0.3, 1.5) * intervaloMedio;
    }

    // Alguns equipamentos terminam com uma OS recém-aberta, aguardando técnico
    const ultima = ordens[ordens.length - 1];
    if (tagsComOsAberta.includes(eq.tag) && ultima.status === 'FECHADA') {
      ordens.push({
        equipamentoId: eq.id,
        abertaPor: escolher(idsOperadores),
        tecnicoId: null,
        tipo: 'CORRETIVA',
        prioridade: 'ALTA',
        status: 'ABERTA',
        descricao: escolher(DESCRICOES_CORRETIVA),
        causa: null,
        solucao: null,
        abertaEm: new Date(Math.max(agora - entre(0.5, 3) * HORA, ultima.fechadaEm.getTime())),
        iniciadaEm: null,
        fechadaEm: null,
        horas: null,
        pecas: [],
      });
    }
  }

  return ordens.sort((a, b) => a.abertaEm - b.abertaEm);
}

// ---------------------------------------------------------------------
// Execução
// ---------------------------------------------------------------------
// Uma empresa: o contexto app.empresa_id da transação faz o DEFAULT de empresa_id de cada
// tabela (e das linhas geradas pelas triggers) apontar para ela.
async function popularEmpresa(client, empresa, senhaHash, agora) {
  const { rows: [{ id: empresaId }] } = await client.query(
    'INSERT INTO empresas (nome, cidade, uf) VALUES ($1, $2, $3) RETURNING id',
    [empresa.nome, empresa.cidade, empresa.uf],
  );
  await client.query("SELECT set_config('app.empresa_id', $1, true)", [String(empresaId)]);

  // Usuários
  const usuarios = [];
  for (const [nome, email, perfil] of empresa.usuarios) {
    const { rows } = await client.query(
      'INSERT INTO usuarios (nome, email, senha_hash, perfil) VALUES ($1, $2, $3, $4) RETURNING id, perfil',
      [nome, email, senhaHash, perfil],
    );
    usuarios.push(rows[0]);
  }
  const idsDoPerfil = (p) => usuarios.filter((u) => u.perfil === p).map((u) => u.id);
  const idsOperadores = idsDoPerfil('OPERADOR');
  const idsTecnicos = idsDoPerfil('TECNICO');
  const idSupervisor = idsDoPerfil('SUPERVISOR')[0];

  // Equipamentos
  const equipamentos = [];
  for (const [tag, nome, linha, criticidade, falhasEsperadas] of empresa.equipamentos) {
    const { rows } = await client.query(
      'INSERT INTO equipamentos (tag, nome, linha, criticidade) VALUES ($1, $2, $3, $4) RETURNING id',
      [tag, nome, linha, criticidade],
    );
    equipamentos.push({ id: rows[0].id, tag, criticidade, falhasEsperadas });
  }

  // Peças: inseridas com estoque 0; o estoque final é calculado abaixo
  const pecasPorCodigo = {};
  for (const [codigo, descricao, estoqueMin, custoUnit] of PECAS) {
    const { rows } = await client.query(
      'INSERT INTO pecas (codigo, descricao, estoque_min, custo_unit) VALUES ($1, $2, $3, $4) RETURNING id',
      [codigo, descricao, estoqueMin, custoUnit],
    );
    pecasPorCodigo[codigo] = { id: rows[0].id, codigo, estoqueMin, custoUnit, consumo: 0 };
  }

  // Ordens de serviço
  const ordens = gerarOrdens(agora, equipamentos, idsOperadores, idsTecnicos, pecasPorCodigo, empresa.tagsComOsAberta);
  for (const os of ordens) {
    const { rows } = await client.query(
      `INSERT INTO ordens_servico (equipamento_id, aberta_por, tecnico_id, tipo, prioridade, status,
                                   descricao, causa, solucao, aberta_em, iniciada_em, fechada_em, horas)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) RETURNING id`,
      [os.equipamentoId, os.abertaPor, os.tecnicoId, os.tipo, os.prioridade, os.status,
        os.descricao, os.causa, os.solucao, os.abertaEm, os.iniciadaEm, os.fechadaEm, os.horas],
    );
    const osId = rows[0].id;

    for (const { peca, qtd } of os.pecas) {
      await client.query(
        'INSERT INTO os_pecas (os_id, peca_id, qtd, custo_unit) VALUES ($1, $2, $3, $4)',
        [osId, peca.id, qtd, peca.custoUnit],
      );
      await client.query(
        `INSERT INTO movimentacoes (peca_id, tipo, qtd, os_id, usuario_id, data)
         VALUES ($1, 'SAIDA', $2, $3, $4, $5)`,
        [peca.id, qtd, osId, os.tecnicoId, os.fechadaEm],
      );
      peca.consumo += qtd;
    }
  }

  // Equipamentos com OS em aberto ficam PARADOS
  await client.query(`
    UPDATE equipamentos SET status = 'PARADO'
     WHERE empresa_id = $1
       AND id IN (SELECT equipamento_id FROM ordens_servico
                   WHERE status IN ('ABERTA', 'EM_ANDAMENTO', 'AGUARDANDO_PECA'))`, [empresaId]);

  // Estoque: uma ENTRADA inicial há 90 dias cobre o consumo + saldo final.
  const pecasNoMinimo = new Set(empresa.pecasNoMinimo);
  const dataEntrada = new Date(agora - 90 * 24 * HORA - HORA);
  for (const peca of Object.values(pecasPorCodigo)) {
    const saldoFinal = pecasNoMinimo.has(peca.codigo)
      ? peca.estoqueMin
      : peca.estoqueMin + inteiro(2, peca.estoqueMin * 3 + 5);
    await client.query(
      `INSERT INTO movimentacoes (peca_id, tipo, qtd, usuario_id, data)
       VALUES ($1, 'ENTRADA', $2, $3, $4)`,
      [peca.id, peca.consumo + saldoFinal, idSupervisor, dataEntrada],
    );
    // INSERT de peça não dispara trg_estoque_minimo; aqui o estoque sobe (0 → saldo),
    // então o UPDATE também não cruza o mínimo para baixo.
    await client.query('UPDATE pecas SET estoque = $1 WHERE id = $2', [saldoFinal, peca.id]);
  }
}

async function main() {
  const client = new pg.Client(configConexao(DATABASE_URL));
  await client.connect();

  try {
    await client.query('BEGIN');
    await client.query(`TRUNCATE os_auditoria, alertas_estoque, movimentacoes, os_pecas, ordens_servico,
                        pecas, equipamentos, usuarios, solicitacoes_acesso, usuarios_plataforma, empresas
                        RESTART IDENTITY CASCADE`);

    const senhaHash = await bcrypt.hash(SEED_PASSWORD, 10);
    const agora = Date.now();
    for (const empresa of EMPRESAS) await popularEmpresa(client, empresa, senhaHash, agora);

    // Administrador da plataforma (fora das empresas) e pedidos de acesso pendentes
    await client.query("SELECT set_config('app.empresa_id', '', true)");
    await client.query('INSERT INTO usuarios_plataforma (nome, email, senha_hash) VALUES ($1, $2, $3)',
      [...PLATAFORMA, senhaHash]);
    for (const [empresa, responsavel, email, cidade, uf, equipamentos] of SOLICITACOES) {
      await client.query(
        `INSERT INTO solicitacoes_acesso (empresa_nome, responsavel, email, cidade, uf, equipamentos_aprox,
                                          consentimento_em, termo_versao, criada_em)
         VALUES ($1, $2, $3, $4, $5, $6, now() - interval '1 day', '2026-11', now() - interval '1 day')`,
        [empresa, responsavel, email, cidade, uf, equipamentos],
      );
    }

    await client.query('COMMIT');

    // Resumo por empresa
    const resumo = await client.query(`
      SELECT e.id, e.nome,
             (SELECT COUNT(*) FROM usuarios u WHERE u.empresa_id = e.id)::int        AS usuarios,
             (SELECT COUNT(*) FROM equipamentos q WHERE q.empresa_id = e.id)::int    AS equipamentos,
             (SELECT COUNT(*) FROM pecas p WHERE p.empresa_id = e.id)::int           AS pecas,
             (SELECT COUNT(*) FROM ordens_servico o WHERE o.empresa_id = e.id)::int  AS ordens_servico,
             (SELECT COUNT(*) FROM ordens_servico o WHERE o.empresa_id = e.id AND o.status = 'ABERTA')::int AS abertas
        FROM empresas e ORDER BY e.id`);
    console.log(`Seed concluído (${CHAVE_URL}):`);
    console.table(resumo.rows);
    console.log('Plataforma: 1 administrador e', SOLICITACOES.length, 'solicitações pendentes.');
  } catch (erro) {
    await client.query('ROLLBACK');
    console.error('Seed falhou, nada foi gravado (ROLLBACK):', erro.message);
    process.exitCode = 1;
  } finally {
    await client.end();
  }
}

await main();
