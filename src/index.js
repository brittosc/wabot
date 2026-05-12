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
        const jid = (contact.id && contact.id._serialized) || vote.voter;

        try {
          photoUrl = await client.pupPage.evaluate(async (lid) => {
            try {
              const Store = window.Store;
              const wid = Store.WidFactory.createWid(lid);
              await Store.ProfilePic.requestProfilePicFromServer(wid);
              // Lê a URL do contato após o request
              const contact = Store.Contact.get(wid);
              if (contact && contact.profilePicThumbObj) {
                return (
                  contact.profilePicThumbObj.eurl ||
                  contact.profilePicThumbObj.img ||
                  null
                );
              }
              return null;
            } catch (e) {
              return null;
            }
          }, vote.voter);
        } catch (e) {
          /* silencioso */
        }
      } catch (e) {
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
        const currentName = voterName || vote.voter;
        const shouldHighlight = highlightNames.some(name => currentName.toLowerCase().includes(name.toLowerCase()));
        
        let part1 = chalk.gray(`${currentName} fez o seu registro.`);
        let part3 = chalk.gray(`${firstName} pertence a ${groupName} linha.`);
        
        if (shouldHighlight) {
          part1 = `${chalk.bgYellow.black.bold(` ${currentName} `)}${chalk.gray(` fez o seu registro.`)}`;
          part3 = `${chalk.bgYellow.black.bold(` ${firstName} `)}${chalk.gray(` pertence a ${groupName} linha.`)}`;
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

      let name = "Desconhecido";
      let jid = id;
      try {
        const contact = await client.getContactById(id);
        name = contact.pushname || contact.name || "Desconhecido";

        // Traduz LID para JID (@c.us) — client.getProfilePicUrl(@lid) retorna undefined
        if (contact.id && contact.id._serialized) {
          jid = contact.id._serialized;
        }
      } catch (ce) {
        /* ignora */
      }

      let photoUrl = null;

      try {
        photoUrl = await client.pupPage.evaluate(async (lid) => {
          try {
            const Store = window.Store;
            const wid = Store.WidFactory.createWid(lid);
            // Método correto: busca foto do servidor
            await Store.ProfilePic.requestProfilePicFromServer(wid);
            // Lê a URL do contato após o request
            const contact = Store.Contact.get(wid);
            if (contact && contact.profilePicThumbObj) {
              return (
                contact.profilePicThumbObj.eurl ||
                contact.profilePicThumbObj.img ||
                null
              );
            }
            return null;
          } catch (e) {
            return null;
          }
        }, id);
      } catch (pe) {
        /* silencioso */
      }

      if (photoUrl) {
        await statistics.syncPassengerMetadata(id, name, photoUrl);
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
