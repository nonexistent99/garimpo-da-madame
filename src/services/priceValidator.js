/**
 * central de Validação de Preços (priceValidator.js)
 * Utilitários para parse, validação rígida e normalização de dados financeiros.
 */

/**
 * Converte qualquer string de preço BRL/USD ou valor bruto em float positivo.
 * Ex: "R$ 3.980,00" -> 3980.00 | "R$ 39,90" -> 39.90 | "129.99" -> 129.99
 * @param {string|number} priceStr 
 * @returns {number} Float normalizado ou 0 se inválido.
 */
function parsePrice(priceStr) {
  if (priceStr === null || priceStr === undefined) return 0;
  if (typeof priceStr === 'number') {
    return isNaN(priceStr) || priceStr < 0 ? 0 : priceStr;
  }

  try {
    let s = priceStr.toString().replace(/R\$\s*/gi, '').trim();
    if (!s) return 0;

    // Se possui vírgula, assume-se formato brasileiro (milhares com ponto, decimais com vírgula)
    if (s.includes(',')) {
      s = s.replace(/\./g, '').replace(',', '.');
    }

    const val = parseFloat(s);
    return isNaN(val) || val < 0 ? 0 : val;
  } catch (e) {
    return 0;
  }
}

/**
 * Normaliza valores decimais para 2 casas decimais.
 * @param {number} val 
 * @returns {number}
 */
function normalizeCurrency(val) {
  const n = parseFloat(val);
  if (isNaN(n) || n <= 0) return 0;
  return parseFloat(n.toFixed(2));
}

/**
 * Valida a consistência de preços e descontos de um produto.
 * @param {object} product Objeto contendo { currentPrice, oldPrice, discount, coupon, badge }
 * @returns {object} { valid: boolean, reason?: string, cleanProduct?: object }
 */
function validatePriceData(product) {
  if (!product) {
    return { valid: false, reason: 'Objeto de produto nulo ou indefinido' };
  }

  // Realiza o parse inicial garantindo floats válidos
  const current = parsePrice(product.currentPrice);
  let old = parsePrice(product.oldPrice);

  // 1. Preço atual deve ser estritamente maior que zero
  if (current <= 0) {
    return { valid: false, reason: `Preço atual inválido ou zerado (recebido: ${product.currentPrice})` };
  }

  // 2. Correção de preço antigo ausente ou inválido
  if (old <= 0) {
    old = current; // assume que preço antigo é igual ao atual se for ausente
  }

  // 3. Preço antigo não pode ser menor do que o preço atual
  if (old < current) {
    return {
      valid: false,
      reason: `Preço antigo (R$ ${old}) é MENOR que o preço atual (R$ ${current}). Descarte por inversão de preço.`
    };
  }

  // 4. Calcular o desconto percentual exato
  let computedDiscount = 0;
  if (old > current) {
    computedDiscount = Math.round(((old - current) / old) * 100);
  }

  // 5. Verificar consistência do desconto
  if (product.discount !== undefined && product.discount !== null) {
    const rawDiscount = parseInt(product.discount);
    // Se o desconto informado for negativo ou incoerente com o desconto real matemático
    if (rawDiscount < 0) {
      return { valid: false, reason: `Desconto negativo informado (${rawDiscount}%)` };
    }
    // Desconto absurdo (erro de raspagem)
    if (rawDiscount >= 100) {
      return { valid: false, reason: `Desconto absurdo ou incoerente informado (${rawDiscount}%)` };
    }
  }

  if (computedDiscount >= 100) {
    return { valid: false, reason: `Cálculo de desconto incoerente/absurdo (${computedDiscount}%)` };
  }

  // 6. Verificar se existe pelo menos uma evidência de promoção/desconto real
  const hasMathDiscount = computedDiscount > 0;
  const hasCoupon = !!(product.coupon && product.coupon.trim().length > 0);
  const hasBadge = !!(product.badge && product.badge.trim().length > 0);

  if (!hasMathDiscount && !hasCoupon && !hasBadge) {
    return { valid: false, reason: `Produto com preço cheio. Sem desconto matemático, sem cupom e sem selo de oferta.` };
  }

  // Retorna o produto limpo e normalizado
  return {
    valid: true,
    cleanProduct: {
      ...product,
      currentPrice: normalizeCurrency(current),
      oldPrice: normalizeCurrency(old),
      discount: computedDiscount
    }
  };
}

module.exports = {
  parsePrice,
  normalizeCurrency,
  validatePriceData
};
