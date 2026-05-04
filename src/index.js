require("dotenv").config({ quiet: true }); // Carrega variáveis de ambiente do .env
process.removeAllListeners("warning");

const { Client, LocalAuth } = require("whatsapp-web.js");
const qrcode = require("qrcode-terminal");
const chalk = require("chalk");
const dashboard = require("./services/dashboard");
const cronJob = require("./services/cron-job");
const statistics = require("./services/statistics");
const { startServer } = require("./server");

async function startBot() {
  dashboard.setStatus("Processando inicialização...");
  dashboard.addLog("Preparando cliente WhatsApp via whatsapp-web.js");

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
    dashboard.addLog("Bot conectado com sucesso!");
    dashboard.setQrCode(""); // Limpa QR

    // Inicia o cronJob com a instância do client
    cronJob.scheduleJob(client);
    cronJob.checkMissedSends(client);

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
    
    // Aguarda um momento antes de buscar histórico pesado
    setTimeout(() => {
      syncConversationHistory(client).catch((err) => {
        dashboard.addLog(`Erro ao baixar histórico de conversas: ${err.message}`);
      });
    }, 10000);
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

        dashboard.addLog(
          `${chalk.gray(`${voterName || vote.voter} fez o seu registro:`)} ${coloredOption}`,
        );
      } else {
        dashboard.addLog(
          chalk.gray(`Registro de ${voterName || vote.voter} foi removido.`),
        );
      }
    } catch (error) {
      dashboard.addLog(`Erro ao computar voto: ${error.message}`);
    }
  });

  client.on("message_create", async (msg) => {
    try {
      const fs = require("fs");
      const path = require("path");
      
      const configPath = path.resolve(__dirname, "../config/config.json");
      if (!fs.existsSync(configPath)) return;
      
      const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
      const targetNumbers = config.saveConversationsWith || [];

      if (targetNumbers.length > 0) {
        const remoteJid = msg.fromMe ? msg.to : msg.from;
        if (!remoteJid) return;
        
        // Verifica se o número (com ou sem o 9º dígito) bate com a mensagem
        const match = targetNumbers.find((num) => {
          const possibleJids = getPossibleJids(num);
          return possibleJids.includes(remoteJid);
        });
        
        if (match) {
          const contactAliases = config.contactAliases || {};
          const alias = contactAliases[match] || match;
          
          const timestamp = new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });
          const sender = msg.fromMe ? "Eu" : alias;
          
          let content = msg.body;
          if (msg.hasMedia) {
             content = `[Mídia] ${msg.body || ''}`;
          }
          
          const logLine = `[${timestamp}] ${sender}: ${content}\n`;
          
          const logsDir = path.resolve(__dirname, "../conversations");
          if (!fs.existsSync(logsDir)) {
            fs.mkdirSync(logsDir, { recursive: true });
          }
          
          const cleanMatch = match.replace(/\D/g, "");
          const fileName = `${cleanMatch}.txt`;
          fs.appendFileSync(path.join(logsDir, fileName), logLine);
        }
      }
    } catch (e) {
      dashboard.addLog(`Erro ao salvar conversa: ${e.message}`);
    }
  });

  client.on("authenticated", () => {
    dashboard.addLog("Autenticação preservada. Sessão já aberta!");
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

/**
 * Função utilitária para lidar com a ausência/presença do 9º dígito 
 * em números brasileiros. Retorna possíveis JIDs.
 */
function getPossibleJids(numStr) {
  const clean = numStr.replace(/\D/g, "");
  let jids = [`${clean}@c.us`];
  if (clean.startsWith("55") && clean.length === 13) {
    const without9 = clean.slice(0, 4) + clean.slice(5);
    jids.push(`${without9}@c.us`);
  } else if (clean.startsWith("55") && clean.length === 12) {
    const with9 = clean.slice(0, 4) + "9" + clean.slice(4);
    jids.push(`${with9}@c.us`);
  }
  return jids;
}

/**
 * Baixa o histórico de mensagens dos números configurados caso o arquivo
 * de log ainda não exista localmente.
 */
async function syncConversationHistory(client) {
  const fs = require("fs");
  const path = require("path");
  
  const configPath = path.resolve(__dirname, "../config/config.json");
  if (!fs.existsSync(configPath)) return;
  
  const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
  const targetNumbers = config.saveConversationsWith || [];
  const contactAliases = config.contactAliases || {};

  if (targetNumbers.length === 0) return;

  const logsDir = path.resolve(__dirname, "../conversations");
  if (!fs.existsSync(logsDir)) {
    fs.mkdirSync(logsDir, { recursive: true });
  }

  const allChats = await client.getChats().catch(() => []);

  for (const num of targetNumbers) {
    try {
      const cleanNum = num.replace(/\D/g, "");
      const fileName = `${cleanNum}.txt`;
      const filePath = path.join(logsDir, fileName);
      
      // Só baixa o histórico se o arquivo ainda não existir
      if (!fs.existsSync(filePath)) {
        dashboard.addLog(`Baixando histórico de conversas com ${num}...`);
        
        const possibleJids = getPossibleJids(num);
        let chat = allChats.find(c => possibleJids.includes(c.id._serialized));
        
        if (!chat) {
          for (const pJid of possibleJids) {
            chat = await client.getChatById(pJid).catch(() => null);
            if (chat && chat.timestamp) break; // achou um chat válido (não fantasma)
          }
        }

        if (chat) {
          const chatId = chat.id._serialized;
          let messages = [];
          try {
            const result = await client.pupPage.evaluate(async (cId) => {
              const log = [];
              const Store = window.Store;
              const chatObj = Store.Chat.get(cId);
              
              if (!chatObj) return { msgs: [], log: ['Chat nao encontrado: ' + cId] };
              if (!chatObj.msgs) return { msgs: [], log: ['chatObj.msgs e undefined'] };
              
              // Tenta abrir o chat para inicializar
              try {
                if (Store.Cmd && typeof Store.Cmd.openChatAt === 'function') {
                  await Store.Cmd.openChatAt(chatObj);
                  await new Promise(r => setTimeout(r, 2000));
                  log.push('openChatAt ok. msgs apos: ' + chatObj.msgs.length);
                }
              } catch(e) { log.push('openChatAt erro: ' + e.message); }
              
              // Busca e corrige waitForChatLoading em todos os modulos do Store
              for (const key of Object.keys(Store)) {
                try {
                  const mod = Store[key];
                  if (mod && typeof mod === 'object' && !Array.isArray(mod)) {
                    if (mod.loadEarlierMsgs || mod.fetchMessages || mod.getMessages) {
                      if (!mod.waitForChatLoading) {
                        mod.waitForChatLoading = () => Promise.resolve();
                        log.push('patch: Store.' + key);
                      }
                    }
                  }
                } catch(_) {}
              }
              // Tambem tenta direto no chat e na colecao de msgs
              try { if (!chatObj.waitForChatLoading) chatObj.waitForChatLoading = () => Promise.resolve(); } catch(_) {}
              try { if (!chatObj.msgs.waitForChatLoading) chatObj.msgs.waitForChatLoading = () => Promise.resolve(); } catch(_) {}
              
              // Loga metodos do proto de chatObj.msgs
              try {
                const proto = Object.getPrototypeOf(chatObj.msgs);
                const protoKeys = Object.getOwnPropertyNames(proto).filter(k => typeof chatObj.msgs[k] === 'function');
                log.push('msgs fns: ' + protoKeys.join(','));
              } catch(e) { log.push('msgs fns erro: ' + e.message); }
              
              // Tenta loadMsgsPromiseLoop como alternativa
              let attempts = 0;
              while (attempts < 20) {
                const before = chatObj.msgs.length;
                try {
                  if (typeof Store.ConversationMsgs.loadMsgsPromiseLoop === 'function') {
                    await Store.ConversationMsgs.loadMsgsPromiseLoop(chatObj.msgs);
                  } else {
                    log.push('loadMsgsPromiseLoop nao encontrado');
                    break;
                  }
                } catch(e) {
                  log.push('loop[' + attempts + '] erro: ' + e.message);
                  break;
                }
                await new Promise(r => setTimeout(r, 1000));
                const after = chatObj.msgs.length;
                log.push('loop[' + attempts + ']: ' + before + ' -> ' + after);
                if (after <= before) break;
                attempts++;
              }
              
              // Extrai mensagens
              try {
                const msgs = chatObj.msgs.getModelsArray().map(m => ({
                  timestamp: m.t,
                  fromMe: m.id ? m.id.fromMe : false,
                  body: m.body || m.caption || m.text || '',
                  hasMedia: !!(m.isMedia || m.mediaData)
                }));
                return { msgs, log };
              } catch(e) {
                return { msgs: [], log: [...log, 'getModelsArray erro: ' + e.message] };
              }
            }, chatId);
            
            // Exibe log do evaluate no dashboard (uma linha por entrada)
            if (result.log && result.log.length > 0) {
              result.log.forEach(entry => dashboard.addLog(`[Debug] ${entry.slice(0, 300)}`));
            }
            
            messages = result.msgs || [];
          } catch (e) {
            dashboard.addLog(`Erro ao extrair mensagens: ${e.message.slice(0, 120)}`);
          }

          let historyContent = "";
          const alias = contactAliases[num] || num;
          
          for (const msg of messages) {
            const timestamp = new Date(msg.timestamp * 1000).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });
            const sender = msg.fromMe ? "Eu" : alias;
            
            let content = msg.body;
            if (msg.hasMedia) {
               content = `[Mídia] ${msg.body || ""}`;
            }
            
            historyContent += `[${timestamp}] ${sender}: ${content}\n`;
          }
          
          fs.writeFileSync(filePath, historyContent);
          dashboard.addLog(`Histórico de ${num} salvo com sucesso (${messages.length} mensagens).`);
        } else {
          dashboard.addLog(`Chat ${num} não encontrado para baixar histórico.`);
        }
      }
    } catch (e) {
      dashboard.addLog(`Erro ao baixar histórico de ${num}: ${e.message}`);
    }
  }
}

// Inicia Dashboard no terminal
dashboard.render();
startServer();
startBot();
