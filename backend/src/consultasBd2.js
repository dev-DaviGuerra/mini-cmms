// Carrega as consultas BD2 direto de database/04_consultas_bd2.sql, para que a API e o
// psql usem exatamente o MESMO SQL (uma única fonte da verdade).
//
// Formato esperado no arquivo:
//   -- @consulta <nome>
//   \echo '...'          <- comando do psql, ignorado aqui
//   SELECT ... ;         <- a consulta (uma por marcador)
import { readFileSync } from 'node:fs';

const ARQUIVO = new URL('../../database/04_consultas_bd2.sql', import.meta.url);
const MARCADOR = /^-- @consulta ([a-z0-9-]+)[ \t]*$/m;

// Separa o texto em { nome: sql }. Exportada para poder ser testada isoladamente.
export function separarConsultas(texto) {
  const partes = texto.split(MARCADOR); // [antes, nome1, corpo1, nome2, corpo2, ...]
  const consultas = {};

  for (let i = 1; i < partes.length; i += 2) {
    const nome = partes[i];
    const sql = partes[i + 1]
      .split(/\r?\n/)
      .filter((linha) => !linha.trimStart().startsWith('\\')) // remove \echo e outros comandos do psql
      .join('\n')
      .trim()
      .replace(/;\s*(--[^\n]*\s*)*$/, '');                    // tira o ; final (e comentários depois dele)

    if (!/^\s*(--[^\n]*\n\s*)*(SELECT|WITH)\b/i.test(sql)) {
      throw new Error(`Consulta "${nome}" em 04_consultas_bd2.sql não é um SELECT/WITH`);
    }
    if (consultas[nome]) throw new Error(`Consulta "${nome}" duplicada em 04_consultas_bd2.sql`);
    consultas[nome] = sql;
  }
  return consultas;
}

// Lido uma vez, quando a API sobe. Se o arquivo estiver mal formado, a API nem sobe.
export const CONSULTAS_BD2 = Object.freeze(separarConsultas(readFileSync(ARQUIVO, 'utf8')));
