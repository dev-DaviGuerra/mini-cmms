// Utilitários de interface. REGRA DE SEGURANÇA: dados vindos da API entram na página só por
// textContent (via el()), nunca por innerHTML. Assim um texto como "<img onerror=...>" gravado
// numa descrição de OS aparece como texto e não é executado (proteção contra XSS).
import { api, ErroApi, sair } from './api.js';

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

export const ROTULOS_PERFIL = Object.freeze({ OPERADOR: 'Operador', TECNICO: 'Técnico', SUPERVISOR: 'Supervisor' });

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

// Tooltips ⓘ (.info-dica > .botao-info + [role=tooltip]). O CSS mostra o texto no hover e no
// foco; aqui ficam o que o CSS não faz sozinho:
//   - Esc fecha o tooltip aberto sem tirar o foco do botão (WCAG 1.4.13);
//   - um toque/clique foca o botão (no Safari, clicar num botão não o foca), e o texto abre;
//   - ao abrir, o texto é deslocado na horizontal para não sair da janela (tela estreita).
// A classe dica-fechada sai quando o ponteiro deixa o bloco ou o foco vai para outro lugar.
const MARGEM_DICA = 8; // px até a borda da janela

function manterNaJanela(dica) {
  dica.style.setProperty('--dica-desloca', '0px'); // mede na posição original
  const { left, right } = dica.getBoundingClientRect();
  const limite = document.documentElement.clientWidth - MARGEM_DICA;
  let desloca = 0;
  if (right > limite) desloca = limite - right;
  if (left + desloca < MARGEM_DICA) desloca = MARGEM_DICA - left;
  dica.style.setProperty('--dica-desloca', `${Math.round(desloca)}px`);
}

export function ativarDicas(raiz = document) {
  const blocos = [...raiz.querySelectorAll('.info-dica')];
  for (const bloco of blocos) {
    const dica = bloco.querySelector('[role="tooltip"]');
    const abrir = () => { if (dica) manterNaJanela(dica); };
    const reabrir = () => bloco.classList.remove('dica-fechada');
    bloco.addEventListener('mouseenter', abrir);
    bloco.addEventListener('focusin', abrir);
    bloco.querySelector('.botao-info')?.addEventListener('click', (evento) => {
      evento.currentTarget.focus();
      reabrir();
    });
    bloco.addEventListener('mouseleave', reabrir);
    bloco.addEventListener('focusout', reabrir);
  }
  document.addEventListener('keydown', (evento) => {
    if (evento.key !== 'Escape') return;
    for (const bloco of blocos) {
      if (bloco.matches(':hover, :focus-within')) bloco.classList.add('dica-fechada');
    }
  });
}

// Drawer modal (painel lateral). Reaproveitado por todas as telas:
//   const d = criarDrawer({ drawer, fundo, botaoOrigem, primeiroCampo, aoFechar });
//   d.abrir();  d.fechar();  d.aberto()
// Fechado, o painel fica "inert" (fora do Tab e dos leitores de tela). Aberto: Esc fecha,
// o Tab fica preso dentro dele e, ao fechar, o foco volta para o botão que o abriu.
// Elementos com [data-fechar-drawer] dentro do drawer (e o fundo) fecham o painel.
export function criarDrawer({ drawer, fundo, botaoOrigem, primeiroCampo, aoFechar }) {
  let origem = botaoOrigem;

  function aberto() {
    return drawer.classList.contains('aberto');
  }

  function abrir(novaOrigem) {
    if (novaOrigem instanceof HTMLElement) origem = novaOrigem;
    drawer.inert = false;
    drawer.classList.add('aberto');
    fundo.classList.add('visivel');
    document.body.classList.add('drawer-aberto');
    (primeiroCampo ?? drawer.querySelector('select, input, textarea, button'))?.focus();
  }

  function fechar() {
    if (!aberto()) return;
    drawer.classList.remove('aberto');
    fundo.classList.remove('visivel');
    document.body.classList.remove('drawer-aberto');
    drawer.inert = true;
    aoFechar?.();
    origem?.focus();
  }

  for (const alvo of [...drawer.querySelectorAll('[data-fechar-drawer]'), fundo]) alvo.addEventListener('click', fechar);

  document.addEventListener('keydown', (evento) => {
    if (!aberto()) return;
    if (evento.key === 'Escape') {
      fechar();
      return;
    }
    if (evento.key === 'Tab') {
      const focaveis = [...drawer.querySelectorAll('button, select, textarea, input, a[href]')]
        .filter((e) => !e.disabled && e.offsetParent !== null);
      if (!focaveis.length) return;
      const primeiro = focaveis[0];
      const ultimo = focaveis.at(-1);
      if (evento.shiftKey && document.activeElement === primeiro) { evento.preventDefault(); ultimo.focus(); }
      else if (!evento.shiftKey && document.activeElement === ultimo) { evento.preventDefault(); primeiro.focus(); }
    }
  });

  return { abrir, fechar, aberto };
}

