// Estoque: peças com destaque abaixo do mínimo; para o SUPERVISOR, alertas pendentes e
// "Entrada de estoque" em drawer (POST /api/pecas/:id/entrada -> CALL sp_entrada_estoque).
import { api, exigirLogin, ErroApi } from './api.js';
import {
  el, limpar, montarLayout, criarDrawer, mostrarMensagem, esconderMensagem, estadoVazio,
  linhasSkeleton, avisar, formatarDataHora,
} from './ui.js';

const usuario = await exigirLogin();
montarLayout(usuario, 'estoque');

const $ = (id) => document.getElementById(id);
const caixa = $('mensagem');
const linhas = $('linhas');
const filtros = $('filtros');
const ehSupervisor = usuario.perfil === 'SUPERVISOR';
const moeda = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const encurtar = (texto, max) => (texto.length > max ? `${texto.slice(0, max - 1)}…` : texto);

let pecas = [];

function erroParaTela(alvo, erro, prefixo = '') {
  if (erro instanceof ErroApi) {
    mostrarMensagem(alvo, prefixo + erro.mensagem, 'erro', Array.isArray(erro.detalhes) ? erro.detalhes : null);
  } else {
    mostrarMensagem(alvo, `${prefixo}Erro inesperado: ${erro.message}`);
  }
}

// ---- lista --------------------------------------------------------------------------
function marcaSituacao(p) {
  return p.abaixo_minimo
    ? el('span', { classe: 'status critico', texto: 'Abaixo do mínimo' })
    : el('span', { classe: 'status ativo', texto: 'OK' });
}

function linhaPeca(p) {
  const celulas = [
    el('td', {}, [el('span', { classe: 'tag-equip', texto: p.codigo })]),
    el('td', { texto: p.descricao }),
    el('td', { classe: 'numero mono valor-estoque', texto: p.estoque }),
    el('td', { classe: 'numero mono texto-suave', texto: p.estoque_min }),
    el('td', {}, [marcaSituacao(p)]),
    el('td', { classe: 'numero mono', texto: moeda.format(Number(p.custo_unit)) }),
  ];
  if (ehSupervisor) {
    const botao = el('button', {
      classe: 'botao secundario',
      texto: 'Entrada',
      attrs: { type: 'button', 'aria-label': `Dar entrada em ${p.codigo}` },
    });
    botao.addEventListener('click', () => abrirEntrada(p.id, botao));
    celulas.push(el('td', { classe: 'numero' }, [botao]));
  }
  return el('tr', { classe: p.abaixo_minimo ? 'abaixo-minimo' : '' }, celulas);
}

function filtrar() {
  const busca = filtros.busca.value.trim().toLowerCase();
  const soAbaixo = filtros.abaixo.checked;
  return pecas
    .filter((p) => (!soAbaixo || p.abaixo_minimo)
      && (!busca || `${p.codigo} ${p.descricao}`.toLowerCase().includes(busca)))
    // as que precisam de reposição primeiro; depois por código (ordem da API)
    .sort((a, b) => Number(b.abaixo_minimo) - Number(a.abaixo_minimo));
}

function renderizar() {
  const visiveis = filtrar();
  const colunas = ehSupervisor ? 7 : 6;
  limpar(linhas);
  if (!visiveis.length) {
    const vazio = pecas.length
      ? estadoVazio({ titulo: 'Nenhuma peça encontrada', texto: 'Nenhuma peça corresponde à busca.', acao: { texto: 'Limpar busca', aoClicar: () => { filtros.reset(); renderizar(); } } })
      : estadoVazio({ titulo: 'Nenhuma peça cadastrada', texto: 'As peças cadastradas aparecem aqui.' });
    linhas.append(el('tr', {}, [el('td', { attrs: { colspan: colunas } }, [vazio])]));
  }
  for (const p of visiveis) linhas.append(linhaPeca(p));
  $('contagem').textContent = `${visiveis.length} de ${pecas.length} peças`;
}

function renderizarResumo() {
  const abaixo = pecas.filter((p) => p.abaixo_minimo).length;
  const valor = pecas.reduce((soma, p) => soma + p.estoque * Number(p.custo_unit), 0);
  $('resumo-total').textContent = pecas.length;
  $('resumo-abaixo').textContent = abaixo;
  $('resumo-valor').textContent = moeda.format(valor);
  $('card-abaixo').classList.toggle('ativo', abaixo > 0);
}

// ---- alertas pendentes (só SUPERVISOR: a API responde 403 para os outros) -------------
async function carregarAlertas() {
  const lista = $('lista-alertas');
  const alertas = await api.get('/alertas');
  limpar(lista);
  $('secao-alertas').hidden = false;
  $('secao-alertas').classList.toggle('com-alertas', alertas.length > 0);
  if (!alertas.length) {
    lista.append(el('li', { classe: 'sem-alertas', texto: 'Nenhum alerta pendente. Todas as peças estão acima do mínimo.' }));
    return;
  }
  for (const a of alertas) {
    const botao = el('button', { classe: 'botao secundario', texto: 'Dar entrada', attrs: { type: 'button', 'aria-label': `Dar entrada em ${a.codigo}` } });
    botao.addEventListener('click', () => abrirEntrada(a.peca_id, botao));
    lista.append(el('li', {}, [
      el('span', { classe: 'status critico', texto: a.codigo }),
      el('span', { classe: 'alerta-descricao', texto: a.descricao }),
      el('span', { classe: 'alerta-numeros mono', texto: `estoque ${a.estoque} / mínimo ${a.estoque_min}` }),
      el('time', { classe: 'alerta-quando mono', texto: `desde ${formatarDataHora(a.criado_em)}`, attrs: { datetime: a.criado_em } }),
      botao,
    ]));
  }
}

