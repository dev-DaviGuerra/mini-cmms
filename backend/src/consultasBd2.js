// Carrega as consultas BD2 direto de database/04_consultas_bd2.sql, para que a API e o
// psql usem exatamente o MESMO SQL (uma única fonte da verdade).
//
// Formato esperado no arquivo:
//   -- @consulta <nome>
//   \echo '...'          <- comando do psql, ignorado aqui
//   SELECT ... ;         <- a consulta (uma por marcador), termina na linha com ;
//
// O texto é processado LINHA A LINHA, só com operações simples de string (split, trim,
// startsWith, endsWith). Não há expressões regulares: assim não existe risco de ReDoS
// (backtracking catastrófico), apontado pelo SonarCloud (regra S5852) numa versão anterior.
import { readFileSync } from 'node:fs';

const ARQUIVO = new URL('../../database/04_consultas_bd2.sql', import.meta.url);
const PREFIXO_MARCADOR = '-- @consulta ';
const CARACTERES_NOME = 'abcdefghijklmnopqrstuvwxyz0123456789-';

function nomeValido(nome) {
  return nome.length > 0 && [...nome].every((c) => CARACTERES_NOME.includes(c));
}

function ehComentarioOuVazia(linha) {
  const t = linha.trim();
  return t === '' || t.startsWith('--');
}

// Recebe as linhas de UMA consulta (já sem o marcador e sem os comandos do psql) e devolve
// o SQL até o ; final, sem o ;. Valida que é um único SELECT/WITH.
function montarConsulta(nome, linhas) {
  const fim = linhas.findIndex((l) => l.trimEnd().endsWith(';'));
  if (fim < 0) throw new Error(`Consulta "${nome}" em 04_consultas_bd2.sql não termina com ;`);

  // depois do ; só podem vir comentários ou linhas vazias (ex.: o cabeçalho da próxima consulta)
  if (!linhas.slice(fim + 1).every(ehComentarioOuVazia)) {
    throw new Error(`Consulta "${nome}" em 04_consultas_bd2.sql tem mais de um comando`);
  }

  const corpo = linhas.slice(0, fim + 1);
  const ultima = corpo[fim].trimEnd();
  corpo[fim] = ultima.slice(0, -1); // remove o ;
  const sql = corpo.join('\n').trim();

  const primeira = (corpo.find((l) => !ehComentarioOuVazia(l)) ?? '').trim().toUpperCase();
  const comecaCom = (palavra) => primeira === palavra
    || primeira.startsWith(`${palavra} `) || primeira.startsWith(`${palavra}(`);
  if (!comecaCom('SELECT') && !comecaCom('WITH')) {
    throw new Error(`Consulta "${nome}" em 04_consultas_bd2.sql não é um SELECT/WITH`);
  }
  return sql;
}

// Separa o texto em { nome: sql }. Exportada para poder ser testada isoladamente.
export function separarConsultas(texto) {
  const consultas = {};
  let atual = null; // { nome, linhas }

  const concluir = () => {
    if (atual) consultas[atual.nome] = montarConsulta(atual.nome, atual.linhas);
  };

  for (const bruta of texto.split('\n')) {
    const linha = bruta.endsWith('\r') ? bruta.slice(0, -1) : bruta; // aceita CRLF (Windows)
    const t = linha.trim();

    if (t.startsWith(PREFIXO_MARCADOR)) {
      concluir();
      const nome = t.slice(PREFIXO_MARCADOR.length).trim();
      if (!nomeValido(nome)) throw new Error(`Nome de consulta inválido em 04_consultas_bd2.sql: "${nome}"`);
      if (consultas[nome]) throw new Error(`Consulta "${nome}" duplicada em 04_consultas_bd2.sql`);
      atual = { nome, linhas: [] };
    } else if (atual && !t.startsWith('\\')) {
      // linhas que começam com \ são comandos do psql (\echo etc.): ignoradas
      atual.linhas.push(linha);
    }
  }
  concluir();
  return consultas;
}

// Lido uma vez, quando a API sobe. Se o arquivo estiver mal formado, a API nem sobe.
export const CONSULTAS_BD2 = Object.freeze(separarConsultas(readFileSync(ARQUIVO, 'utf8')));