// ---------------------------------------------------------------------------------
// Avisos flutuantes (ex.: "Senha alterada"). role=status: o leitor de tela anuncia.
// ---------------------------------------------------------------------------------
export function avisar(texto, tipo = 'sucesso') {
  let pilha = document.getElementById('avisos');
  if (!pilha) {
    pilha = el('div', { classe: 'avisos', attrs: { id: 'avisos', role: 'status', 'aria-live': 'polite' } });
    document.body.append(pilha);
  }
  const aviso = el('div', { classe: `aviso aviso-${tipo}`, texto });
  pilha.append(aviso);
  setTimeout(() => aviso.remove(), 5000);
}

// Política de senha (a mesma da API). Só conforto: quem valida de verdade é a API.
export function problemasSenha(senha, rotulo = 'A senha') {
  const problemas = [];
  if (senha.length < 10) problemas.push(`${rotulo} deve ter pelo menos 10 caracteres.`);
  if (!/\p{L}/u.test(senha)) problemas.push(`${rotulo} deve ter pelo menos uma letra.`);
  if (!/\d/.test(senha)) problemas.push(`${rotulo} deve ter pelo menos um número.`);
  if (new TextEncoder().encode(senha).length > 72) problemas.push(`${rotulo} deve ter no máximo 72 bytes.`);
  return problemas;
}

export const TEXTO_POLITICA_SENHA = 'Mínimo de 10 caracteres, com pelo menos uma letra e um número.';

// ---------------------------------------------------------------------------------
// Menu lateral
// ---------------------------------------------------------------------------------
// Itens sem href aparecem desabilitados ("em breve"). "perfis" restringe quem vê o item
// (só conforto visual: a API também barra com 403).
const GRUPOS_MENU = [
  {
    titulo: 'Operação',
    itens: [
      { id: 'os', href: 'os.html', texto: 'Ordens de serviço' },
      { id: 'equipamentos', href: 'equipamentos.html', texto: 'Equipamentos' },
      { id: 'estoque', href: 'estoque.html', texto: 'Estoque' },
      { id: 'dashboard', href: 'dashboard.html', texto: 'Dashboard' },
    ],
  },
  {
    titulo: 'Administração',
    itens: [{ id: 'usuarios', href: 'usuarios.html', texto: 'Usuários', perfis: ['SUPERVISOR'] }],
  },
];

function itemMenu(item, paginaAtual) {
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
}

