// Formulário público "Solicitar acesso". Quem valida de verdade é a API (400 com a lista
// de problemas); aqui só se evita mandar o que com certeza está incompleto.
// O campo "site" é a armadilha contra robôs: vai como está (vazio para pessoas).
import { api, ErroApi } from './api.js';
import { mostrarMensagem, esconderMensagem } from './ui.js';

const form = document.getElementById('form-solicitacao');
const caixa = document.getElementById('mensagem');
const botao = document.getElementById('botao-enviar');
const confirmacao = document.getElementById('confirmacao');

function lerFormulario() {
  const dados = Object.fromEntries(new FormData(form));
  return {
    empresa: dados.empresa ?? '',
    responsavel: dados.responsavel ?? '',
    email: dados.email ?? '',
    cidade: dados.cidade ?? '',
    uf: dados.uf ?? '',
    equipamentos: dados.equipamentos === '' ? '' : Number(dados.equipamentos),
    consentimento: form.consentimento.checked,
    site: dados.site ?? '',
  };
}

form.addEventListener('submit', async (evento) => {
  evento.preventDefault();
  esconderMensagem(caixa);

  const corpo = lerFormulario();
  const faltando = ['empresa', 'responsavel', 'email', 'cidade', 'uf', 'equipamentos']
    .filter((campo) => String(corpo[campo]).trim() === '');
  const problemas = faltando.length ? ['Preencha todos os campos obrigatórios.'] : [];
  if (!corpo.consentimento) problemas.push('Para enviar, aceite o aviso de privacidade.');
  if (problemas.length) {
    mostrarMensagem(caixa, 'Confira o formulário:', 'erro', problemas);
    (form.querySelector(`[name="${faltando[0] ?? 'consentimento'}"]`))?.focus();
    return;
  }

  botao.disabled = true;
  botao.textContent = 'Enviando…';
  try {
    const resposta = await api.post('/solicitacoes', corpo);
    form.hidden = true;
    document.getElementById('confirmacao-texto').textContent = resposta.mensagem;
    confirmacao.hidden = false;
    confirmacao.focus();
  } catch (erro) {
    const detalhes = erro instanceof ErroApi && Array.isArray(erro.detalhes) ? erro.detalhes : null;
    mostrarMensagem(caixa, erro instanceof ErroApi ? erro.mensagem : 'Não foi possível enviar agora. Tente de novo.', 'erro', detalhes);
  } finally {
    botao.disabled = false;
    botao.textContent = 'Enviar pedido';
  }
});
