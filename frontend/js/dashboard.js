// Dashboard: só indicadores e gráficos (Chart.js servido localmente).
// - "Agora": /api/kpis/resumo (situação atual, não depende do período)
// - "No período" e gráficos de MTTR/disponibilidade: /api/kpis?inicio&fim (sp_kpis_equipamento)
// - Pareto, top 5 peças e MTTR acima da média: consultas BD2 (janelas fixas do próprio SQL)
// Regras de visualização seguidas: um eixo por gráfico (sem eixo duplo), barras começam no 0,
// disponibilidade em pontos (eixo começa perto dos valores, por isso não é barra), referências
// (média, 80%) em tinta neutra tracejada, legenda só com 2+ séries e tabela em cada gráfico.
import { api, exigirLogin, ErroApi } from './api.js';
import { el, limpar, montarLayout, mostrarMensagem, estadoVazio } from './ui.js';

const usuario = await exigirLogin();
montarLayout(usuario, 'dashboard');

const { Chart } = window;
const $ = (id) => document.getElementById(id);
const caixa = $('mensagem');
const graficos = {}; // instâncias do Chart.js, por id (destruídas antes de redesenhar)

// ---- formatação pt-BR ----------------------------------------------------------------
const num = (v, casas = 1) => Number(v).toLocaleString('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas });
const moeda = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const moedaCurta = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', notation: 'compact', maximumFractionDigits: 1 });
const dataBr = (iso) => iso.split('-').reverse().join('/');

// data local AAAA-MM-DD (o filtro usa o dia do usuário; a API valida e calcula no banco)
function dataLocal(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// ---- cores e fontes vêm do CSS (design tokens) ------------------------------------------
const css = getComputedStyle(document.documentElement);
const token = (nome) => css.getPropertyValue(nome).trim();
const COR = {
  serie1: token('--grafico-serie-1'),
  serie2: token('--grafico-serie-2'),
  referencia: token('--grafico-referencia'),
  grade: token('--grafico-grade'),
  texto: token('--grafico-texto'),
};
const reduzMovimento = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

if (Chart) {
  Chart.defaults.font.family = '"IBM Plex Sans", "Segoe UI", system-ui, sans-serif';
  Chart.defaults.font.size = 12;
  Chart.defaults.color = COR.texto;
  Chart.defaults.borderColor = COR.grade;
  Chart.defaults.maintainAspectRatio = false;
  // altera só a duração: trocar o objeto inteiro apagaria o easing padrão (erro "this._fn")
  if (reduzMovimento) Chart.defaults.animation = false;
  else Chart.defaults.animation.duration = 400;
  Chart.defaults.plugins.tooltip.backgroundColor = token('--grafite-900');
  Chart.defaults.plugins.tooltip.padding = 10;
  Chart.defaults.plugins.tooltip.titleFont = { weight: '600' };
  Chart.defaults.plugins.legend.labels.boxWidth = 14;
  Chart.defaults.plugins.legend.labels.boxHeight = 3;
  Chart.defaults.plugins.legend.align = 'end';
}

// linha horizontal de referência (média, 80%): neutra, tracejada, sem pontos
function referencia(rotulo, valor, quantidade) {
  return {
    type: 'line',
    label: rotulo,
    data: Array(quantidade).fill(valor),
    borderColor: COR.referencia,
    borderWidth: 2,
    borderDash: [6, 4],
    pointRadius: 0,
    pointHitRadius: 0,
    pointStyle: 'line', // na legenda com usePointStyle, aparece como traço (é uma linha)
    order: 0,
  };
}

const eixoY = (titulo, extra = {}) => ({
  beginAtZero: true,
  grid: { color: COR.grade },
  border: { display: false },
  title: { display: Boolean(titulo), text: titulo },
  ...extra,
});
const eixoCategoria = (extra = {}) => ({ grid: { display: false }, border: { color: token('--grafite-300') }, ...extra });

// cada gráfico mora numa "área"; sem dados, a área mostra um aviso no lugar do <canvas>
const AREA = {
  'grafico-mttr': 'area-mttr',
  'grafico-disp': 'area-disp',
  'grafico-pareto': 'area-pareto',
  'grafico-pecas': 'area-pecas',
};

// Acessibilidade: o CONTÊINER do gráfico tem role="img" com um resumo em texto. Pela
// especificação ARIA, os filhos de role="img" são apresentacionais, então o <canvas> não é
// lido à parte (sem role nem aria-hidden nele). Os números estão em "Ver dados em tabela".
function desenhar(id, config, descricao) {
  graficos[id]?.destroy();
  const area = $(AREA[id]);
  let canvas = $(id);
  if (!canvas) { // a área estava mostrando "sem dados": recria o canvas
    limpar(area);
    area.classList.remove('sem-dados');
    canvas = el('canvas', { attrs: { id } });
    area.append(canvas);
  }
  area.setAttribute('role', 'img');
  area.setAttribute('aria-label', descricao);
  graficos[id] = new Chart(canvas, config);
}

// tabela acessível sob cada gráfico (textContent via el())
// numericas: alinhadas à direita em mono; fixas: mono sem quebra de linha (tags, códigos)
function tabela(alvo, cabecalho, linhas, { numericas = [], fixas = [] } = {}) {
  const classe = (i) => {
    if (numericas.includes(i)) return 'numero mono';
    return fixas.includes(i) ? 'mono sem-quebra' : '';
  };
  limpar(alvo);
  alvo.append(el('table', { classe: 'tabela tabela-simples' }, [
    el('thead', {}, [el('tr', {}, cabecalho.map((t, i) => el('th', { classe: numericas.includes(i) ? 'numero' : '', texto: t, attrs: { scope: 'col' } })))]),
    el('tbody', {}, linhas.map((l) => el('tr', {}, l.map((v, i) => el('td', { classe: classe(i), texto: v }))))),
  ]));
}

function vazio(id, titulo, texto) {
  graficos[id]?.destroy();
  delete graficos[id];
  const area = $(AREA[id]);
  limpar(area);
  area.classList.add('sem-dados');
  area.removeAttribute('role'); // agora é texto comum (o aviso), não uma imagem
  area.removeAttribute('aria-label');
  area.append(estadoVazio({ titulo, texto }));
}

function erroNoBloco(id, erro) {
  vazio(id, 'Não foi possível carregar', erro instanceof ErroApi ? erro.mensagem : erro.message);
}

// rótulos longos quebrados em até 2 linhas (Chart.js aceita array por rótulo)
function quebrar(texto, max = 14) {
  const palavras = texto.split(' ');
  const linhas = [''];
  for (const p of palavras) {
    const atual = linhas.at(-1);
    if (atual && `${atual} ${p}`.length > max && linhas.length < 2) linhas.push(p);
    else linhas[linhas.length - 1] = atual ? `${atual} ${p}` : p;
  }
  return linhas;
}

// ---------------------------------------------------------------------------------------
// "Agora": /api/kpis/resumo
// ---------------------------------------------------------------------------------------
async function carregarResumo() {
  try {
    const r = await api.get('/kpis/resumo');
    $('kpi-abertas').textContent = r.os_abertas;
    $('kpi-andamento').textContent = r.os_em_andamento;
    $('kpi-aguardando').textContent = r.os_aguardando_peca;
    $('kpi-parados').textContent = r.equipamentos_parados;
    $('kpi-alertas').textContent = r.alertas_pendentes;
    $('card-parados').classList.toggle('ativo', r.equipamentos_parados > 0);
    $('card-alertas').classList.toggle('ativo', r.alertas_pendentes > 0);
  } catch (erro) {
    for (const id of ['kpi-abertas', 'kpi-andamento', 'kpi-aguardando', 'kpi-parados', 'kpi-alertas']) $(id).textContent = '—';
    mostrarMensagem(caixa, `Não foi possível carregar o resumo: ${erro.message}`);
  }
}

// ---------------------------------------------------------------------------------------
// Período: totais + MTTR e disponibilidade por equipamento (sp_kpis_equipamento)
// ---------------------------------------------------------------------------------------
function renderTotais(eqs) {
  const falhas = eqs.reduce((s, e) => s + e.n_falhas, 0);
  // MTTR médio ponderado pelas falhas = tempo total de reparo ÷ total de falhas
  const horasReparo = eqs.reduce((s, e) => s + (e.mttr_h ?? 0) * e.n_falhas, 0);
  const dispMedia = eqs.length ? eqs.reduce((s, e) => s + e.disponibilidade, 0) / eqs.length : null;
  const custo = eqs.reduce((s, e) => s + e.custo_total, 0);
  $('tot-falhas').textContent = falhas;
  $('tot-mttr').textContent = falhas ? `${num(horasReparo / falhas)} h` : '—';
  $('tot-disp').textContent = dispMedia === null ? '—' : `${num(dispMedia)}%`;
  $('tot-custo').textContent = moeda.format(custo);
  return { mttrMedio: falhas ? horasReparo / falhas : null, dispMedia };
}

function renderMttr(eqs, mttrMedio) {
  const comFalha = eqs.filter((e) => e.n_falhas > 0);
  if (!comFalha.length) {
    vazio('grafico-mttr', 'Sem falhas no período', 'Nenhuma OS corretiva foi fechada neste período.');
    limpar($('tabela-mttr'));
    return;
  }
  // horizontal e ordenado do maior para o menor: tags legíveis (sem girar) e o ranking salta aos olhos
  const ordenados = [...comFalha].sort((a, b) => b.mttr_h - a.mttr_h);
  const rotulos = ordenados.map((e) => e.tag);
  desenhar('grafico-mttr', {
    type: 'bar',
    data: {
      labels: rotulos,
      datasets: [
        { label: 'MTTR (h)', data: ordenados.map((e) => e.mttr_h), backgroundColor: COR.serie1, borderRadius: 4, maxBarThickness: 18, order: 1 },
        { ...referencia(`Média ponderada ${num(mttrMedio)} h`, mttrMedio, rotulos.length), indexAxis: 'y' },
      ],
    },
    options: {
      indexAxis: 'y',
      interaction: { mode: 'index', intersect: false, axis: 'y' },
      scales: { x: eixoY('horas'), y: eixoCategoria({ ticks: { font: { family: '"IBM Plex Mono", Consolas, monospace' } } }) },
      plugins: {
        tooltip: {
          callbacks: {
            title: (itens) => { const e = ordenados[itens[0].dataIndex]; return `${e.tag} · ${e.nome}`; },
            label: (ctx) => (ctx.datasetIndex === 0
              ? `MTTR: ${num(ctx.raw)} h (${ordenados[ctx.dataIndex].n_falhas} falhas)`
              : `Média ponderada: ${num(ctx.raw)} h`),
          },
        },
      },
    },
  }, `MTTR por equipamento, do maior para o menor. Maior: ${ordenados[0].tag} com ${num(ordenados[0].mttr_h)} horas. Média ponderada ${num(mttrMedio)} horas.`);
  tabela($('tabela-mttr'), ['Tag', 'Equipamento', 'Falhas', 'MTTR (h)', 'MTBF (h)'],
    ordenados.map((e) => [e.tag, e.nome, e.n_falhas, num(e.mttr_h), num(e.mtbf_h)]), { numericas: [2, 3, 4], fixas: [0] });
}

function renderDisponibilidade(eqs, dispMedia) {
  if (!eqs.length) {
    vazio('grafico-disp', 'Sem equipamentos', 'Cadastre equipamentos para ver a disponibilidade.');
    return;
  }
  // do menos disponível (mais crítico) para o mais disponível
  const ordenados = [...eqs].sort((a, b) => a.disponibilidade - b.disponibilidade);
  const valores = ordenados.map((e) => e.disponibilidade);
  // pontos (não barras): o eixo pode começar perto dos valores sem exagerar diferenças
  const minimo = Math.max(0, Math.floor(Math.min(...valores) - 2));
  $('subtitulo-disp').textContent = `%, MTBF ÷ (MTBF + MTTR) · eixo começa em ${minimo}%`;
  const rotulos = ordenados.map((e) => e.tag);
  desenhar('grafico-disp', {
    type: 'line',
    data: {
      labels: rotulos,
      datasets: [
        {
          label: 'Disponibilidade (%)',
          data: valores,
          showLine: false,
          pointRadius: 6,
          pointHoverRadius: 8,
          pointBackgroundColor: COR.serie1,
          borderColor: COR.serie1,
          pointBorderColor: token('--branco'),
          pointBorderWidth: 2,
          pointStyle: 'circle',
          order: 1,
        },
        referencia(`Média ${num(dispMedia)}%`, dispMedia, rotulos.length),
      ],
    },
    options: {
      indexAxis: 'y',
      interaction: { mode: 'index', intersect: false, axis: 'y' },
      scales: {
        x: eixoY('%', { beginAtZero: false, min: minimo, max: 100, ticks: { callback: (v) => `${v}%` } }),
        y: eixoCategoria({ offset: true, ticks: { font: { family: '"IBM Plex Mono", Consolas, monospace' } } }),
      },
      plugins: {
        // ícone de cada série na legenda = a própria marca (círculo para os pontos, traço para a média)
        legend: {
          labels: {
            usePointStyle: true,
            generateLabels: (grafico) => Chart.defaults.plugins.legend.labels.generateLabels(grafico).map((item) => ({
              ...item,
              pointStyle: item.datasetIndex === 0 ? 'circle' : 'line',
              fillStyle: item.datasetIndex === 0 ? COR.serie1 : COR.referencia,
              strokeStyle: item.datasetIndex === 0 ? COR.serie1 : COR.referencia,
              lineWidth: 2,
            })),
          },
        },
        tooltip: {
          callbacks: {
            title: (itens) => { const e = ordenados[itens[0].dataIndex]; return `${e.tag} · ${e.nome}`; },
            label: (ctx) => (ctx.datasetIndex === 0 ? `Disponibilidade: ${num(ctx.raw, 2)}%` : `Média: ${num(ctx.raw, 2)}%`),
          },
        },
      },
    },
  }, `Disponibilidade por equipamento, de ${num(Math.min(...valores))}% (${ordenados[0].tag}) a ${num(Math.max(...valores))}%. Média ${num(dispMedia)}%.`);
  tabela($('tabela-disp'), ['Tag', 'Equipamento', 'Disponibilidade', 'Custo'],
    ordenados.map((e) => [e.tag, e.nome, `${num(e.disponibilidade, 2)}%`, moeda.format(e.custo_total)]), { numericas: [2, 3], fixas: [0] });
}

async function carregarPeriodo(dias) {
  const fim = new Date();
  const inicio = new Date(fim);
  inicio.setDate(inicio.getDate() - dias);
  for (const id of ['tot-falhas', 'tot-mttr', 'tot-disp', 'tot-custo']) {
    limpar($(id));
    $(id).append(el('span', { classe: 'skeleton valor' }));
  }
  try {
    const k = await api.get(`/kpis?inicio=${dataLocal(inicio)}&fim=${dataLocal(fim)}`);
    $('periodo-datas').textContent = `${dataBr(k.inicio)} a ${dataBr(k.fim)}`;
    const { mttrMedio, dispMedia } = renderTotais(k.equipamentos);
    renderMttr(k.equipamentos, mttrMedio);
    renderDisponibilidade(k.equipamentos, dispMedia);
  } catch (erro) {
    for (const id of ['tot-falhas', 'tot-mttr', 'tot-disp', 'tot-custo']) $(id).textContent = '—';
    erroNoBloco('grafico-mttr', erro);
    erroNoBloco('grafico-disp', erro);
  }
}

// ---------------------------------------------------------------------------------------
// Consultas BD2 (janelas fixas do SQL)
// ---------------------------------------------------------------------------------------
async function carregarPareto() {
  try {
    const linhas = await api.get('/kpis/pareto-causas');
    if (!linhas.length) { vazio('grafico-pareto', 'Sem falhas registradas', 'O Pareto aparece quando houver OS corretivas fechadas.'); return; }
    const rotulos = linhas.map((l) => quebrar(l.causa));
    // UM eixo (0–100%): barras = % de cada causa, linha = % acumulado. Sem eixo duplo.
    desenhar('grafico-pareto', {
      type: 'bar',
      data: {
        labels: rotulos,
        datasets: [
          { label: '% das falhas', data: linhas.map((l) => l.pct), backgroundColor: COR.serie1, borderRadius: 4, maxBarThickness: 46, order: 2 },
          {
            type: 'line', label: '% acumulado', data: linhas.map((l) => l.pct_acumulado),
            borderColor: COR.serie2, backgroundColor: COR.serie2, borderWidth: 2, pointRadius: 4, pointHoverRadius: 6, tension: 0, order: 1,
            clip: false, // o último ponto (100%) não é cortado no topo
          },
          referencia('80% (corte do Pareto)', 80, linhas.length),
        ],
      },
      options: {
        layout: { padding: { top: 8 } },
        interaction: { mode: 'index', intersect: false },
        scales: { y: eixoY('% das falhas', { max: 100, ticks: { callback: (v) => `${v}%` } }), x: eixoCategoria({ ticks: { autoSkip: false, maxRotation: 0 } }) },
        plugins: {
          tooltip: {
            callbacks: {
              title: (itens) => linhas[itens[0].dataIndex].causa,
              label: (ctx) => {
                const l = linhas[ctx.dataIndex];
                if (ctx.datasetIndex === 0) return `${num(l.pct)}% das falhas (${l.qtd} OS)`;
                if (ctx.datasetIndex === 1) return `Acumulado: ${num(l.pct_acumulado)}% · ${l.classe}`;
                return 'Corte de 80%';
              },
            },
          },
        },
      },
    }, `Pareto das causas. ${linhas.filter((l) => l.classe.startsWith('A')).length} causas somam cerca de 80% das falhas; a principal é ${linhas[0].causa}.`);
    tabela($('tabela-pareto'), ['Causa', 'OS', '%', '% acumulado', 'Classe'],
      linhas.map((l) => [l.causa, l.qtd, `${num(l.pct)}%`, `${num(l.pct_acumulado)}%`, l.classe]), { numericas: [1, 2, 3] });
  } catch (erro) {
    erroNoBloco('grafico-pareto', erro);
  }
}

async function carregarTopPecas() {
  try {
    const linhas = await api.get('/kpis/top-pecas');
    if (!linhas.length) { vazio('grafico-pecas', 'Sem consumo', 'Nenhuma peça saiu do estoque nos últimos 30 dias.'); return; }
    desenhar('grafico-pecas', {
      type: 'bar',
      data: {
        labels: linhas.map((l) => l.codigo),
        datasets: [{ label: 'Unidades', data: linhas.map((l) => l.qtd_consumida), backgroundColor: COR.serie1, borderRadius: 4, maxBarThickness: 26 }],
      },
      options: {
        indexAxis: 'y',
        scales: { x: eixoY('unidades', { ticks: { precision: 0 } }), y: eixoCategoria({ ticks: { font: { family: '"IBM Plex Mono", Consolas, monospace' } } }) },
        plugins: {
          legend: { display: false }, // série única: o título do bloco já a nomeia
          tooltip: {
            callbacks: {
              title: (itens) => { const l = linhas[itens[0].dataIndex]; return `${l.codigo} · ${l.descricao}`; },
              label: (ctx) => { const l = linhas[ctx.dataIndex]; return [`${l.qtd_consumida} un. em ${l.qtd_os} OS`, `Custo estimado: ${moeda.format(l.custo_estimado)}`]; },
            },
          },
        },
      },
    }, `Top 5 peças consumidas em 30 dias. Primeira: ${linhas[0].codigo}, ${linhas[0].qtd_consumida} unidades.`);
    tabela($('tabela-pecas'), ['Código', 'Descrição', 'Unid.', 'OS', 'Custo', 'Estoque'],
      linhas.map((l) => [l.codigo, l.descricao, l.qtd_consumida, l.qtd_os, moedaCurta.format(l.custo_estimado), `${l.estoque_atual} / mín. ${l.estoque_min}`]),
      { numericas: [2, 3, 4], fixas: [0, 5] });
  } catch (erro) {
    erroNoBloco('grafico-pecas', erro);
  }
}

async function carregarMttrAcima() {
  const alvo = $('tabela-acima');
  try {
    const linhas = await api.get('/kpis/mttr-acima-media');
    limpar(alvo);
    if (!linhas.length) { alvo.append(estadoVazio({ titulo: 'Nenhum equipamento acima da média', texto: 'Todos estão na média ou abaixo dela.' })); return; }
    const media = linhas[0].mttr_medio_h;
    // a consulta BD2 compara com a média SIMPLES dos MTTR dos equipamentos (AVG na subquery);
    // o card "MTTR médio" usa a média ponderada pelas falhas — por isso os valores diferem
    alvo.append(el('p', {
      classe: 'nota-tabela',
      texto: `Média simples dos MTTR dos equipamentos: ${num(media, 2)} h (o card "MTTR médio" é ponderado pelas falhas).`,
    }));
    tabela(alvo.appendChild(el('div')), ['Tag', 'Equipamento', 'Falhas', 'MTTR', 'Acima da média'],
      linhas.map((l) => [l.tag, l.nome, l.n_falhas, `${num(l.mttr_h, 2)} h`, `+${num(l.mttr_h - media, 2)} h`]), { numericas: [2, 3, 4], fixas: [0] });
  } catch (erro) {
    limpar(alvo);
    mostrarMensagem(alvo, `Não foi possível carregar: ${erro instanceof ErroApi ? erro.mensagem : erro.message}`);
    alvo.hidden = false;
  }
}

// ---------------------------------------------------------------------------------------
// Início
// ---------------------------------------------------------------------------------------
if (!Chart) {
  mostrarMensagem(caixa, 'Não foi possível carregar a biblioteca de gráficos (vendor/chart.umd.min.js).');
}

for (const radio of document.querySelectorAll('input[name="periodo"]')) {
  radio.addEventListener('change', () => { void carregarPeriodo(Number(radio.value)); });
}

await Promise.all([
  carregarResumo(),
  carregarPeriodo(90),
  carregarPareto(),
  carregarTopPecas(),
  carregarMttrAcima(),
]);
