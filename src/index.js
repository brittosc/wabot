require("dotenv").config({ quiet: true }); // Carrega variáveis de ambiente do .env
process.removeAllListeners("warning");

const { Client, LocalAuth } = require("whatsapp-web.js");
const qrcode = require("qrcode-terminal");
const chalk = require("chalk");
const dashboard = require("./services/dashboard");
const cronJob = require("./services/cron-job");
const statistics = require("./services/statistics");
const configService = require("./services/configService");
const { startServer } = require("./server");
const { formatName } = require("./utils/nameFormatter");
const supabase = require("./database/supabaseClient");

/**
 * Tenta resolver informações de contato (nome e foto) de forma robusta,
 * lidando inclusive com endereços @lid e novos membros de grupo.
 */
async function resolveContactInfo(client, voterId) {
  let name = null;
  let photoUrl = null;
  let jid = voterId;

  try {
    // 1. Tenta obter o contato básico para extrair o Nome e JID real
    const contact = await client.getContactById(voterId).catch(() => null);
    if (contact) {
      name = contact.pushname || contact.name;
      if (contact.number) {
        jid = `${contact.number}@c.us`;
      } else if (contact.id && contact.id._serialized) {
        jid = contact.id._serialized;
      }
      
      // Tenta obter a foto direto do contato
      photoUrl = await contact.getProfilePicUrl().catch(() => null);
    }

    // 2. Se falhou e for LID, tenta converter para JID real (c.us) e buscar foto
    if (!photoUrl && (voterId.includes("@lid") || jid.includes("@lid"))) {
      try {
        const contactObj = contact || await client.getContactById(voterId).catch(() => null);
        if (contactObj) {
          const contactNumber = contactObj.number || (contactObj.id && contactObj.id.user);
          if (contactNumber && !contactNumber.includes("@")) {
            const realJid = `${contactNumber}@c.us`;
            try { await client.getChatById(realJid); } catch (e) {}
            photoUrl = await client.getProfilePicUrl(realJid).catch(() => null);
            if (photoUrl) jid = realJid;
          }
        }
      } catch (e) {}
    }

    // 3. Fallback via Puppeteer/Store avançado com delay de 2 segundos para requisição de rede
    if (!photoUrl) {
      try {
        photoUrl = await client.pupPage.evaluate(async (jidStr) => {
          try {
            const Store = window.Store;
            if (!Store) return null;

            const WidFactory = Store.WidFactory || (Store.Wid && Store.Wid.WidFactory);
            if (!WidFactory) return null;

            const wid = WidFactory.createWid(jidStr);
            const Contacts = Store.Contact || Store.ContactCollection;

            if (Store.ProfilePic && Store.ProfilePic.requestProfilePicFromServer) {
              await Store.ProfilePic.requestProfilePicFromServer(wid).catch(() => null);
            } else if (Store.ProfilePic && Store.ProfilePic.profilePicResync) {
              await Store.ProfilePic.profilePicResync(wid).catch(() => null);
            }

            // DELAY CRÍTICO DE 2 SEGUNDOS na página para a rede responder e gravar no cache!
            await new Promise(resolve => setTimeout(resolve, 2000));

            const contactObj = Contacts ? Contacts.get(wid) : null;
            if (contactObj) {
              const p = contactObj.profilePicThumb || contactObj.__x_profilePicThumb;
              if (p) {
                return p.imgFull || p.eurl || p.img || null;
              }
            }

            // Fallback de última instância para o próprio bot
            if (Store.Conn && Store.Conn.wid && (Store.Conn.wid._serialized === jidStr || Store.Conn.wid.user === jidStr.split('@')[0])) {
              const thumb = Store.Conn.profilePicThumb || Store.Conn.__x_profilePicThumb;
              if (thumb) {
                return thumb.eurl || thumb.img || thumb.eurlFull || thumb.imgFull || null;
              }
            }

            return null;
          } catch (e) {
            return null;
          }
        }, jid || voterId);
      } catch (e) {}
    }

    // 4. Última tentativa oficial com ID original
    if (!photoUrl) {
      photoUrl = await client.getProfilePicUrl(jid || voterId).catch(() => null);
    }
  } catch (err) {
    /* erro silencioso */
  }

  // Preenche retornos adicionais de fallback se necessário
  if (photoUrl && !name) {
    try {
      const contactObj = await client.getContactById(voterId).catch(() => null);
      if (contactObj) name = contactObj.pushname || contactObj.name;
    } catch (e) {}
  }

  return { name, photoUrl, jid };
}

