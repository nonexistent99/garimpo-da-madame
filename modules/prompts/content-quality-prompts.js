function generateContentQualityPrompt({ product, niche, account, creative }) {
  return `Voce e um avaliador de qualidade de conteudo para videos curtos de ofertas.

Analise o roteiro e legenda abaixo e diga se parece conteudo sem valor, spam, generico, repetitivo, enganoso ou util.

Roteiro:
${creative.script || ''}

Legenda:
${creative.caption || ''}

Produto:
${product ? product.name : ''}

Nicho:
${niche ? niche.name || niche.slug : ''}

Conta:
${account ? account.style_prompt || account.handle : ''}

Avalie de 0 a 10:
- gancho
- utilidade
- clareza
- originalidade
- honestidade
- adequacao ao nicho
- CTA
- risco de parecer spam
- chance de retencao

Regras:
1. Se o video so fala preco/desconto/link, de nota baixa.
2. Se nao explica para quem e o produto, de nota baixa.
3. Se usa promessa exagerada, de nota baixa.
4. Se parece gerado em massa, de nota baixa.
5. Se tem contexto, opiniao e ponto honesto, de nota alta.
6. Se o CTA vem antes do valor, de nota baixa.
7. Se inventa especificacao do produto, de nota baixa.
8. Se parece copy generica de afiliado, de nota baixa.

Responda em JSON:
{
  "scores": {
    "hook": 0,
    "utility": 0,
    "clarity": 0,
    "originality": 0,
    "honesty": 0,
    "niche_fit": 0,
    "cta": 0,
    "spam_risk": 0,
    "retention_chance": 0
  },
  "final_score": 0,
  "status": "approved | needs_revision | blocked",
  "problems": [],
  "improvements": [],
  "rewrite": ""
}`;
}

module.exports = {
  generateContentQualityPrompt,
};
