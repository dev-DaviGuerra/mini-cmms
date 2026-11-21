// Detalhe da OS: dados, peças, histórico de auditoria, "Assumir" (TECNICO) e
// "Fechar" em drawer, com lista de peças (TECNICO que assumiu ou SUPERVISOR).
// Os botões aparecem conforme o perfil, mas quem garante a permissão é a API.
import { api, exigirLogin, ErroApi } from './api.js';
import {
  el, limpar, marcaStatus, marcaPrioridade, formatarDataHora, montarLayout, criarDrawer,
  mostrarMensagem, esconderMensagem, estadoVazio, ROTULOS_STATUS, ROTULOS_TIPO,
} from './ui.js';

const usuario = await exigirLogin();
montarLayout(usuario, 'os');

const $ = (id) => document.getElementById(id);
const caixa = $('mensagem');
const caixaFechar = $('mensagem-fechar');
const formFechar = $('form-fechar');
const listaPecas = $('lista-pecas');
const moeda = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

const idTexto = new URLSearchParams(window.location.search).get('id') ?? '';
const osId = /^\d{1,9}$/.test(idTexto) ? Number(idTexto) : null;
let os = null;          // OS carregada
let pecasEstoque = null; // cache de GET /api/pecas para o formulário

// ---------------------------------------------------------------------------------
// Carregamento e renderização
// ---------------------------------------------------------------------------------
function mostrarNaoEncontrada(texto) {
  $('carregando').hidden = true;
  $('detalhe').hidden = true;
  const alvo = $('nao-encontrada');
  limpar(alvo);
  const vazio = estadoVazio({ titulo: 'OS não encontrada', texto });
  vazio.append(el('a', { classe: 'botao secundario', texto: '← Voltar para as ordens de serviço', attrs: { href: 'os.html' } }));
  alvo.append(vazio);
  alvo.hidden = false;
  $('trilha-atual').textContent = 'Não encontrada';
}

// Um item da lista de dados: rótulo (dt) em cima e valor (dd) embaixo
function dado(rotulo, valor, { mono = false, largo = false } = {}) {
  return el('div', { classe: largo ? 'largo' : '' }, [
    el('dt', { texto: rotulo }),
    el('dd', { classe: mono ? 'mono' : '', texto: valor ?? '—' }),
  ]);
}

function renderCabecalho() {
  document.title = `OS #${os.id} · Mini-CMMS`;
  $('trilha-atual').textContent = `OS #${os.id}`;
  $('os-numero').textContent = `OS #${os.id}`;
  $('os-equipamento').textContent = `${os.equipamento_tag} · ${os.equipamento_nome}`;

  const meta = $('os-meta');
  limpar(meta);
  meta.append(
    marcaStatus(os.status),
    el('span', { classe: 'separador', texto: '·', attrs: { 'aria-hidden': 'true' } }),
    el('span', { texto: 'Prioridade ' }), marcaPrioridade(os.prioridade),
    el('span', { classe: 'separador', texto: '·', attrs: { 'aria-hidden': 'true' } }),
    el('span', { texto: ROTULOS_TIPO[os.tipo] ?? os.tipo }),
  );
}

function renderAcoes() {
  const podeAssumir = usuario.perfil === 'TECNICO' && os.status === 'ABERTA';
  const fechavel = ['EM_ANDAMENTO', 'AGUARDANDO_PECA'].includes(os.status);
  const podeFechar = fechavel && (usuario.perfil === 'SUPERVISOR' || (usuario.perfil === 'TECNICO' && os.tecnico_id === usuario.id));
  $('botao-assumir').hidden = !podeAssumir;
  $('botao-fechar').hidden = !podeFechar;

  // explica por que não há botão, quando faz sentido
  const dica = $('dica-acao');
  let texto = '';
  if (fechavel && !podeFechar && usuario.perfil === 'TECNICO') texto = `Assumida por ${os.tecnico_nome}. Só ele(a) ou um supervisor pode fechar.`;
  else if (os.status === 'ABERTA' && usuario.perfil !== 'TECNICO') texto = 'Aguardando um técnico assumir.';
  else if (os.status === 'AGUARDANDO_PECA' && podeFechar) texto = 'Aguardando reposição de peça. Tente fechar após a entrada no estoque.';
  dica.textContent = texto;
  dica.hidden = !texto;
}

