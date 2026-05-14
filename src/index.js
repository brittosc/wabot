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
      // Tenta obter o nome do contato e a foto para auto-registro
      let voterName = null;
      let photoUrl = null;
      try {
        const contact = await client.getContactById(vote.voter);
        voterName = contact.pushname || contact.name || "Desconhecido";
        
        // Tenta o método direto do contato primeiro
        photoUrl = await contact.getProfilePicUrl().catch(() => null);
        dashboard.addLog(`[DEBUG] Foto 1 (contact.getProfilePicUrl): ${photoUrl ? 'Sucesso' : 'Falha'}`);
        
        // Se falhou e for LID, tenta converter para JID real (c.us)
        if (!photoUrl && vote.voter.includes("@lid")) {
          if (contact.number) {
            const jid = `${contact.number}@c.us`;
            dashboard.addLog(`[DEBUG] Tentando JID convertido: ${jid}`);
            photoUrl = await client.getProfilePicUrl(jid).catch(() => null);
            dashboard.addLog(`[DEBUG] Foto 2 (JID convertido): ${photoUrl ? 'Sucesso' : 'Falha'}`);
          } else {
            dashboard.addLog(`[DEBUG] LID sem número detectado: ${vote.voter}`);
          }
        }

        // Se ainda falhou, tenta o pupPage evaluate como último recurso
        if (!photoUrl) {
          try {
            photoUrl = await client.pupPage.evaluate(async (jidStr) => {
              try {
                const Store = window.Store;
                if (!Store || !Store.WidFactory) return "ERR_NO_STORE";
                const wid = Store.WidFactory.createWid(jidStr);
                
                // Força requisição ao servidor
                if (Store.ProfilePic && Store.ProfilePic.requestProfilePicFromServer) {
                  await Store.ProfilePic.requestProfilePicFromServer(wid);
                }
                
                await new Promise(resolve => setTimeout(resolve, 2500)); // 2.5s
                
                const contactObj = Store.Contact.get(wid);
                if (contactObj && contactObj.profilePicThumbObj) {
                  const p = contactObj.profilePicThumbObj;
                  return p.imgFull || p.eurl || p.img || null;
                }
                
                const pic = await Store.ProfilePic.profilePicFind(wid);
                if (pic) return pic.eurl || pic.img || null;
                
                return null;
              } catch (e) { return "ERR_" + e.message; }
            }, vote.voter);
            
            if (photoUrl && photoUrl.startsWith("ERR_")) {
              dashboard.addLog(`[DEBUG] Erro no Puppeteer: ${photoUrl}`);
              photoUrl = null;
            }
            dashboard.addLog(`[DEBUG] Foto 3 (Puppeteer): ${photoUrl ? 'Sucesso' : 'Falha'}`);
          } catch (e) {
            dashboard.addLog(`[DEBUG] Erro ao avaliar Puppeteer: ${e.message}`);
          }
        }

        if (photoUrl) {
          dashboard.addLog(chalk.cyan(`[FOTO] Foto obtida para ${voterName}`));
        } else {
          // dashboard.addLog(chalk.yellow(`[FOTO] Foto indisponível para ${voterName} (${vote.voter})`));
        }
      } catch (e) {
        dashboard.addLog(
          `Aviso: Não foi possível obter dados de ${vote.voter}: ${e.message}`,
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
        const currentName = voterName || vote.voter;
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

  const stats = await statistics.readStats();
  const rawDB = stats.rawDB || {};

  // Coleta IDs únicos dos votos
  const voterIds = new Set();
  Object.values(rawDB).forEach((day) => {
    if (day.grupos) {
      Object.values(day.grupos).forEach((group) => {
        if (group.votes) {
          Object.keys(group.votes).forEach((id) => voterIds.add(id));
        }
      });
    }
  });

  let count = 0;
  let skipped = 0;
  let errors = 0;

  for (const id of voterIds) {
    try {
      if (!id || !id.includes("@")) {
        skipped++;
        continue;
      }

      let photoUrl = null;
      let voterName = "Desconhecido";
      try {
        const contact = await client.getContactById(id);
        voterName = contact.pushname || contact.name || "Desconhecido";
        
        photoUrl = await contact.getProfilePicUrl().catch(() => null);

        if (!photoUrl && id.includes("@lid") && contact.number) {
          const jid = `${contact.number}@c.us`;
          photoUrl = await client.getProfilePicUrl(jid).catch(() => null);
        }

        if (!photoUrl) {
          photoUrl = await client.pupPage.evaluate(async (jidStr) => {
            try {
              const Store = window.Store;
              if (!Store || !Store.WidFactory) return null;
              const wid = Store.WidFactory.createWid(jidStr);
              if (Store.ProfilePic && Store.ProfilePic.requestProfilePicFromServer) {
                await Store.ProfilePic.requestProfilePicFromServer(wid);
              }
              await new Promise(resolve => setTimeout(resolve, 1500));
              const contactObj = Store.Contact.get(wid);
              if (contactObj && contactObj.profilePicThumbObj) {
                return contactObj.profilePicThumbObj.eurl || contactObj.profilePicThumbObj.img || null;
              }
              const pic = await Store.ProfilePic.profilePicFind(wid);
              return pic ? (pic.eurl || pic.img) : null;
            } catch (e) { return null; }
          }, id);
        }
      } catch (ce) {
        /* ignora */
      }

      if (photoUrl) {
        await statistics.syncPassengerMetadata(id, voterName, photoUrl);
        count++;
      }

      await new Promise((resolve) => setTimeout(resolve, 500));
    } catch (err) {
      errors++;
    }
  }
}

// Inicia Dashboard no terminal
dashboard.render();
startServer();
startBot();
