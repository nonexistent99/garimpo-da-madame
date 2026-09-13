function getWords(name) {
  const stops = new Set(['de','com','para','em','por','do','da','no','na','e','a','o','un','und']);
  return new Set(name.replace(/[^\w\sÀ-ÿ]/g,'').toLowerCase().split(/\s+/).filter(w => w.length > 1 && !stops.has(w)));
}
function jaccard(a,b) {
  if (a.size === 0 || b.size === 0) return 0;
  let i = 0;
  for (const w of a) if (b.has(w)) i++;
  return i / new Set([...a,...b]).size;
}

const tests = [
  // Devem ser bloqueados
  ['Torradeira Arno Soleil Marfim Preta, com 7 Níveis de Tostagem',
   'Torradeira Arno Soleil, Com 7 Níveis de Tostagem e Bandeja Removível', 'BLOCK'],
  ['PowerA Controle Advantage com Fio para Nintendo Switch 2 - Mario Kart',
   'PowerA Controle Advantage com Fio para Nintendo Switch 2 - Mario Red', 'BLOCK'],
  ['Samsung Galaxy Watch7 Smartwatch 44mm Bluetooth Verde',
   'Samsung Galaxy Watch7 Smartwatch 44mm Bluetooth Preto', 'BLOCK'],
  // Devem passar
  ['Torradeira Arno Soleil Marfim Preta',
   'Cafeteira Arno Solo Digital', 'PASS'],
  ['Mouse Gamer HyperX Pulsefire Core RGB',
   'Headset Gamer HyperX Cloud Stinger 2', 'PASS'],
  ['Samsung Galaxy S24 128GB Preto',
   'Samsung Galaxy Watch7 44mm Verde', 'PASS'],
  ['Ração Golden Cachorro Adulto 15kg',
   'Ração Royal Canin Gato Filhote 7.5kg', 'PASS'],
];

let pass = 0, fail = 0;
tests.forEach(([a, b, expected]) => {
  const sim = jaccard(getWords(a), getWords(b));
  const result = sim >= 0.5 ? 'BLOCK' : 'PASS';
  const ok = result === expected;
  if (ok) pass++; else fail++;
  console.log(`${ok ? 'OK' : 'FAIL'} ${(sim*100).toFixed(0).padStart(3)}% ${result.padEnd(6)} ${a.substring(0,50)}`);
  console.log(`       ${''.padStart(10)} ${b.substring(0,50)}`);
});
console.log(`\nResultado: ${pass}/${pass+fail} corretos`);