async function startBot() {
  dashboard.setStatus("Processando inicialização...");

  const client = new Client({
    authStrategy: new LocalAuth({ dataPath: "./auth_info" }),
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
    qrcode.generate(qr, { small: true }, function (qrcodeStr) {
      dashboard.setQrCode(qrcodeStr);
      dashboard.setStatus("Aguardando escaneamento do QR Code...");
    });
    dashboard.addLog("Novo QR Code gerado.");
  });

  client.on("ready", async () => {
    dashboard.setStatus("Conectado!");
    dashboard.setQrCode(""); // Limpa QR

    // Diagnóstico: Tenta obter e printar a foto do próprio bot no console do terminal com 3s de delay resiliente
    setTimeout(async () => {
      try {
        const botJid = client.info.wid._serialized;
        const botInfo = await resolveContactInfo(client, botJid);
        dashboard.addLog(
          `[FOTO BOT] JID: ${botJid} | Foto: ${botInfo.photoUrl ? botInfo.photoUrl.substring(0, 80) + '...' : "Nenhuma/Não encontrada"}`
        );

        // Diagnóstico avançado: Inspeciona métodos de ProfilePic e chaves de Conn do bot logado
        const info = await client.pupPage.evaluate(() => {
          const Store = window.Store;
          if (!Store) return { error: "Store inexistente" };
          return {
            methods: Store.ProfilePic ? Object.keys(Store.ProfilePic) : "ProfilePic inexistente",
            connPicKeys: Store.Conn ? Object.keys(Store.Conn) : "Conn inexistente"
          };
        }).catch((e) => ({ error: e.message }));
        
        dashboard.addLog(`[DIAG PROFILEPIC] Métodos disponíveis: ${JSON.stringify(info.methods)}`);
        dashboard.addLog(`[DIAG CONN KEYS] Conn Keys: ${JSON.stringify(info.connPicKeys)}`);

        // Diagnóstico de objeto de contato
        const contactKeys = await client.pupPage.evaluate((jidStr) => {
          const Store = window.Store;
          if (!Store) return "Sem Store";
          const Contacts = Store.Contact || Store.ContactCollection;
          if (!Contacts) return "Sem coleção de contatos";
          const wid = Store.WidFactory.createWid(jidStr);
          const contact = Contacts.get(wid);
          if (!contact) return "Contato não encontrado no cache";
          
          return {
            keys: Object.keys(contact),
            profilePicThumbObjKeys: contact.__x_profilePicThumb ? Object.keys(contact.__x_profilePicThumb) : "Inexistente",
            profilePicThumbObjVal: contact.__x_profilePicThumb ? {
              eurl: contact.__x_profilePicThumb.eurl || null,
              img: contact.__x_profilePicThumb.img || null,
              imgFull: contact.__x_profilePicThumb.imgFull || null
            } : "Inexistente"
          };
        }, botJid).catch((e) => e.message);
        
        dashboard.addLog(`[DIAG CONTACT] Keys: ${JSON.stringify(contactKeys)}`);
      } catch (e) {
        dashboard.addLog(`[FOTO BOT] Erro no diagnóstico: ${e.message}`);
      }
    }, 3000);

    // Garante que o agendamento e o check só ocorram uma única vez
    if (!global.isInitialized) {
      cronJob.scheduleJob(client);
      cronJob.checkMissedSends(client);
      cronJob.syncTotalSent(); // Sincroniza total de enquetes do Supabase
      global.isInitialized = true;
    } else {
      dashboard.addLog("Serviços já inicializados anteriormente.");
    }

    // Atualiza ocupação inicial no terminal
    const currentStats = await statistics.readStats();
    await statistics.updateTerminalOccupancy(currentStats);

    // Sincroniza fotos de quem votou recentemente (últimos 7 dias)
    syncRecentPhotos(client).catch((err) => {
      dashboard.addLog(
        `Erro na sincronização inicial de fotos: ${err.message}`,
      );
    });

    if (process.argv.includes("--now")) {
      dashboard.addLog("Parâmetro --now detectado. Forçando envio imediato 🎉");
      cronJob.sendPolls(client);
    }
  });

  client.on("vote_update", async (vote) => {
    try {
      // Tenta obter o nome do contato e a foto para auto-registro de forma robusta
      let voterName = null;
      let photoUrl = null;
      
      const contactInfo = await resolveContactInfo(client, vote.voter);
      voterName = formatName(contactInfo.name);
      photoUrl = contactInfo.photoUrl;

      if (!voterName && !vote.voter.includes('@lid')) {
        dashboard.addLog(
          `Aviso: Não foi possível obter dados de ${vote.voter}`,
        );
      }

      await statistics.registerVote(vote, voterName, photoUrl);

      let groupName = "Desconhecida";
      try {
        if (vote.parentMessage) {
          const chat = await vote.parentMessage.getChat();
          if (chat && chat.name) groupName = chat.name;
        }
      } catch (e) {}

      const selectedOption =
        vote.selectedOptions && vote.selectedOptions.length > 0
          ? vote.selectedOptions[0].name
          : null;

      if (selectedOption) {
        let coloredOption = selectedOption;
        if (selectedOption === "Irei, ida e volta.") {
          coloredOption = chalk.green(selectedOption);
        } else if (selectedOption === "Irei, mas não retornarei.") {
          coloredOption = chalk.blue(selectedOption);
        } else if (selectedOption === "Não irei, apenas retornarei.") {
          coloredOption = chalk.hex("#FFA500")(selectedOption);
        } else if (selectedOption === "Não irei à faculdade hoje.") {
          coloredOption = chalk.red(selectedOption);
        }

        const firstName = voterName ? voterName.split(' ')[0] : 'Alguém';
        
        const config = configService.getConfig();
        const highlightNames = config.highlightNames || [];
        const currentName = voterName || (vote.voter.includes('@lid') ? 'Novo Passageiro' : vote.voter);
        const shouldHighlight = highlightNames.some(name => currentName.toLowerCase().includes(name.toLowerCase()));
        
        let displayGroup = groupName;
        if (config.groupAliases && config.groupAliases[groupName]) {
          displayGroup = config.groupAliases[groupName];
        }

        const suffix = displayGroup.toLowerCase().startsWith("linha") ? "." : " linha.";

        let part1 = chalk.gray(`${currentName} fez o seu registro.`);
        let part3 = chalk.gray(`${firstName} pertence a ${displayGroup}${suffix}`);
        
        if (shouldHighlight) {
          part1 = `${chalk.bgYellow.black.bold(` ${currentName} `)}${chalk.gray(` fez o seu registro.`)}`;
          part3 = `${chalk.bgYellow.black.bold(` ${firstName} `)}${chalk.gray(` pertence a ${displayGroup}${suffix}`)}`;
        }

        dashboard.addLog(`${part1} ${coloredOption} ${part3}`);
      } else {
        dashboard.addLog(
          chalk.gray(`Registro de ${voterName || vote.voter} foi removido.`),
        );
      }
    } catch (error) {
      dashboard.addLog(`Erro ao computar voto: ${error.message}`);
    }
  });

  client.on("authenticated", () => {
    // Autenticação preservada
  });

  client.on("auth_failure", (msg) => {
    dashboard.setStatus("Erro Autenticação");
    dashboard.addLog(
      `Falha na autenticação. Limpe o diretório auth_info. Motivo: ${msg}`,
    );
  });

  client.on("disconnected", (reason) => {
    dashboard.setStatus("Desconectado");
    dashboard.addLog(`Cliente foi desconectado. Motivo: ${reason}`);
    // Tenta reinicializar o cliente após 5s
    setTimeout(() => {
      dashboard.addLog("Tentando reconexão...");
      client
        .initialize()
        .catch((e) => dashboard.addLog(`Erro ao reconectar: ${e}`));
    }, 5000);
  });

  try {
    await client.initialize();
  } catch (e) {
    dashboard.addLog(`Erro fatal no puppeteer: ${e.message}`);
  }
}

