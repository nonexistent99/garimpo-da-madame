const fs = require('fs');
const path = require('path');

const root = __dirname;
const output = path.join(root, 'kwai-dist');
fs.rmSync(output, { recursive: true, force: true });
fs.cpSync(path.join(root, 'public'), output, { recursive: true });

for (const file of ['index.html', 'landing.js', 'analytics.js', 'kwai.css']) {
  fs.copyFileSync(path.join(root, 'kwai', file), path.join(output, file));
}

const kwaiAdminPath = path.join(output, 'admin.html');
fs.writeFileSync(
  kwaiAdminPath,
  fs.readFileSync(kwaiAdminPath, 'utf8').replace('data-dashboard-source="main"', 'data-dashboard-source="sunize"'),
);

for (const file of ['depoimento-cliente-01.mp4', 'depoimento-cliente-02.mp4', 'depoimento-cliente-03.mp4']) {
  fs.rmSync(path.join(output, 'assets', 'garimpo', file), { force: true });
}

fs.writeFileSync(path.join(output, '_redirects'), [
  '/api/* https://garimpo-api-production.up.railway.app/api/:splat 200!',
  '/admin /admin.html 200',
  '/consulta https://garimpo-da-madame.netlify.app/consulta 302!',
  '',
].join('\n'));

fs.writeFileSync(path.join(output, '_headers'), [
  '/*',
  '  X-Content-Type-Options: nosniff',
  '  Referrer-Policy: strict-origin-when-cross-origin',
  '  Permissions-Policy: camera=(), microphone=(), geolocation=()',
  '',
  '/assets/*',
  '  Cache-Control: public, max-age=31536000, immutable',
  '',
].join('\n'));

console.log(`Kwai build pronto em ${output}`);
