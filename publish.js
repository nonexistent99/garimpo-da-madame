const axios = require('axios');
const git = require('isomorphic-git');
const fs = require('fs');
const path = require('path');
const http = require('isomorphic-git/http/node');

const TOKEN = process.env.GITHUB_TOKEN;
const USERNAME = process.env.GITHUB_OWNER;
const REPO = process.env.GITHUB_REPO || 'garimpo-da-madame';
const REPO_URL = `https://github.com/${USERNAME}/${REPO}`;

// Função recursiva para obter todos os arquivos do projeto
function getAllFiles(dir, baseDir = dir) {
  const results = [];
  const list = fs.readdirSync(dir);
  
  for (const file of list) {
    const filePath = path.join(dir, file);
    const stat = fs.statSync(filePath);
    
    // Filtros de segurança e ignorados
    if (
      file === 'node_modules' || 
      file === '.git' || 
      file === '.wwebjs_auth' || 
      file === 'data' || 
      file === '.env' ||
      file === 'test-github-temp.js'
    ) {
      continue;
    }
    
    if (stat.isDirectory()) {
      results.push(...getAllFiles(filePath, baseDir));
    } else {
      const relativePath = path.relative(baseDir, filePath).replace(/\\/g, '/');
      results.push(relativePath);
    }
  }
  
  return results;
}

async function startPublishing() {
  if (!TOKEN || !USERNAME) throw new Error('Defina GITHUB_TOKEN e GITHUB_OWNER no ambiente. Nunca grave credenciais neste arquivo.');
  console.log('🚀 === INICIANDO PIPELINE DE PUBLICAÇÃO NO GITHUB ===\n');

  try {
    // 1. Verificar/Criar Repositório no GitHub
    console.log(`[GitHub API] 🔍 Verificando se o repositório "${REPO}" já existe na conta "${USERNAME}"...`);
    
    let repoExists = false;
    try {
      await axios.get(`https://api.github.com/repos/${USERNAME}/${REPO}`, {
        headers: {
          Authorization: `token ${TOKEN}`,
          Accept: 'application/vnd.github.v3+json',
          'User-Agent': 'NodeJS-Publisher'
        }
      });
      repoExists = true;
      console.log(`[GitHub API] ℹ️ Repositório "${REPO}" já existe no GitHub.`);
    } catch (e) {
      if (e.response && e.response.status === 404) {
        console.log(`[GitHub API] 🆕 Repositório não encontrado. Criando repositório privado "${REPO}" no GitHub...`);
        await axios.post('https://api.github.com/user/repos', {
          name: REPO,
          private: true,
          description: 'Sistema autônomo para automação e roteamento de ofertas da Amazon'
        }, {
          headers: {
            Authorization: `token ${TOKEN}`,
            Accept: 'application/vnd.github.v3+json',
            'User-Agent': 'NodeJS-Publisher'
          }
        });
        console.log('[GitHub API] ✅ Repositório privado criado com sucesso absoluto!');
      } else {
        throw e;
      }
    }

    // 2. Inicializar Git local
    const gitDir = path.join(__dirname, '.git');
    if (!fs.existsSync(gitDir)) {
      console.log('[Git Local] 🛠️  Inicializando novo repositório Git local...');
      await git.init({ fs, dir: __dirname });
      console.log('[Git Local] ✅ Repositório Git inicializado.');
    } else {
      console.log('[Git Local] ℹ️ Repositório Git já inicializado localmente.');
    }

    // 3. Obter todos os arquivos válidos do projeto
    console.log('[Git Local] 📂 Escaneando arquivos do projeto...');
    const files = getAllFiles(__dirname);
    console.log(`[Git Local] Encontrados ${files.length} arquivos válidos para versionamento.`);

    // 4. Indexar (Add) todos os arquivos
    console.log('[Git Local] ➕ Indexando arquivos no Git (Staging)...');
    for (const filepath of files) {
      await git.add({ fs, dir: __dirname, filepath });
    }
    console.log('[Git Local] ✅ Todos os arquivos indexados com sucesso.');

    // 5. Commit
    console.log('[Git Local] ✍️ Criando commit com as estabilizações do sistema...');
    const commitSha = await git.commit({
      fs,
      dir: __dirname,
      ref: 'refs/heads/main',
      author: {
        name: USERNAME,
        email: `${USERNAME}@users.noreply.github.com`
      },
      message: 'Estabilização estrutural do Bot de Ofertas e Dockerização Easypanel'
    });
    console.log(`[Git Local] ✅ Commit criado! SHA: ${commitSha}`);

    // 6. Push para o GitHub
    console.log(`[Git Push] 📤 Enviando arquivos para o GitHub em "${REPO_URL}" (Branch: main)...`);
    await git.push({
      fs,
      http,
      dir: __dirname,
      ref: 'main',
      url: `https://${USERNAME}:${TOKEN}@github.com/${USERNAME}/${REPO}.git`,
      force: true,
      onAuth: () => ({ username: TOKEN })
    });

    console.log('\n🎉 === SUCESSO ABSOLUTO! PROJETO PUBLICADO NO GITHUB! ===');
    console.log(`🔗 Link do Repositório: ${REPO_URL}\n`);
    process.exit(0);

  } catch (err) {
    console.error('\n❌ Erro crítico no pipeline de publicação:', err.response ? err.response.data : err.message);
    process.exit(1);
  }
}

startPublishing();
