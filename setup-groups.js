const http = require('http');

const groups = [
  { niche: 'Cozinha', platform: 'telegram', target_id: '@garimpodigitalprimehub' },
  { niche: 'Beleza feminina', platform: 'telegram', target_id: '@ofertasvaultbrasil247' },
  { niche: 'Eletrônicos', platform: 'telegram', target_id: '@primeachadosxbrasil' },
  { niche: 'Gamer', platform: 'telegram', target_id: '@descontosecretoshubbr' },
  { niche: 'Pet', platform: 'telegram', target_id: '@garimpoeliteoficialbr' },
  { niche: 'Leitura', platform: 'telegram', target_id: '@ofertasquanticasprime' },
  { niche: 'Academia_Fitness', platform: 'telegram', target_id: '@achadosblackvaultbr' },
  { niche: 'Mobile_Games', platform: 'telegram', target_id: '@primeimpulsodealsbr' }
];

async function setup() {
  for (const group of groups) {
    await new Promise((resolve) => {
      const req = http.request('http://localhost:3000/groups', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      }, (res) => {
        console.log(`Grupo ${group.niche} adicionado: ${res.statusCode}`);
        resolve();
      });
      req.write(JSON.stringify(group));
      req.end();
    });
  }

  // Agora dispara o bot para rodar os arquivos de teste
  const reqRun = http.request('http://localhost:3000/run-now', {
    method: 'POST'
  }, (res) => {
    console.log(`Processamento de ofertas iniciado: ${res.statusCode}`);
  });
  reqRun.end();
}

setup();