function renderDados() {
  $('os-descricao').textContent = os.descricao;
  const dados = $('os-dados');
  limpar(dados);
  dados.append(
    dado('Equipamento', `${os.equipamento_tag} — ${os.equipamento_nome}`),
    dado('Aberta por', os.aberta_por_nome),
    dado('Aberta em', formatarDataHora(os.aberta_em), { mono: true }),
    dado('Técnico', os.tecnico_nome),
    dado('Iniciada em', formatarDataHora(os.iniciada_em), { mono: true }),
    dado('Fechada em', formatarDataHora(os.fechada_em), { mono: true }),
  );

  const fechada = os.status === 'FECHADA';
  $('secao-fechamento').hidden = !fechada;
  if (fechada) {
    const f = $('os-fechamento');
    limpar(f);
    f.append(
      dado('Causa', os.causa),
      dado('Horas trabalhadas', os.horas === null ? null : `${Number(os.horas).toLocaleString('pt-BR')} h`, { mono: true }),
      dado('Solução', os.solucao, { largo: true }),
    );
  }
}

function renderPecas() {
  const alvo = $('os-pecas');
  limpar(alvo);
  if (!os.pecas.length) {
    alvo.append(el('p', { classe: 'texto-suave', texto: os.status === 'FECHADA' ? 'Nenhuma peça foi usada nesta OS.' : 'As peças são registradas no fechamento da OS.' }));
    return;
  }
  let total = 0;
  const linhas = os.pecas.map((p) => {
    const subtotal = p.qtd * Number(p.custo_unit);
    total += subtotal;
    return el('tr', {}, [
      el('td', {}, [el('span', { classe: 'tag-equip', texto: p.codigo })]),
      el('td', { texto: p.descricao }),
      el('td', { classe: 'numero mono', texto: p.qtd }),
      el('td', { classe: 'numero mono', texto: moeda.format(Number(p.custo_unit)) }),
      el('td', { classe: 'numero mono', texto: moeda.format(subtotal) }),
    ]);
  });
  alvo.append(el('div', { classe: 'tabela-rolagem' }, [el('table', { classe: 'tabela tabela-simples' }, [
    el('thead', {}, [el('tr', {}, ['Código', 'Descrição', 'Qtd', 'Custo unit.', 'Subtotal'].map((t, i) => el('th', { classe: i >= 2 ? 'numero' : '', texto: t, attrs: { scope: 'col' } })))]),
    el('tbody', {}, linhas),
    el('tfoot', {}, [el('tr', {}, [
      el('td', { texto: 'Total em peças', attrs: { colspan: 4 } }),
      el('td', { classe: 'numero mono', texto: moeda.format(total) }),
    ])]),
  ])]));
}

function renderHistorico() {
  const lista = $('os-historico');
  limpar(lista);
  // abertura (INSERT não passa pela trigger de auditoria; vem dos dados da OS)
  lista.append(el('li', {}, [
    marcaStatus('ABERTA'),
    el('span', { classe: 'quem', texto: `aberta por ${os.aberta_por_nome}` }),
    el('time', { classe: 'quando mono', texto: formatarDataHora(os.aberta_em), attrs: { datetime: os.aberta_em } }),
  ]));
  for (const a of os.auditoria) {
    lista.append(el('li', {}, [
      marcaStatus(a.status_para),
      el('span', { classe: 'quem', texto: `${ROTULOS_STATUS[a.status_de] ?? a.status_de} → ${ROTULOS_STATUS[a.status_para] ?? a.status_para} por ${a.usuario_nome ?? 'sistema'}` }),
      el('time', { classe: 'quando mono', texto: formatarDataHora(a.data), attrs: { datetime: a.data } }),
    ]));
  }
  if (!os.auditoria.length && os.status !== 'ABERTA') {
    lista.append(el('li', { classe: 'sem-registro' }, [
      el('span', { classe: 'quem', texto: 'Mudanças de status anteriores à auditoria não foram registradas (dados do seed).' }),
    ]));
  }
}

async function carregarOs() {
  os = await api.get(`/os/${osId}`);
  renderCabecalho();
  renderAcoes();
  renderDados();
  renderPecas();
  renderHistorico();
  $('carregando').hidden = true;
  $('detalhe').hidden = false;
}

function erroParaTela(alvo, erro, prefixo = '') {
  if (erro instanceof ErroApi) {
    mostrarMensagem(alvo, prefixo + erro.mensagem, 'erro', Array.isArray(erro.detalhes) ? erro.detalhes : null);
  } else {
    mostrarMensagem(alvo, `${prefixo}Erro inesperado: ${erro.message}`);
  }
}

