function generateCreativePrompt(product, niche, accountStyle = '') {
  return `Voce e um estrategista de conteudo short-form para grupos de desconto.

Crie um video vertical 9:16 de 15 a 30 segundos para TikTok, Reels, Shorts e Kwai.

Produto:
${product.name}

Nicho:
${niche ? niche.name || niche.slug : product.niche || 'desconhecido'}

Preco atual:
${product.current_price}

Preco antigo:
${product.old_price || ''}

Desconto:
${product.discount_pct || 0}%

Publico:
${niche ? niche.target_audience || '' : ''}

Estilo da conta:
${accountStyle || ''}

CTA:
${(niche && niche.default_cta) || product.default_cta || ''}

Regras obrigatorias:
1. Nao faca promessa falsa.
2. Nao diga que e o melhor produto do mercado.
3. Nao use linguagem generica de IA.
4. Nao seja so anuncio.
5. Entregue valor real antes do CTA.
6. Explique para quem o produto faz sentido.
7. Mostre pelo menos um ponto forte.
8. Mostre uma limitacao ou cuidado.
9. Use linguagem brasileira natural.
10. Evite tom desesperado de venda.
11. O gancho precisa aparecer nos primeiros 2 segundos.
12. O CTA deve ser leve e relacionado ao grupo de desconto.
13. Nao afirme que o preco ainda esta disponivel; use "se ainda estiver".
14. Nao invente especificacoes tecnicas do produto.
15. Se faltar informacao, assuma com cautela e diga apenas o que e seguro.

Gere a resposta em JSON:
{
  "angle": "",
  "hook": "",
  "script": "",
  "on_screen_text": [],
  "caption": "",
  "hashtags": [],
  "cta": "",
  "value_explanation": "",
  "why_this_is_not_low_value": ""
}`;
}

module.exports = {
  generateCreativePrompt,
};