async function carregar() {
  limpar(linhas);
  linhas.append(...linhasSkeleton(8, [{ tamanho: 'curto' }, { tamanho: 'longo' }, { tamanho: 'curto' }, { tamanho: 'curto' }, { tamanho: 'medio' }, { tamanho: 'curto' }]));
  linhas.setAttribute('aria-busy', 'true');
  try {
    const [lista] = await Promise.all([api.get('/pecas'), ehSupervisor ? carregarAlertas() : null]);
    pecas = lista;
    renderizarResumo();
    renderizar();
    preencherOpcoes();
  } catch (erro) {
    limpar(linhas);
    erroParaTela(caixa, erro, 'Não foi possível carregar o estoque: ');
  } finally {
    linhas.removeAttribute('aria-busy');
  }
}

filtros.addEventListener('input', renderizar);
filtros.addEventListener('change', renderizar);
filtros.addEventListener('submit', (e) => e.preventDefault());

// ---- entrada de estoque (SUPERVISOR) -----------------------------------------------
const form = $('form-entrada');
const caixaForm = $('mensagem-entrada');
const seletor = $('entrada-peca');
const drawer = criarDrawer({
  drawer: $('drawer-entrada'),
  fundo: $('fundo-drawer'),
  botaoOrigem: $('botao-entrada'),
  aoFechar: () => { form.reset(); esconderMensagem(caixaForm); $('entrada-situacao').hidden = true; },
});

function preencherOpcoes() {
  const atual = seletor.value;
  seletor.length = 1;
  for (const p of pecas) {
    seletor.append(el('option', {
      texto: `${p.codigo} · estoque ${p.estoque} · ${encurtar(p.descricao, 22)}`,
      attrs: { value: p.id, title: `${p.codigo} — ${p.descricao}` },
    }));
  }
  seletor.value = atual;
}

function mostrarSituacao() {
  const p = pecas.find((x) => String(x.id) === seletor.value);
  const alvo = $('entrada-situacao');
  limpar(alvo);
  alvo.hidden = !p;
  if (!p) return;
  const falta = p.estoque_min - p.estoque;
  alvo.className = `situacao-peca${p.abaixo_minimo ? ' abaixo' : ''}`;
  alvo.append(
    el('strong', { texto: p.descricao }),
    el('span', { classe: 'mono', texto: `Estoque atual ${p.estoque} · mínimo ${p.estoque_min}` }),
    el('span', { texto: falta > 0 ? `Faltam ${falta} para voltar ao mínimo.` : 'Acima do mínimo.' }),
  );
}

seletor.addEventListener('change', mostrarSituacao);

// origem: o botão que abriu o drawer (o foco volta para ele ao fechar)
function abrirEntrada(pecaId, origem) {
  esconderMensagem(caixaForm);
  seletor.value = pecaId ? String(pecaId) : '';
  mostrarSituacao();
  drawer.abrir(origem);
  if (pecaId) $('entrada-qtd').focus();
}

$('botao-entrada').hidden = !ehSupervisor;
$('cabecalho-acao').hidden = !ehSupervisor;
$('botao-entrada').addEventListener('click', () => abrirEntrada(null, $('botao-entrada')));

form.addEventListener('submit', async (evento) => {
  evento.preventDefault();
  esconderMensagem(caixaForm);
  const pecaId = Number(seletor.value);
  const qtd = Number(form.qtd.value);
  const problemas = [];
  if (!pecaId) problemas.push('Selecione a peça.');
  if (!Number.isInteger(qtd) || qtd < 1 || qtd > 100000) problemas.push('Informe uma quantidade inteira de 1 a 100.000.');
  if (problemas.length) {
    mostrarMensagem(caixaForm, 'Confira os campos:', 'erro', problemas);
    return;
  }

  const botao = form.querySelector('button[type="submit"]');
  botao.disabled = true;
  try {
    const { peca, alertasResolvidos } = await api.post(`/pecas/${pecaId}/entrada`, { qtd });
    drawer.fechar();
    const resolvidos = alertasResolvidos ? ` ${alertasResolvidos} alerta(s) resolvido(s).` : '';
    avisar(`Entrada de ${qtd} un. em ${peca.codigo}. Estoque agora: ${peca.estoque}.${resolvidos}`);
    await carregar();
  } catch (erro) {
    erroParaTela(caixaForm, erro, 'A entrada não foi registrada: ');
  } finally {
    botao.disabled = false;
  }
});

await carregar();