// Drawer "Trocar senha": criado por JS uma única vez, igual em todas as páginas.
function montarDrawerSenha(botaoOrigem) {
  const caixa = el('div', { attrs: { role: 'alert', hidden: '' } });
  const campo = (id, rotulo, autocomplete) => el('div', { classe: 'campo' }, [
    el('label', { texto: rotulo, attrs: { for: id } }),
    el('input', { attrs: { id, name: id, type: 'password', autocomplete, required: '', maxlength: 72 } }),
  ]);
  const form = el('form', { classe: 'drawer-form', attrs: { novalidate: '' } }, [
    el('div', { classe: 'drawer-cabecalho' }, [
      el('h2', { texto: 'Trocar senha', attrs: { id: 'titulo-senha' } }),
      el('button', { classe: 'botao secundario icone', texto: '×', attrs: { type: 'button', 'data-fechar-drawer': '', 'aria-label': 'Fechar painel' } }),
    ]),
    el('div', { classe: 'drawer-corpo' }, [
      caixa,
      campo('senha-atual', 'Senha atual', 'current-password'),
      campo('senha-nova', 'Nova senha', 'new-password'),
      campo('senha-confirmacao', 'Confirme a nova senha', 'new-password'),
      el('p', { classe: 'ajuda', texto: TEXTO_POLITICA_SENHA }),
    ]),
    el('div', { classe: 'drawer-rodape' }, [
      el('button', { classe: 'botao secundario', texto: 'Cancelar', attrs: { type: 'button', 'data-fechar-drawer': '' } }),
      el('button', { classe: 'botao primario', texto: 'Salvar nova senha', attrs: { type: 'submit' } }),
    ]),
  ]);
  const drawer = el('aside', {
    classe: 'drawer',
    attrs: { id: 'drawer-senha', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'titulo-senha', inert: '' },
  }, [form]);
  const fundo = el('div', { classe: 'fundo-drawer', attrs: { id: 'fundo-senha' } });
  document.body.append(drawer, fundo);

  const controle = criarDrawer({
    drawer,
    fundo,
    botaoOrigem,
    primeiroCampo: form.querySelector('#senha-atual'),
    aoFechar: () => { form.reset(); esconderMensagem(caixa); },
  });

  form.addEventListener('submit', async (evento) => {
    evento.preventDefault();
    esconderMensagem(caixa);
    const senhaAtual = form.querySelector('#senha-atual').value;
    const novaSenha = form.querySelector('#senha-nova').value;
    const confirmacao = form.querySelector('#senha-confirmacao').value;

    const problemas = [];
    if (!senhaAtual) problemas.push('Informe a senha atual.');
    problemas.push(...problemasSenha(novaSenha, 'A nova senha'));
    if (novaSenha !== confirmacao) problemas.push('A confirmação não é igual à nova senha.');
    if (problemas.length) {
      mostrarMensagem(caixa, 'Confira os campos:', 'erro', problemas);
      return;
    }

    const botao = form.querySelector('button[type="submit"]');
    botao.disabled = true;
    try {
      await api.post('/auth/senha', { senhaAtual, novaSenha });
      controle.fechar();
      avisar('Senha alterada com sucesso. Use a nova senha no próximo login.');
    } catch (erro) {
      const detalhes = erro instanceof ErroApi && Array.isArray(erro.detalhes) ? erro.detalhes : null;
      mostrarMensagem(caixa, erro instanceof ErroApi ? erro.mensagem : `Erro inesperado: ${erro.message}`, 'erro', detalhes);
    } finally {
      botao.disabled = false;
    }
  });

  return controle;
}

// Menu lateral: logo, navegação por grupos e, no rodapé, usuário + perfil + Trocar senha + Sair
export function montarLayout(usuario, paginaAtual) {
  const marca = el('a', { classe: 'menu-marca', attrs: { href: 'os.html' } }, [
    el('img', { attrs: { src: 'img/logo.svg', alt: '', width: 30, height: 30 } }),
    el('span', { texto: 'Mini-CMMS' }),
  ]);

  const grupos = [];
  GRUPOS_MENU.forEach((grupo, i) => {
    const itens = grupo.itens.filter((item) => !item.perfis || item.perfis.includes(usuario.perfil));
    if (!itens.length) return;
    const idTitulo = `titulo-menu-${i}`;
    grupos.push(
      el('p', { classe: 'menu-titulo', texto: grupo.titulo, attrs: { id: idTitulo } }),
      el('nav', { classe: 'menu-nav', attrs: { 'aria-labelledby': idTitulo } }, itens.map((item) => itemMenu(item, paginaAtual))),
    );
  });

  const botaoSenha = el('button', {
    classe: 'botao no-escuro',
    texto: 'Trocar senha',
    attrs: { type: 'button', id: 'botao-trocar-senha', 'aria-haspopup': 'dialog', 'aria-controls': 'drawer-senha' },
  });
  const botaoSair = el('button', { classe: 'botao no-escuro', texto: 'Sair', attrs: { type: 'button' } });
  botaoSair.addEventListener('click', () => sair('saiu'));

  const menu = document.getElementById('menu');
  limpar(menu);
  menu.append(
    marca,
    el('div', { classe: 'menu-faixa', attrs: { 'aria-hidden': 'true' } }),
    ...grupos,
    el('div', { classe: 'menu-rodape' }, [
      el('span', { classe: 'menu-usuario-nome', texto: usuario.nome }),
      el('span', { classe: 'menu-usuario-perfil', texto: ROTULOS_PERFIL[usuario.perfil] ?? usuario.perfil }),
      el('div', { classe: 'menu-acoes' }, [botaoSenha, botaoSair]),
    ]),
  );

  const drawerSenha = montarDrawerSenha(botaoSenha);
  botaoSenha.addEventListener('click', () => drawerSenha.abrir());
}
