# Offers Workspace

## Garimpo da Madame — etapa comercial

A página pública está em `http://localhost:3000/` e o painel protegido em
`http://localhost:3000/admin`. O acesso vendido é um pagamento único para um
grupo privado. O preço começa vazio e as vendas pausadas: configure ambos no
painel antes de abrir o checkout.

### Segredos e integrações

Copie `.env.example` para `.env`. Segredos ficam somente no ambiente e nunca no
banco ou frontend.

- `APP_SECRET`: ao menos 32 caracteres; cifra e indexa de forma protegida o CPF.
- `ADMIN_PASSWORD`: ao menos 12 caracteres, sem senha padrão em produção.
- Mercado Pago: `MERCADO_PAGO_ACCESS_TOKEN`, `MERCADO_PAGO_WEBHOOK_SECRET` e
  `MERCADO_PAGO_COLLECTOR_ID`. Em produção, `BASE_PUBLIC_URL` deve ser HTTPS.
- Brevo: `BREVO_SMTP_LOGIN`, `BREVO_SMTP_KEY` e remetente verificado em
  `EMAIL_FROM`. O plano gratuito atualmente divulgado pela Brevo permite até
  300 emails por dia, compartilhados entre fluxos da conta e sujeitos às regras
  do serviço; não é email gratuito ilimitado.
- Preparação e validação visual de ofertas: `NVIDIA_API_KEY`,
  `NVIDIA_TEXT_MODEL` e `NVIDIA_VISION_MODEL`. Sem essas variáveis, nenhuma oferta é publicada automaticamente.

O webhook valida a assinatura HMAC, consulta o pagamento na API do Mercado
Pago e confere status aprovado, pedido, moeda, valor e recebedor. Eventos e
aprovações são idempotentes. O email leva a uma página com token opaco válido
por 24 horas após a aprovação; nunca contém o convite bruto. Falha de email não
desfaz o pagamento.

O painel só permite ativar vendas quando preço, convite, suporte, SMTP Brevo,
token do Mercado Pago, segredo do webhook, ID do recebedor e URL pública HTTPS
estiverem configurados. Assim, a ausência de credenciais nunca vira uma compra
falsa nem coleta cadastro sem haver um caminho completo de entrega.

### Operação de grupo e ofertas

O link de convite e o ID técnico do grupo do bot são campos diferentes. Trocar
o convite no painel não o revoga no WhatsApp nem move o bot para outro grupo.
Revogue o link anterior no próprio WhatsApp e configure o novo ID de destino.
Compradores ainda dentro das 24 horas veem o convite atual sem ganhar prazo
extra.

Ofertas físicas não usam checkout nem afiliados. O admin informa nome exato e
preço; a pesquisa com IA precisa retornar modelo, imagem e fontes com confiança
alta. Uma segunda chamada de visão inspeciona a imagem candidata e bloqueia
variante divergente, montagem, texto promocional e imagem sintética suspeita.
Caso contrário, a oferta fica bloqueada até receber foto real. A legenda
direciona a um atendente e não infere estoque, condição, garantia, preço anterior
ou desconto. O WhatsApp via Baileys é uma integração não oficial e só inicia por
ação explícita no painel (ou pela flag legada).

### Hospedagem

A landing pode ser servida estaticamente pela Netlify, mas esta aplicação
completa não deve ser publicada lá como uma simples pasta: SQLite, filas e a
sessão persistente do Baileys dependem de um processo e disco duráveis. Para
produção, mantenha o backend em um host persistente com HTTPS e banco com backup,
ou migre banco/filas/sessão antes de adaptar APIs para Functions. Não publique o
diretório inteiro, pois `.env`, banco e sessão do WhatsApp são privados.

### Testes

```bash
npm test
```

Os testes usam banco temporário e mocks isolados; não criam Pix, não enviam
email e não publicam mensagens reais.

Offers Workspace evolui o `offers-bot` para um workspace de operacao organica de grupos de desconto. O app preserva o fluxo existente de ofertas, Telegram, WhatsApp e painel web, e adiciona modulos para produtos, nichos, criativos, qualidade editorial, contas sociais, fila de publicacao, exportacao manual, tracking e analytics.

O sistema nao implementa bypass, evasao de ban, simulacao humana, automacao de login, manipulacao de sessao ou scraping agressivo de plataformas sociais. Publicacao social deve usar APIs oficiais, OAuth e aprovacao/autorizacao. Quando a API nao esta configurada, o fluxo cai para exportacao manual.

## Instalar

```bash
npm install
cp .env.example .env
npm start
```

Por padrao o servidor sobe em `http://localhost:3000`.

## Configurar `.env`

Principais variaveis:

```env
PORT=3000
DATABASE_PATH=./data/app.db
BASE_PUBLIC_URL=http://localhost:3000
ENCRYPTION_KEY=change_me_32_chars_minimum

NVIDIA_API_KEY=
NVIDIA_TEXT_MODEL=openai/gpt-oss-20b
NVIDIA_VISION_MODEL=meta/llama-3.2-90b-vision-instruct
ELEVENLABS_API_KEY=
TELEGRAM_BOT_TOKEN=
```

