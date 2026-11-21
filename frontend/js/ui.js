// Utilitários de interface. REGRA DE SEGURANÇA: dados vindos da API entram na página só por
// textContent (via el()), nunca por innerHTML. Assim um texto como "<img onerror=...>" gravado
// numa descrição de OS aparece como texto e não é executado (proteção contra XSS).
import { sair } from './api.js';

export function el(tag, opcoes = {}, filhos = []) {
  const elemento = document.createElement(tag);
  if (opcoes.classe) elemento.className = opcoes.classe;
  if (opcoes.texto !== undefined && opcoes.texto !== null) elemento.textContent = String(opcoes.texto);
  for (const [nome, valor] of Object.entries(opcoes.attrs ?? {})) elemento.setAttribute(nome, String(valor));
  for (const filho of filhos) if (filho) elemento.append(filho);
  return elemento;
}

export function limpar(elemento) {
  elemento.replaceChildren();
}

export const ROTULOS_STATUS = Object.freeze({
  ABERTA: 'Aberta',
  EM_ANDAMENTO: 'Em andamento',
  AGUARDANDO_PECA: 'Aguardando peça',
  FECHADA: 'Fechada',
  CANCELADA: 'Cancelada',
});

export const ROTULOS_PRIORIDADE = Object.freeze({
  BAIXA: 'Baixa',
  MEDIA: 'Média',
  ALTA: 'Alta',
  EMERGENCIA: 'Emergência',
});

export const ROTULOS_TIPO = Object.freeze({ CORRETIVA: 'Corretiva', PREVENTIVA: 'Preventiva' });

const ROTULOS_PERFIL = Object.freeze({ OPERADOR: 'Operador', TECNICO: 'Técnico', SUPERVISOR: 'Supervisor' });

// 'AGUARDANDO_PECA' -> 'aguardando-peca' (nome de classe CSS)
export const classeDe = (valor) => String(valor).toLowerCase().replaceAll('_', '-');

// Status em semáforo: ponto colorido (CSS) + texto. A cor nunca é a única informação.
export function marcaStatus(status) {
  return el('span', { classe: `status ${classeDe(status)}`, texto: ROTULOS_STATUS[status] ?? status });
}

export function marcaPrioridade(prioridade) {
  return el('span', { classe: `prioridade ${classeDe(prioridade)}`, texto: ROTULOS_PRIORIDADE[prioridade] ?? prioridade });
}

export function formatarDataHora(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
}

// Versão compacta para tabelas: 21/11/26 13:17
export function formatarDataHoraCurta(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('pt-BR', {
    day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit',
  }).replace(',', '');
}

// Preenche um <select> com pares [valor, rótulo], mantendo as opções que já existem
export function preencherSelect(select, pares) {
  for (const [valor, rotulo] of pares) select.append(el('option', { texto: rotulo, attrs: { value: valor } }));
}

// Caixa de mensagem (erro/sucesso/aviso/info). detalhes: lista de textos
export function mostrarMensagem(caixa, texto, tipo = 'erro', detalhes = null) {
  limpar(caixa);
  caixa.className = `alerta alerta-${tipo}`;
  caixa.append(el('strong', { texto }));
  if (Array.isArray(detalhes) && detalhes.length) {
    caixa.append(el('ul', {}, detalhes.map((d) => el('li', { texto: d }))));
  }
  caixa.hidden = false;
}

export function esconderMensagem(caixa) {
  caixa.hidden = true;
  limpar(caixa);
}

// Linhas "fantasma" enquanto a tabela carrega. larguras: classes de .skeleton por coluna
export function linhasSkeleton(quantidade, larguras) {
  return Array.from({ length: quantidade }, () => el('tr', { attrs: { 'aria-hidden': 'true' } },
    larguras.map((largura) => el('td', { classe: largura.coluna ?? '' }, [el('span', { classe: `skeleton ${largura.tamanho}` })]))));
}

// Bloco de "nada encontrado", com uma ação opcional
export function estadoVazio({ titulo, texto, acao }) {
  const filhos = [
    el('span', { classe: 'estado-vazio-icone', attrs: { 'aria-hidden': 'true' } }),
    el('h2', { texto: titulo }),
    el('p', { texto }),
  ];
  if (acao) {
    const botao = el('button', { classe: 'botao secundario', texto: acao.texto, attrs: { type: 'button' } });
    botao.addEventListener('click', acao.aoClicar);
    filhos.push(botao);
  }
  return el('div', { classe: 'estado-vazio' }, filhos);
}

// Navegação do menu lateral. Telas ainda não feitas aparecem desabilitadas.
const ITENS_MENU = [
  { id: 'os', href: 'os.html', texto: 'Ordens de serviço' },
  { id: 'equipamentos', texto: 'Equipamentos' },
  { id: 'estoque', texto: 'Estoque' },
  { id: 'dashboard', texto: 'Dashboard' },
];

// Menu lateral: logo, navegação e, no rodapé, usuário + perfil + Sair
export function montarLayout(usuario, paginaAtual) {
  const marca = el('a', { classe: 'menu-marca', attrs: { href: 'os.html' } }, [
    el('img', { attrs: { src: 'img/logo.svg', alt: '', width: 30, height: 30 } }),
    el('span', { texto: 'Mini-CMMS' }),
  ]);

  const itens = ITENS_MENU.map((item) => {
    if (!item.href) {
      return el('span', { classe: 'menu-item desabilitado', attrs: { 'aria-disabled': 'true' } }, [
        el('span', { texto: item.texto }),
        el('span', { classe: 'em-breve', texto: 'em breve' }),
      ]);
    }
    const ativo = item.id === paginaAtual;
    return el('a', {
      classe: `menu-item${ativo ? ' ativo' : ''}`,
      attrs: { href: item.href, ...(ativo ? { 'aria-current': 'page' } : {}) },
    }, [el('span', { texto: item.texto })]);
  });

  const botaoSair = el('button', { classe: 'botao no-escuro', texto: 'Sair', attrs: { type: 'button' } });
  botaoSair.addEventListener('click', () => sair('saiu'));

  const menu = document.getElementById('menu');
  limpar(menu);
  menu.append(
    marca,
    el('div', { classe: 'menu-faixa', attrs: { 'aria-hidden': 'true' } }),
    el('p', { classe: 'menu-titulo', texto: 'Operação', attrs: { id: 'titulo-menu' } }),
    el('nav', { classe: 'menu-nav', attrs: { 'aria-labelledby': 'titulo-menu' } }, itens),
    el('div', { classe: 'menu-rodape' }, [
      el('span', { classe: 'menu-usuario-nome', texto: usuario.nome }),
      el('span', { classe: 'menu-usuario-perfil', texto: ROTULOS_PERFIL[usuario.perfil] ?? usuario.perfil }),
      botaoSair,
    ]),
  );
}
