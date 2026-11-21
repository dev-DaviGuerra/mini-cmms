// Equipamentos: resumo, lista com busca/filtro e cadastro em drawer (SUPERVISOR).
import { api, exigirLogin, ErroApi } from './api.js';
import {
  el, limpar, montarLayout, criarDrawer, mostrarMensagem, esconderMensagem, estadoVazio,
  linhasSkeleton, avisar, preencherSelect,
} from './ui.js';

const usuario = await exigirLogin();
montarLayout(usuario, 'equipamentos');

const $ = (id) => document.getElementById(id);
const caixa = $('mensagem');
const linhas = $('linhas');
const filtros = $('filtros');
const ehSupervisor = usuario.perfil === 'SUPERVISOR';
const ROTULO_CRITICIDADE = { A: 'A — crítica', B: 'B — importante', C: 'C — baixa' };

let equipamentos = [];

function erroParaTela(alvo, erro, prefixo = '') {
  if (erro instanceof ErroApi) {
    mostrarMensagem(alvo, prefixo + erro.mensagem, 'erro', Array.isArray(erro.detalhes) ? erro.detalhes : null);
  } else {
    mostrarMensagem(alvo, `${prefixo}Erro inesperado: ${erro.message}`);
  }
}

// ---- lista --------------------------------------------------------------------------
function marcaEquipamento(status) {
  return el('span', { classe: `status ${status === 'PARADO' ? 'parado' : 'operando'}`, texto: status === 'PARADO' ? 'Parado' : 'Operando' });
}

function celulaPendentes(e) {
  if (!e.os_pendentes) return el('td', { classe: 'numero mono texto-suave', texto: '0' });
  // leva à lista de OS já filtrada por este equipamento
  return el('td', { classe: 'numero' }, [el('a', {
    classe: 'mono link-pendentes',
    texto: `${e.os_pendentes} OS`,
    attrs: { href: `os.html?equipamentoId=${encodeURIComponent(e.id)}`, title: `Ver as OS de ${e.tag}` },
  })]);
}

function linhaEquipamento(e) {
  return el('tr', { classe: e.status === 'PARADO' ? 'equip-parado' : '' }, [
    el('td', {}, [el('span', { classe: 'tag-equip', texto: e.tag })]),
    el('td', { texto: e.nome }),
    el('td', { texto: e.linha }),
    el('td', {}, [el('span', { classe: `criticidade criticidade-${e.criticidade.toLowerCase()}`, texto: ROTULO_CRITICIDADE[e.criticidade] ?? e.criticidade })]),
    el('td', {}, [marcaEquipamento(e.status)]),
    celulaPendentes(e),
  ]);
}

function filtrar() {
  const busca = filtros.busca.value.trim().toLowerCase();
  const status = filtros.status.value;
  return equipamentos.filter((e) => (!status || e.status === status)
    && (!busca || `${e.tag} ${e.nome} ${e.linha}`.toLowerCase().includes(busca)));
}

function renderizar() {
  const visiveis = filtrar();
  limpar(linhas);
  if (!visiveis.length) {
    const vazio = equipamentos.length
      ? estadoVazio({ titulo: 'Nenhum equipamento encontrado', texto: 'Nenhum equipamento corresponde à busca.', acao: { texto: 'Limpar busca', aoClicar: () => { filtros.reset(); renderizar(); } } })
      : estadoVazio({ titulo: 'Nenhum equipamento cadastrado', texto: 'Cadastre o primeiro equipamento da fábrica.' });
    linhas.append(el('tr', {}, [el('td', { attrs: { colspan: 6 } }, [vazio])]));
  }
  for (const e of visiveis) linhas.append(linhaEquipamento(e));
  $('contagem').textContent = `${visiveis.length} de ${equipamentos.length} equipamentos`;
}

function renderizarResumo() {
  const parados = equipamentos.filter((e) => e.status === 'PARADO').length;
  $('resumo-total').textContent = equipamentos.length;
  $('resumo-operando').textContent = equipamentos.length - parados;
  $('resumo-parados').textContent = parados;
  $('card-parados').classList.toggle('ativo', parados > 0);
}

async function carregar() {
  limpar(linhas);
  linhas.append(...linhasSkeleton(6, [{ tamanho: 'curto' }, { tamanho: 'longo' }, { tamanho: 'medio' }, { tamanho: 'medio' }, { tamanho: 'medio' }, { tamanho: 'curto' }]));
  linhas.setAttribute('aria-busy', 'true');
  try {
    equipamentos = await api.get('/equipamentos');
    renderizarResumo();
    renderizar();
    // sugestões de linha de produção no cadastro
    const lista = $('linhas-existentes');
    limpar(lista);
    // localeCompare em pt-BR: ordena acentos corretamente ("Usinagem" depois de "Estamparia")
    const nomesLinhas = [...new Set(equipamentos.map((e) => e.linha))].sort((a, b) => a.localeCompare(b, 'pt-BR'));
    preencherSelect(lista, nomesLinhas.map((l) => [l, l]));
  } catch (erro) {
    limpar(linhas);
    erroParaTela(caixa, erro, 'Não foi possível carregar os equipamentos: ');
  } finally {
    linhas.removeAttribute('aria-busy');
  }
}

filtros.addEventListener('input', renderizar);
filtros.addEventListener('submit', (e) => e.preventDefault());

// ---- cadastro (SUPERVISOR) ---------------------------------------------------------
const form = $('form-equipamento');
const caixaForm = $('mensagem-equipamento');
const drawer = criarDrawer({
  drawer: $('drawer-equipamento'),
  fundo: $('fundo-drawer'),
  botaoOrigem: $('botao-novo'),
  primeiroCampo: $('equip-tag'),
  aoFechar: () => { form.reset(); esconderMensagem(caixaForm); },
});

$('botao-novo').hidden = !ehSupervisor;
$('botao-novo').addEventListener('click', () => drawer.abrir());

form.addEventListener('submit', async (evento) => {
  evento.preventDefault();
  esconderMensagem(caixaForm);
  const dados = {
    tag: form.tag.value.trim(),
    nome: form.nome.value.trim(),
    linha: form.linha.value.trim(),
    criticidade: form.criticidade.value,
  };
  const problemas = [];
  if (dados.tag.length < 2) problemas.push('Informe a tag (mínimo de 2 caracteres).');
  if (dados.nome.length < 3) problemas.push('Informe o nome (mínimo de 3 caracteres).');
  if (dados.linha.length < 2) problemas.push('Informe a linha de produção.');
  if (!dados.criticidade) problemas.push('Selecione a criticidade.');
  if (problemas.length) {
    mostrarMensagem(caixaForm, 'Confira os campos:', 'erro', problemas);
    return;
  }

  const botao = form.querySelector('button[type="submit"]');
  botao.disabled = true;
  try {
    const criado = await api.post('/equipamentos', dados);
    drawer.fechar();
    avisar(`Equipamento ${criado.tag} cadastrado (status: Operando).`);
    await carregar();
  } catch (erro) {
    erroParaTela(caixaForm, erro, 'O equipamento não foi cadastrado: ');
  } finally {
    botao.disabled = false;
  }
});

await carregar();