O banco SQLite e criado automaticamente em `data/app.db`. Se um banco legado `data/database.sqlite` existir e `DATABASE_PATH` nao for definido, o app preserva esse banco.

Os fluxos legados de WhatsApp e scraper recorrente ficam desativados por padrao. Para usar o comportamento antigo, defina `ENABLE_LEGACY_WHATSAPP=true` e/ou `ENABLE_LEGACY_SCRAPER=true`.

O painel tambem permite iniciar o WhatsApp manualmente pela aba `WhatsApp`, sem precisar ativar auto-start no boot. Clique em `Iniciar WhatsApp`, aguarde o QR Code e escaneie pelo app oficial em Aparelhos conectados. A sessao fica salva em `WA_AUTH_FOLDER` (padrao `./.wwebjs_auth`).

## Estrutura

```text
data/app.db
modules/products
modules/niches
modules/creatives
modules/accounts
modules/publisher
modules/publishers
modules/tracking
modules/analytics
modules/quality-guard
modules/content-quality
modules/prompts
modules/security
public/index.html
public/app.js
public/styles.css
exports
output
uploads
campaigns
presets
```

## Fluxo de uso

1. Importe um produto em `POST /api/products/import` ou pelo painel Radar.
2. Gere a campanha em `POST /api/products/:id/generate-campaign`.
3. Avalie o criativo em `POST /api/content-quality/evaluate`.
4. Aprove ou ajuste o criativo no Creative Studio.
5. Renderize com `POST /api/creatives/:id/render`.
6. Cadastre contas no Account Hub.
7. Crie fila em `POST /api/publisher/queue`.
8. O Quality Guard roda antes de agendar, publicar ou exportar.
9. Publique agora ou exporte manualmente.
10. Use o tracking link `BASE_PUBLIC_URL/r/:tracking_code`.
11. Consulte resultados em `/api/analytics/summary` ou no painel Analytics.

## Publicacao manual

Contas com `posting_mode` `manual` ou `export_only` geram um pacote em:

```text
exports/YYYY-MM-DD/account_handle/creative_id/
```

O pacote contem `caption.txt`, `metadata.json`, `checklist.txt` e o video quando houver render.

## Telegram

Configure:

```env
TELEGRAM_BOT_TOKEN=...
```

Crie uma conta social:

```json
{
  "platform": "telegram",
  "handle": "@canal",
  "niche": "gamer_setup",
  "posting_mode": "api",
  "metadata": {
    "chat_id": "@canal"
  }
}
```

Quando `TELEGRAM_BOT_TOKEN` e `metadata.chat_id` estao configurados, o publisher usa a Telegram Bot API. Sem configuracao completa, use exportacao manual.

## WhatsApp legado

A aba `WhatsApp` do painel possui:

- iniciar conexao e gerar QR Code;
- visualizar status e detalhes da sessao salva;
- listar grupos do numero conectado;
- limpar sessao para trocar de numero.

A aba `Bot Legado` recupera as funcoes operacionais antigas:

- adicionar oferta por link ou manualmente;
- disparar ciclo manual;
- drenar fila WhatsApp;
- processar arquivos JSON/CSV;
- ver/copiar mensagens pendentes;
- marcar mensagem como enviada;
- cadastrar e remover mapeamentos de grupos/canais.

O envio usa a sessao autorizada pelo QR Code do proprio WhatsApp. Nao ha automacao de login, bypass ou manipulacao de sessao.

## APIs oficiais planejadas

- TikTok: OAuth, refresh token, creator_info, upload/init, direct post e status.
- Instagram: Meta OAuth, IG User ID, media container, publish container e Reels.
- YouTube: Google OAuth, refresh token e `videos.insert`.
- Kwai: exportacao manual ate existir integracao oficial adequada.

## Limitacoes atuais

- A geracao de criativos usa templates locais seguros como fallback.
- O render usa FFmpeg quando disponivel; sem FFmpeg, cria um placeholder explicito em `output/` para manter o fluxo testavel.
- TikTok, Instagram e YouTube estao como scaffolds oficiais e caem para exportacao manual no publisher.
- O Quality Guard e o Content Quality usam regras heuristicas locais.

## Rotas principais

- `POST /api/products/import`
- `GET /api/products`
- `POST /api/products/:id/generate-campaign`
- `GET /api/creatives`
- `POST /api/content-quality/evaluate`
- `POST /api/quality/check`
- `POST /api/accounts`
- `POST /api/publisher/queue`
- `POST /api/publisher/queue/:id/publish-now`
- `POST /api/publisher/export`
- `GET /r/:tracking_code`
- `GET /api/analytics/summary`

## Codigo legado preservado

As rotas antigas continuam disponiveis:

- `POST /offers`
- `POST /quick-offer`
- `GET /offers`
- `GET /whatsapp-queue`
- `POST /mark-whatsapp-sent`
- `GET /api/whatsapp/status`
- `POST /api/whatsapp/start`
- `GET /api/whatsapp/qr`
- `GET /api/whatsapp/groups`
- `POST /api/whatsapp/logout`
