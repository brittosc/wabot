/**
 * Script Standalone para baixar informações dos participantes dos grupos do WhatsApp
 * e salvá-los no Supabase na tabela `passageiros`.
 *
 * Coleta:
 * - ID do WhatsApp (JID)
 * - Nome público (formatado de forma limpa)
 * - Foto de perfil pública
 *
 * Execução: node baixar_participantes.js
 */

require("dotenv").config({ quiet: true });
const { Client, LocalAuth } = require("whatsapp-web.js");
const qrcode = require("qrcode-terminal");
const chalk = require("chalk");
const supabase = require("./src/database/supabaseClient");
const { formatName } = require("./src/utils/nameFormatter");

// Helper para timeout rígido em operações que podem travar no Puppeteer/WhatsApp
const withTimeout = (promise, ms, defaultValue = null) => {
  return Promise.race([
    promise,
    new Promise((resolve) => setTimeout(() => resolve(defaultValue), ms)),
  ]);
};

async function main() {
  console.log(chalk.cyan.bold("\n=== INICIALIZANDO DOWNLOADER DE PARTICIPANTES ===\n"));

  const client = new Client({
    authStrategy: new LocalAuth({ dataPath: "./auth_info" }),
    webVersionCache: {
      type: "remote",
      remotePath: "https://raw.githubusercontent.com/wppconnect-team/wa-version/main/html/{version}.html"
    },
    puppeteer: {
      headless: true,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-accelerated-2d-canvas",
        "--no-first-run",
        "--no-zygote",
        "--disable-gpu",
      ],
    },
  });

  client.on("qr", (qr) => {
    console.log(chalk.yellow("🔑 Autenticação necessária. Escaneie o QR Code abaixo:"));
    qrcode.generate(qr, { small: true });
  });

  client.on("auth_failure", (msg) => {
    console.error(chalk.red("❌ Falha na autenticação do WhatsApp:"), msg);
    process.exit(1);
  });

  client.on("ready", async () => {
    console.log(chalk.green.bold("✅ Cliente WhatsApp conectado com sucesso!\n"));
    
    try {
      console.log(chalk.blue("📥 Buscando chats do WhatsApp..."));
      const chats = await client.getChats();
      
      const groups = chats.filter((chat) => chat.isGroup);
      console.log(chalk.blue(`👥 Encontrados ${chalk.bold(groups.length)} grupos de WhatsApp.\n`));

      if (groups.length === 0) {
        console.log(chalk.yellow("⚠️ Nenhum grupo encontrado na conta conectada."));
        await client.destroy();
        process.exit(0);
      }

      // Mapeamento para garantir que processaremos cada participante único apenas uma vez
      // Chave: ID do participante (JID), Valor: Objeto contendo dados do participante
      const uniqueParticipants = new Map();

      for (const group of groups) {
        console.log(chalk.gray(`  • Lendo membros do grupo: ${chalk.cyan(group.name)}...`));
        const participants = group.participants || [];
        
        for (const p of participants) {
          const jid = p.id._serialized;
          if (jid && !uniqueParticipants.has(jid)) {
            uniqueParticipants.set(jid, p);
          }
        }
      }

      const totalToProcess = uniqueParticipants.size;
      console.log(chalk.green(`\n🎯 Total de participantes únicos encontrados: ${chalk.bold(totalToProcess)}\n`));

      if (totalToProcess === 0) {
        console.log(chalk.yellow("⚠️ Nenhum participante válido encontrado para processamento."));
        await client.destroy();
        process.exit(0);
      }

      // Processamento concorrente limitado dos participantes para evitar rate-limits do WhatsApp
      const limit = 5; // Limite de concorrência simultânea
      const participantsList = Array.from(uniqueParticipants.values());
      let processedCount = 0;
      let successCount = 0;
      let errorCount = 0;

      console.log(chalk.blue(`🚀 Iniciando o processamento em lotes de ${limit}...`));

      const processParticipant = async (participant) => {
        const jid = participant.id._serialized;
        
        try {
          // 1. Obter detalhes do contato
          const contact = await withTimeout(client.getContactById(jid), 3000, null);
          
          let publicName = "Sem Nome";
          if (contact) {
            publicName = contact.pushname || contact.name || contact.verifiedName || contact.formattedName || "Sem Nome";
          }
          
          // Formata o nome para ficar no padrão correto
          const formattedName = formatName(publicName);

          // 2. Obter foto de perfil pública
          let photoUrl = null;
          try {
            photoUrl = await withTimeout(client.getProfilePicUrl(jid), 3000, null);
          } catch (e) {
            // Ignora silenciosamente erros de foto para prosseguir com o cadastro
          }

          // 3. Salvar/Atualizar no Supabase
          const { error } = await supabase
            .from("passageiros")
            .upsert(
              {
                id: jid,
                nome: formattedName,
                foto_publica: photoUrl,
              },
              { onConflict: "id" }
            );

          if (error) {
            throw error;
          }

          successCount++;
          console.log(
            chalk.green(
              `[${++processedCount}/${totalToProcess}] Sincronizado: ` +
                `${chalk.bold(formattedName)} (${chalk.gray(jid)}) | Foto: ${photoUrl ? chalk.green("Sim") : chalk.yellow("Não")}`
            )
          );
        } catch (err) {
          errorCount++;
          console.error(
            chalk.red(
              `❌ [${++processedCount}/${totalToProcess}] Erro ao processar ${jid}: ${err.message}`
            )
          );
        }
      };

      // Gerenciador de fila concorrente
      const queue = [...participantsList];
      const activePromises = [];

      while (queue.length > 0 || activePromises.length > 0) {
        while (activePromises.length < limit && queue.length > 0) {
          const item = queue.shift();
          const promise = processParticipant(item).then(() => {
            // Remove a si mesma da lista de promessas ativas quando finalizada
            activePromises.splice(activePromises.indexOf(promise), 1);
          });
          activePromises.push(promise);
        }
        
        // Espera pelo menos uma das promessas ativas terminar para prosseguir
        if (activePromises.length > 0) {
          await Promise.race(activePromises);
        }
      }

      console.log(chalk.cyan.bold("\n=== RESUMO DO PROCESSAMENTO ==="));
      console.log(chalk.green(`✓ Sincronizados com sucesso: ${successCount}`));
      console.log(chalk.red(`✗ Falhas no processamento: ${errorCount}`));
      console.log(chalk.cyan.bold("===============================\n"));

    } catch (error) {
      console.error(chalk.red("💥 Ocorreu um erro fatal durante a execução:"), error);
    } finally {
      console.log(chalk.blue("🔌 Encerrando conexão com o WhatsApp..."));
      await client.destroy();
      console.log(chalk.green("👋 Processo finalizado!"));
      process.exit(0);
    }
  });

  try {
    await client.initialize();
  } catch (err) {
    console.error(chalk.red("❌ Falha fatal ao inicializar o Puppeteer:"), err);
    process.exit(1);
  }
}

main();
