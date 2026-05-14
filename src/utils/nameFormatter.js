/**
 * Formata um nome para o padrão brasileiro:
 * - Todas as palavras começam com letra maiúscula.
 * - Preposições comuns (de, da, do, das, dos, e) permanecem em minúscula,
 *   a menos que sejam a primeira palavra.
 * 
 * Exemplo: "ester de oliveira" -> "Ester de Oliveira"
 * 
 * @param {string} name O nome a ser formatado
 * @returns {string} O nome formatado
 */
function formatName(name) {
  if (!name) return name;
  
  const prepositions = ['de', 'da', 'do', 'das', 'dos', 'e'];
  
  return name
    .toLowerCase()
    .trim()
    .split(/\s+/)
    .map((word, index) => {
      if (prepositions.includes(word) && index > 0) {
        return word;
      }
      return word.charAt(0).toUpperCase() + word.slice(1);
    })
    .join(' ');
}

module.exports = { formatName };