/**
 * Busca fotos de perfil para usuários que votaram nos últimos 7 dias
 * e ainda não possuem foto ou precisam de atualização.
 */
async function syncRecentPhotos(client) {
  // Delay de 5s para não brigar com as mensagens de inicialização
  await new Promise((resolve) => setTimeout(resolve, 5000));

  dashboard.addLog("[SYNC FOTO] Iniciando varredura rápida de membros dos grupos do WhatsApp...");

  try {
    const config = configService.getConfig();
    const targetGroupNames = config.targetGroups || [];

    if (targetGroupNames.length === 0) {
      dashboard.addLog("[SYNC FOTO] Nenhum grupo alvo configurado no targetGroups.");
      return;
    }

    const chats = await client.getChats().catch(() => []);
    const allGroups = chats.filter((c) => c.isGroup);

    const voterIds = new Set();

    for (const targetName of targetGroupNames) {
      const group = allGroups.find((g) => g.name === targetName);
      if (group) {
        dashboard.addLog(`[SYNC FOTO] Varrendo participantes do grupo: ${targetName}`);
        
        let participants = group.participants || [];
        if (participants.length === 0) {
          const groupChat = await client.getChatById(group.id._serialized).catch(() => null);
          if (groupChat && groupChat.participants) {
            participants = groupChat.participants;
          }
        }

        participants.forEach((p) => {
          if (p.id && p.id._serialized) {
            voterIds.add(p.id._serialized);
          }
        });
      } else {
        dashboard.addLog(`[SYNC FOTO] Grupo não encontrado nos chats ativos: ${targetName}`);
      }
    }

    if (voterIds.size === 0) {
      dashboard.addLog("[SYNC FOTO] Nenhum participante encontrado nos grupos ativos.");
      return;
    }

    dashboard.addLog(`[SYNC FOTO] Total de membros únicos identificados: ${voterIds.size}. Sincronizando fotos...`);

    let count = 0;
    let semFoto = 0;
    let skipped = 0;
    let errors = 0;

    for (const id of voterIds) {
      try {
        if (!id || !id.includes("@")) {
          skipped++;
          continue;
        }

        const contactInfo = await resolveContactInfo(client, id);
        const name = formatName(contactInfo.name) || "Desconhecido";
        const photoUrl = contactInfo.photoUrl;

        if (photoUrl) {
          // 1. Atualiza metadados na tabela passengers se o passageiro existir
          await statistics.syncPassengerMetadata(id, name, photoUrl);
          
          // 2. Atualiza retroativamente a foto em todas as linhas de votos históricos dele
          await supabase
            .from("votes")
            .update({ photo_url: photoUrl })
            .eq("voter_id", id);

          count++;
          dashboard.addLog(
            `[SYNC FOTO] Foto obtida para ${name} (${id.split('@')[0]}): ${photoUrl.substring(0, 60)}...`
          );
        } else {
          semFoto++;
        }

        await new Promise((resolve) => setTimeout(resolve, 500));
      } catch (err) {
        errors++;
      }
    }

    dashboard.addLog(
      `[SYNC FOTO] Concluído! Fotos atualizadas no banco: ${count} | Sem foto pública: ${semFoto} | Pulados: ${skipped} | Erros: ${errors}`
    );

  } catch (globalErr) {
    dashboard.addLog(`[SYNC FOTO] Erro crítico no processo de varredura: ${globalErr.message}`);
  }
}

// Inicia Dashboard no terminal
dashboard.render();
startServer();
startBot();