// ---------------------------------------------------------------------------------
// Assumir
// ---------------------------------------------------------------------------------
$('botao-assumir').addEventListener('click', async () => {
  const botao = $('botao-assumir');
  botao.disabled = true;
  esconderMensagem(caixa);
  try {
    await api.post(`/os/${osId}/assumir`);
    await carregarOs();
    mostrarMensagem(caixa, `Você assumiu a OS #${osId}. Status: Em andamento.`, 'sucesso');
    if (!$('botao-fechar').hidden) $('botao-fechar').focus();
  } catch (erro) {
    erroParaTela(caixa, erro, 'Não foi possível assumir: ');
    if (erro instanceof ErroApi && erro.status === 409) await carregarOs(); // alguém assumiu antes
  } finally {
    botao.disabled = false;
  }
});

// ---------------------------------------------------------------------------------
// Fechar: drawer com lista de peças
// ---------------------------------------------------------------------------------
let contadorLinhas = 0;

function opcoesPecas() {
  return [
    el('option', { texto: 'Selecione a peça…', attrs: { value: '' } }),
    ...pecasEstoque.map((p) => el('option', {
      texto: `${p.codigo} — ${p.descricao} (estoque ${p.estoque})`,
      attrs: { value: p.id },
    })),
  ];
}

function adicionarLinhaPeca() {
  contadorLinhas += 1;
  const n = contadorLinhas;
  const select = el('select', { attrs: { id: `peca-${n}`, name: 'pecaId' } }, opcoesPecas());
  const qtd = el('input', { attrs: { id: `qtd-${n}`, name: 'qtd', type: 'number', min: 1, max: 1000, step: 1, value: 1, inputmode: 'numeric' } });
  const remover = el('button', { classe: 'botao secundario icone', texto: '×', attrs: { type: 'button', 'aria-label': 'Remover esta peça' } });
  const linha = el('div', { classe: 'linha-peca' }, [
    el('div', { classe: 'campo' }, [el('label', { classe: 'so-leitor-de-tela', texto: 'Peça', attrs: { for: `peca-${n}` } }), select]),
    el('div', { classe: 'campo campo-qtd' }, [el('label', { classe: 'so-leitor-de-tela', texto: 'Quantidade', attrs: { for: `qtd-${n}` } }), qtd]),
    remover,
  ]);
  remover.addEventListener('click', () => {
    linha.remove();
    $('botao-add-peca').focus();
  });
  listaPecas.append(linha);
  select.focus();
}

function limparMarcasDeErro() {
  for (const linha of listaPecas.querySelectorAll('.linha-peca')) {
    linha.classList.remove('invalida');
    for (const campo of linha.querySelectorAll('select, input')) campo.removeAttribute('aria-invalid');
  }
}

const drawerFechar = criarDrawer({
  drawer: $('drawer-fechar'),
  fundo: $('fundo-drawer'),
  botaoOrigem: $('botao-fechar'),
  primeiroCampo: $('fechar-causa'),
  aoFechar: () => {
    formFechar.reset();
    limpar(listaPecas);
    esconderMensagem(caixaFechar);
  },
});

$('botao-fechar').addEventListener('click', async () => {
  esconderMensagem(caixaFechar);
  try {
    pecasEstoque ??= await api.get('/pecas');
  } catch (erro) {
    erroParaTela(caixa, erro, 'Não foi possível carregar as peças: ');
    return;
  }
  drawerFechar.abrir();
});

$('botao-add-peca').addEventListener('click', async () => {
  try {
    pecasEstoque ??= await api.get('/pecas'); // recarrega após um 409 (estoque mudou)
    adicionarLinhaPeca();
  } catch (erro) {
    erroParaTela(caixaFechar, erro, 'Não foi possível carregar as peças: ');
  }
});

// Recarrega a OS depois de um erro no fechamento; se a recarga falhar, avisa na página.
async function recarregarAposErro() {
  try {
    await carregarOs();
  } catch (erro) {
    erroParaTela(caixa, erro, 'Não foi possível atualizar a OS: ');
  }
}

function lerFormulario() {
  const pecas = [...listaPecas.querySelectorAll('.linha-peca')].map((linha) => ({
    linha,
    pecaId: Number(linha.querySelector('select').value),
    qtd: Number(linha.querySelector('input').value),
  }));
  return {
    causa: formFechar.causa.value.trim(),
    solucao: formFechar.solucao.value.trim(),
    horas: Number(String(formFechar.horas.value).replace(',', '.')),
    pecas,
  };
}

