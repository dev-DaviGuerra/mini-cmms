// Landing: botão "Copiar e-mail" (melhoria progressiva).
// Sem JavaScript, o e-mail continua visível e selecionável, e o botão fica escondido.
// A Clipboard API só existe em contexto seguro (HTTPS ou localhost) e pode ser negada pelo
// navegador; nesses casos o texto do e-mail fica selecionado para o Ctrl+C.

const botao = document.getElementById('copiar-email');
const endereco = document.getElementById('email-contato');
const aviso = document.getElementById('aviso-copia');
const TEMPO_AVISO_MS = 6000;
let temporizador;

function selecionarTexto(elemento) {
  const intervalo = document.createRange();
  intervalo.selectNodeContents(elemento);
  const selecao = globalThis.getSelection();
  selecao.removeAllRanges();
  selecao.addRange(intervalo);
}

// Esvazia e preenche de novo: assim o leitor de tela anuncia mesmo num segundo clique.
function avisar(texto) {
  clearTimeout(temporizador);
  aviso.textContent = '';
  temporizador = setTimeout(() => {
    aviso.textContent = texto;
    temporizador = setTimeout(() => { aviso.textContent = ''; }, TEMPO_AVISO_MS);
  }, 100);
}

async function copiarEmail() {
  const email = endereco.textContent.trim();
  try {
    if (!navigator.clipboard?.writeText) throw new Error('Clipboard API indisponível');
    await navigator.clipboard.writeText(email);
    avisar('E-mail copiado.');
  } catch {
    selecionarTexto(endereco);
    avisar('Não foi possível copiar automaticamente. O e-mail está selecionado: use Ctrl+C (⌘+C no Mac).');
  }
}

if (botao && endereco && aviso) {
  botao.hidden = false;
  botao.addEventListener('click', copiarEmail);
}
