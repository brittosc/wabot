const dashboard = require("./dashboard");

/**
 * Executa uma função assíncrona com lógica de retry e backoff exponencial.
 * @param {Function} fn - Função a ser executada.
 * @param {number} retries - Número de tentativas.
 * @param {number} initialDelay - Atraso inicial em ms.
 * @param {string} label - Identificador para o log.
 */
const withRetry = async (fn, retries = 5, initialDelay = 1000, label = "Serviço") => {
  let delay = initialDelay;
  for (let i = 0; i < retries; i++) {
    try {
      const result = await fn();
      // Se for um retorno do Supabase com objeto de erro, lança para disparar o catch
      if (result && result.error && !result.data && result.error.message) {
        throw new Error(result.error.message);
      }
      return result;
    } catch (err) {
      if (i === retries - 1) throw err;
      dashboard.addLog(`[${label}] Erro (${i + 1}/${retries}): ${err.message}. Retentando em ${delay}ms...`);
      await new Promise(resolve => setTimeout(resolve, delay));
      delay *= 2; // Backoff exponencial
    }
  }
};

module.exports = { withRetry };
