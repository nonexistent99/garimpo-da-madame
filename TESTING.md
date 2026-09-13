# Testing

1. Subir servidor:

```bash
npm install
npm start
```

2. Abrir `http://localhost:3000`.

3. Importar produto manual:

```bash
curl -X POST http://localhost:3000/api/products/import \
  -H "Content-Type: application/json" \
  -d "{\"name\":\"Headset Gamer RGB\",\"niche\":\"gamer_setup\",\"old_price\":199.90,\"current_price\":99.90,\"image_url\":\"https://example.com/headset.jpg\",\"affiliate_url\":\"https://example.com/oferta\",\"source\":\"manual\",\"metadata\":{}}"
```

4. Ver produto no Radar de Ofertas:

```bash
curl http://localhost:3000/api/products
```

5. Gerar campanha:

```bash
curl -X POST http://localhost:3000/api/products/PRODUCT_ID/generate-campaign \
  -H "Content-Type: application/json" \
  -d "{\"count\":7}"
```

6. Ver creative_variants:

```bash
curl "http://localhost:3000/api/creatives?product_id=PRODUCT_ID"
```

7. Avaliar qualidade:

```bash
curl -X POST http://localhost:3000/api/content-quality/evaluate \
  -H "Content-Type: application/json" \
  -d "{\"creative_id\":\"CREATIVE_ID\"}"
```

8. Melhorar criativo ruim pelo painel ou:

```bash
curl -X POST http://localhost:3000/api/creatives/CREATIVE_ID/improve \
  -H "Content-Type: application/json" \
  -d "{}"
```

9. Renderizar video:

```bash
curl -X POST http://localhost:3000/api/creatives/CREATIVE_ID/render \
  -H "Content-Type: application/json" \
  -d "{}"
```

10. Criar conta manual:

```bash
curl -X POST http://localhost:3000/api/accounts \
  -H "Content-Type: application/json" \
  -d "{\"platform\":\"manual\",\"handle\":\"@setupbarato\",\"niche\":\"gamer_setup\",\"display_name\":\"Setup Barato\",\"status\":\"warming_up\",\"daily_limit\":1,\"style_prompt\":\"jovem, direto, honesto\",\"default_cta\":\"Se ainda estiver nesse preco, deixei no grupo de setup barato da bio.\",\"posting_mode\":\"manual\"}"
```

11. Criar conta Telegram:

```bash
curl -X POST http://localhost:3000/api/accounts \
  -H "Content-Type: application/json" \
  -d "{\"platform\":\"telegram\",\"handle\":\"@meucanal\",\"niche\":\"gamer_setup\",\"status\":\"active\",\"daily_limit\":2,\"posting_mode\":\"api\",\"metadata\":{\"chat_id\":\"@meucanal\"}}"
```

12. Criar item de fila:

```bash
curl -X POST http://localhost:3000/api/publisher/queue \
  -H "Content-Type: application/json" \
  -d "{\"creative_id\":\"CREATIVE_ID\",\"account_id\":\"ACCOUNT_ID\",\"caption\":\"Legenda final\"}"
```

13. Rodar Quality Guard isolado:

```bash
curl -X POST http://localhost:3000/api/quality/check \
  -H "Content-Type: application/json" \
  -d "{\"creative_id\":\"CREATIVE_ID\",\"account_id\":\"ACCOUNT_ID\"}"
```

14. Exportar pacote manual:

```bash
curl -X POST http://localhost:3000/api/publisher/export \
  -H "Content-Type: application/json" \
  -d "{\"creative_id\":\"CREATIVE_ID\",\"account_id\":\"ACCOUNT_ID\"}"
```

15. Publicar no Telegram, se token e chat estiverem configurados:

```bash
curl -X POST http://localhost:3000/api/publisher/queue/QUEUE_ID/publish-now \
  -H "Content-Type: application/json" \
  -d "{}"
```

16. Clicar no tracking link retornado:

```bash
curl -i http://localhost:3000/r/TRACKING_CODE
```

17. Ver analytics:

```bash
curl http://localhost:3000/api/analytics/summary
```

## WhatsApp legado no painel

1. Abra `http://localhost:3000`.
2. Entre na aba `WhatsApp`.
3. Clique em `Iniciar WhatsApp`.
4. Aguarde o QR Code aparecer.
5. Escaneie pelo app oficial do WhatsApp em Aparelhos conectados.
6. Confirme que o status muda para `Conectado`.
7. Clique em `Listar grupos` e copie o ID do grupo desejado.
8. Entre na aba `Bot Legado`.
9. Cadastre ou atualize o mapeamento do nicho para o grupo/canal.
10. Adicione uma oferta manual ou por link.
11. Clique em `Disparar agora`.
12. Verifique a fila WhatsApp.
13. Clique em `Drenar fila agora`.
14. Use `Copiar texto` ou `Marcar enviado` quando precisar operar manualmente.
