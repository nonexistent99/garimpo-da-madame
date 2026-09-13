/**
 * central de Links Amazon (linkCleaner.js)
 * Utilitários para extração de ASIN e montagem de links afiliados limpos.
 */

const affiliateTag = process.env.AMAZON_AFFILIATE_TAG || 'hiurykng-20';

/**
 * Extrai o ASIN (Amazon Standard Identification Number) de 10 caracteres a partir de qualquer URL.
 * Suporta decodeURIComponent e múltiplos formatos de caminhos (/dp/, /product/, /gp/product/).
 * @param {string} url 
 * @returns {string|null} ASIN de 10 caracteres em caixa alta ou null se não encontrado.
 */
function extractAsin(url) {
  if (!url || typeof url !== 'string') return null;

  let decoded = url;
  try {
    decoded = decodeURIComponent(url);
  } catch (e) {
    // Ignora erro de decode
  }

  // Captura o ASIN (10 caracteres alfanuméricos)
  const asinMatch = decoded.match(/\/(?:dp|product|gp\/product)\/([A-Z0-9]{10})/i);
  return asinMatch ? asinMatch[1].toUpperCase() : null;
}

/**
 * Reconstrói e higieniza qualquer link da Amazon para o padrão limpo com tag de afiliado.
 * Formato obrigatório: https://www.amazon.com.br/dp/ASIN?tag=TAG
 * @param {string} rawUrl 
 * @returns {string|null} Link limpo com tag de afiliado ou link original limpo se não achar ASIN.
 */
function buildCleanAffiliateLink(rawUrl) {
  if (!rawUrl || typeof rawUrl !== 'string') return null;

  const asin = extractAsin(rawUrl);
  if (asin) {
    return `https://www.amazon.com.br/dp/${asin}?tag=${affiliateTag}`;
  }

  // Fallback: Se não achar o ASIN, limpa parâmetros de rastreamento pesados e anexa a tag de afiliado
  try {
    const cleanLink = rawUrl.split('/ref=')[0].split('?')[0];
    return `${cleanLink}?tag=${affiliateTag}`;
  } catch (e) {
    return `${rawUrl}?tag=${affiliateTag}`;
  }
}

module.exports = {
  extractAsin,
  buildCleanAffiliateLink
};
