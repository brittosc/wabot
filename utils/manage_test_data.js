/**
 * Utilitário para gerenciar dados de teste (Votos Fakes).
 *
 * USO:
 * node utils/manage_test_data.js populate 40 -- Adiciona votos fakes para hoje (padrão 5 por grupo)
 * node utils/manage_test_data.js clear              -- Remove todos os votos de hoje do banco
 * node utils/manage_test_data.js overflow           -- Enche os ônibus além da capacidade para teste de alerta
 */

const fs = require("fs");
const path = require("path");
const supabase = require("../src/database/supabaseClient");
const moment = require("moment-timezone");

const command = process.argv[2];
const param = process.argv[3];

async function manage() {
  const configPath = path.join(__dirname, "../config/config.json");
  let config = {};
  try {
    config = JSON.parse(fs.readFileSync(configPath, "utf8"));
  } catch (e) {
    console.error("❌ Erro ao ler config.json:", e.message);
    process.exit(1);
  }

  const capacities = config.groupCapacities || {};
  const todayStr = moment().tz("America/Sao_Paulo").format("YYYY-MM-DD");

  if (command === "clear") {
    console.log(`\n🧹 Limpando votos de hoje (${todayStr})...`);
    const { error, count } = await supabase
      .from("votes")
      .delete()
      .eq("vote_date", todayStr);

    if (error) {
      console.error("❌ Erro ao limpar:", error.message);
    } else {
      console.log(`✅ Sucesso! Votos removidos.`);
    }
  } else if (command === "populate" || command === "overflow") {
    const amountPerGroup = command === "overflow" ? 60 : parseInt(param) || 5;
    console.log(
      `\n🚀 Populando banco com ~${amountPerGroup} votos fakes por grupo para ${todayStr}...`,
    );

    const options = [
      "Irei, ida e volta.",
      "Irei, mas não retornarei.",
      "Não irei, apenas retornarei.",
      "Não irei à faculdade hoje.",
    ];

    const groups = Object.keys(capacities);
    let totalInserted = 0;

    for (const group of groups) {
      console.log(`   - Adicionando em: ${group}`);
      for (let i = 0; i < amountPerGroup; i++) {
        const voterId = `fake_voter_${group.replace(/\s+/g, "_")}_${i}`;
        const option = options[Math.floor(Math.random() * options.length)];

        const { error } = await supabase.from("votes").upsert(
          {
            voter_id: voterId,
            group_name: group,
            vote_date: todayStr,
            option: option,
            poll_name: "Enquete de Teste Automatizado",
          },
          { onConflict: "voter_id,group_name,vote_date" },
        );

        if (error) {
          console.error(`     ❌ Erro no eleitor ${i}:`, error.message);
        } else {
          totalInserted++;
        }
      }
    }
    console.log(`\n✅ Concluído! ${totalInserted} votos inseridos.`);
  } else {
    console.log("\n❓ Comando não reconhecido.");
    console.log("Use: populate [n], clear ou overflow");
  }

  console.log("\n✨ Script finalizado.");
}

manage()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("❌ Erro inesperado:", e.message);
    process.exit(1);
  });
