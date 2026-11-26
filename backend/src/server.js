// Ponto de entrada: confere o papel do banco e sobe o servidor HTTP.
import { app } from './app.js';
import { config } from './config.js';
import { verificarPapelSemBypass } from './db.js';

// Multiempresa: se a API conectar com um papel que ignora a Row-Level Security (dono no
// Neon, superusuário), o isolamento entre empresas some sem nenhum erro aparente. Melhor
// não subir. No Render, o health check falha e a versão anterior continua no ar.
await verificarPapelSemBypass();

app.listen(config.port, () => {
  console.log(`MaintOS API ouvindo em http://localhost:${config.port}`);
});