function validar({ causa, solucao, horas, pecas }) {
  const problemas = [];
  if (causa.length < 2) problemas.push('Informe a causa da falha.');
  if (solucao.length < 5) problemas.push('Descreva a solução aplicada (mínimo de 5 caracteres).');
  if (!Number.isFinite(horas) || horas < 0.1 || horas > 999) problemas.push('Informe as horas trabalhadas (de 0,1 a 999).');
  const vistas = new Set();
  pecas.forEach((p, i) => {
    let invalida = false;
    if (!p.pecaId) { problemas.push(`Peça ${i + 1}: selecione a peça (ou remova a linha).`); invalida = true; }
    if (!Number.isInteger(p.qtd) || p.qtd < 1) { problemas.push(`Peça ${i + 1}: quantidade deve ser um inteiro maior que zero.`); invalida = true; }
    if (p.pecaId && vistas.has(p.pecaId)) { problemas.push(`Peça ${i + 1}: peça repetida. Some as quantidades numa linha só.`); invalida = true; }
    vistas.add(p.pecaId);
    if (invalida) p.linha.classList.add('invalida');
  });
  return problemas;
}

// 409 de estoque: mensagem clara + destaque na linha da peça que faltou
function mostrarFaltaDeEstoque(erro, pecas) {
  const d = erro.detalhes ?? {};
  mostrarMensagem(caixaFechar, `Estoque insuficiente de ${d.codigo}: você pediu ${d.solicitado}, há ${d.disponivel} em estoque.`, 'erro', [
    'Nada foi gravado: o estoque, as peças e o fechamento foram desfeitos (ROLLBACK).',
    'A OS foi colocada em "Aguardando peça". Após a reposição no estoque, feche novamente.',
  ]);
  const culpada = pecas.find((p) => p.pecaId === d.pecaId);
  if (culpada) {
    culpada.linha.classList.add('invalida');
    const qtd = culpada.linha.querySelector('input');
    qtd.setAttribute('aria-invalid', 'true');
    qtd.focus();
  }
  // atualiza o estoque mostrado nas opções
  pecasEstoque = null;
}

formFechar.addEventListener('submit', async (evento) => {
  evento.preventDefault();
  esconderMensagem(caixaFechar);
  limparMarcasDeErro();
  const dados = lerFormulario();
  const problemas = validar(dados);
  if (problemas.length) {
    mostrarMensagem(caixaFechar, 'Confira o fechamento:', 'erro', problemas);
    return;
  }

  const botao = $('botao-confirmar-fechar');
  botao.disabled = true;
  try {
    const corpo = { causa: dados.causa, solucao: dados.solucao, horas: dados.horas, pecas: dados.pecas.map(({ pecaId, qtd }) => ({ pecaId, qtd })) };
    const fechada = await api.post(`/os/${osId}/fechar`, corpo);
    drawerFechar.fechar();
    pecasEstoque = null; // o estoque mudou
    await carregarOs();
    const n = fechada.pecas.length;
    mostrarMensagem(caixa, `OS #${osId} fechada.${n ? ` ${n} peça(s) baixada(s) do estoque.` : ''}`, 'sucesso');
  } catch (erro) {
    if (erro instanceof ErroApi && erro.codigo === 'ESTOQUE_INSUFICIENTE') {
      mostrarFaltaDeEstoque(erro, dados.pecas);
      await recarregarAposErro(); // a OS agora está AGUARDANDO_PECA (atualiza a tela de trás)
    } else {
      erroParaTela(caixaFechar, erro, 'A OS não foi fechada: ');
      if (erro instanceof ErroApi && [403, 409].includes(erro.status)) await recarregarAposErro();
    }
  } finally {
    botao.disabled = false;
  }
});

// ---------------------------------------------------------------------------------
// Início
// ---------------------------------------------------------------------------------
if (osId === null) {
  mostrarNaoEncontrada('O endereço não tem um número de OS válido.');
} else {
  try {
    await carregarOs();
  } catch (erro) {
    if (erro instanceof ErroApi && erro.status === 404) mostrarNaoEncontrada(`Não existe OS com o número ${osId}.`);
    else {
      $('carregando').hidden = true;
      erroParaTela(caixa, erro, 'Não foi possível carregar a OS: ');
    }
  }
}
