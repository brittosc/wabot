/**
 * Serviço de sincronização de passageiros / participantes de grupos no Supabase.
 * Pode ser chamado de forma standalone ou integrado ao bot principal.
 */

const chalk = require("chalk");
const supabase = require("../database/supabaseClient");
const { formatName } = require("../utils/nameFormatter");

// Helper para timeout rígido em operações de rede
const withTimeout = (promise, ms, defaultValue = null) => {
  return Promise.race([
    promise,
    new Promise((resolve) => setTimeout(() => resolve(defaultValue), ms)),
  ]);
};

/**
 * Executa a sincronização dos participantes únicos de todos os grupos no Supabase.
 * @param {Client} client Instância do cliente whatsapp-web.js conectada e pronta
 * @param {Function} logCallback Função para exibição dos logs (default: console.log)
 */
async function sincronizarParticipantes(client, logCallback = console.log) {
  try {
    logCallback(chalk.blue("📥 Buscando chats do WhatsApp..."));
    const chats = await client.getChats();
    
    const groups = chats.filter((chat) => chat.isGroup);
    logCallback(chalk.blue(`👥 Encontrados ${chalk.bold(groups.length)} grupos de WhatsApp.\n`));

    if (groups.length === 0) {
      logCallback(chalk.yellow("⚠️ Nenhum grupo encontrado na conta conectada."));
      return;
    }

    logCallback(chalk.blue("🔄 Pré-carregando os grupos para sincronizar metadados e fotos de perfil dos membros..."));
    try {
      await client.pupPage.evaluate(async () => {
        try {
          const Store = window.Store;
          if (!Store || !Store.Chat || !Store.Cmd || !Store.Cmd.openChatAt) return;
          const groups = Store.Chat.models.filter(chat => chat.isGroup);
          for (const g of groups) {
            try {
              await Store.Cmd.openChatAt(g);
              // Delay curto entre abertura de grupos
              await new Promise(r => setTimeout(r, 1200));
            } catch (err) {}
          }
        } catch (e) {}
      });
      // Aguarda o processamento de rede de segundo plano
      logCallback(chalk.gray("⏳ Aguardando 5 segundos para estabilização do cache de fotos..."));
      await new Promise(resolve => setTimeout(resolve, 5000));
    } catch (err) {
      logCallback(chalk.gray("⚠️ Falha não fatal ao pré-carregar chats de grupos."));
    }

    // Usando Map para garantir a unicidade de participantes
    const uniqueParticipants = new Map();

    for (const group of groups) {
      logCallback(chalk.gray(`  • Lendo membros do grupo: ${chalk.cyan(group.name)}...`));
      const participants = group.participants || [];
      
      for (const p of participants) {
        const jid = p.id._serialized;
        if (jid && !uniqueParticipants.has(jid)) {
          uniqueParticipants.set(jid, p);
        }
      }
    }

    const totalToProcess = uniqueParticipants.size;
    logCallback(chalk.green(`\n🎯 Total de participantes únicos encontrados: ${chalk.bold(totalToProcess)}\n`));

    if (totalToProcess === 0) {
      logCallback(chalk.yellow("⚠️ Nenhum participante válido encontrado para processamento."));
      return;
    }

    // Processamento concorrente controlado anti rate-limit
    const limit = 2; 
    const participantsList = Array.from(uniqueParticipants.values());
    let processedCount = 0;
    let successCount = 0;
    let errorCount = 0;

    logCallback(chalk.blue(`🚀 Iniciando o processamento em lotes de ${limit} com delay anti rate-limit...`));

    const processParticipant = async (participant) => {
      const jid = participant.id._serialized;
      
      try {
        // Atraso de espaçamento humano para evitar rate limit de busca de fotos no servidor
        await new Promise(resolve => setTimeout(resolve, 1500));

        // 1. Obter informações de perfil público
        const contact = await withTimeout(client.getContactById(jid), 3000, null);
        
        let publicName = "Sem Nome";
        if (contact) {
          publicName = contact.pushname || contact.name || contact.verifiedName || contact.formattedName || "Sem Nome";
        }
        
        const formattedName = formatName(publicName);

        // 2. Obter foto de perfil pública com a estratégia nativa e robusta do projeto
        let photoUrl = null;
        try {
          const { getProfilePhoto } = require("./photoService");
          photoUrl = await getProfilePhoto(client, jid);
        } catch (e) {
          // Ignora silenciosamente erros de foto
        }

        // 3. Salvar na tabela passageiros do Supabase
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

        if (error) throw error;

        successCount++;
        const photoIndicator = photoUrl ? chalk.green("📸 Foto") : chalk.yellow("❌ Sem Foto");
        logCallback(
          chalk.green(
            `[${++processedCount}/${totalToProcess}] Sincronizado: ` +
              `${chalk.bold(formattedName)} (${chalk.gray(jid)}) [${photoIndicator}]`
          )
        );
      } catch (err) {
        errorCount++;
        logCallback(
          chalk.red(
            `❌ [${++processedCount}/${totalToProcess}] Erro ao processar ${jid}: ${err.message}`
          )
        );
      }
    };

    // Gerenciador de concorrência ativa
    const queue = [...participantsList];
    const activePromises = [];

    while (queue.length > 0 || activePromises.length > 0) {
      while (activePromises.length < limit && queue.length > 0) {
        const item = queue.shift();
        const promise = processParticipant(item).then(() => {
          activePromises.splice(activePromises.indexOf(promise), 1);
        });
        activePromises.push(promise);
      }
      
      if (activePromises.length > 0) {
        await Promise.race(activePromises);
      }
    }

    logCallback(chalk.cyan.bold("\n=== RESUMO DO PROCESSAMENTO ==="));
    logCallback(chalk.green(`✓ Sincronizados com sucesso: ${successCount}`));
    logCallback(chalk.red(`✗ Falhas no processamento: ${errorCount}`));
    logCallback(chalk.cyan.bold("===============================\n"));

  } catch (error) {
    logCallback(chalk.red("💥 Ocorreu um erro fatal durante a sincronização: " + error.message));
  }
}

module.exports = { sincronizarParticipantes };
