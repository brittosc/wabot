/**
 * Utilitário para resetar manualmente as estatísticas de votos no Supabase.
 *
 * ATENÇÃO: A execução deste script apagará TODOS os registros de votos da tabela 'votes'.
 * Esta ação é irreversível no banco de dados.
 *
 * USO: node utils/reset_statistics.js
 */

const supabase = require("../src/database/supabaseClient");

async function resetStatistics() {
  console.log("--- Iniciando Reset de Estatísticas ---");

  try {
    // No Supabase, para deletar todos os registros sem um filtro específico,
    // podemos usar um filtro que sempre seja verdadeiro ou abranger todos os IDs.
    // O .neq('voter_id', '') garante que registros com voter_id (quase todos) sejam incluídos.
    const { data, error, count } = await supabase
      .from("votes")
      .delete()
      .neq("voter_id", ""); // Filtro "gambiarra" para permitir delete em massa se RLS permitir

    if (error) {
      throw error;
    }

    console.log(
      '✅ Sucesso: Todas as estatísticas foram removidas da tabela "votes".',
    );
    if (count) console.log(`Total de registros removidos: ${count}`);
  } catch (error) {
    console.error("❌ Erro ao resetar estatísticas:", error.message);
  } finally {
    console.log("--- Processo Finalizado ---");
    process.exit();
  }
}

// Para executar, descomente a linha abaixo e rode o script.
// resetStatistics();

console.log(
  "Script de reset carregado. Para executar, edite o arquivo e descomente a chamada da função resetStatistics().",
);
