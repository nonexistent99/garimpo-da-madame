# Deploy na VPS Hostinger

## Arquitetura

- A Netlify continua servindo a landing page e o painel.
- A VPS expõe somente a API HTTPS através do Caddy.
- O PostgreSQL não publica porta no host.
- Sessão do WhatsApp, banco e imagens usam volumes persistentes.

## Preparação da VPS

1. Instale Docker Engine e Docker Compose Plugin.
2. Configure uma chave SSH e mantenha abertas somente as portas 22, 80 e 443.
3. Crie um registro DNS `A` para o subdomínio da API apontando ao IP da VPS.
4. Copie o projeto para `/opt/garimpo-da-madame`.
5. Copie `.env.vps.example` para `.env.vps` e preencha os segredos sem colocá-los no Git.

## Subida inicial

```bash
docker compose --env-file .env.vps -f docker-compose.production.yml config
docker compose --env-file .env.vps -f docker-compose.production.yml up -d --build
docker compose --env-file .env.vps -f docker-compose.production.yml ps
curl -fsS https://SEU_SUBDOMINIO/api/health
```

## Migração do PostgreSQL

Faça um dump consistente no Railway antes da troca e restaure no container PostgreSQL da VPS. Não desligue o Railway antes de validar a restauração.

```bash
pg_dump --format=custom --no-owner --no-acl "$DATABASE_URL_RAILWAY" > garimpo.dump
docker compose --env-file .env.vps -f docker-compose.production.yml exec -T postgres \
  pg_restore --clean --if-exists --no-owner --no-acl \
  -U "$POSTGRES_USER" -d "$POSTGRES_DB" < garimpo.dump
```

## Troca da Netlify

Após a API da VPS responder com sucesso, altere o destino de `/api/*` no `netlify.toml` e em `.netlify-publish/_redirects` para `https://SEU_SUBDOMINIO/api/:splat`, publique a Netlify e teste:

- login e salvamento no painel;
- criação de oferta por IA;
- SMTP da Brevo;
- QR e reconexão do WhatsApp;
- criação e confirmação de Pix;
- webhook do Mercado Pago;
- página de resgate.

Mantenha Railway e Netlify atuais disponíveis até todos os testes passarem.
