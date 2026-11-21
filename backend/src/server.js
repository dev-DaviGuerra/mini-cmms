// Ponto de entrada: sobe o servidor HTTP.
import { app } from './app.js';
import { config } from './config.js';

app.listen(config.port, () => {
  console.log(`Mini-CMMS API ouvindo em http://localhost:${config.port}`);
});
