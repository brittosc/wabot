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

            // 1. Verifica se já está no cache local para evitar delay desnecessário
            const contactObj = Contacts ? Contacts.get(wid) : null;
            if (contactObj) {
              const p = contactObj.profilePicThumb || contactObj.__x_profilePicThumb;
              if (p && (p.__x_imgFull || p.__x_img || p.imgFull || p.img)) {
                return p.__x_imgFull || p.__x_img || p.imgFull || p.img || null;
              }
            }

            // 2. Dispara requisição ao servidor de mídia do WhatsApp passando o objeto de contato
            let netRes = null;
            if (contactObj) {
              if (Store.ProfilePic && Store.ProfilePic.requestProfilePicFromServer) {
                netRes = await Store.ProfilePic.requestProfilePicFromServer(contactObj).catch(() => null);
              } else if (Store.ProfilePic && Store.ProfilePic.profilePicResync) {
                netRes = await Store.ProfilePic.profilePicResync(contactObj).catch(() => null);
              }
            } else {
              if (Store.ProfilePic && Store.ProfilePic.requestProfilePicFromServer) {
                netRes = await Store.ProfilePic.requestProfilePicFromServer(wid).catch(() => null);
              } else if (Store.ProfilePic && Store.ProfilePic.profilePicResync) {
                netRes = await Store.ProfilePic.profilePicResync(wid).catch(() => null);
              }
            }

            // Retorna imediatamente se a rede devolveu o link direto
            if (netRes && (netRes.eurl || netRes.previewEurl)) {
              return netRes.eurl || netRes.previewEurl;
            }

            // DELAY CRÍTICO DE 2 SEGUNDOS na página apenas se fomos buscar da rede
            await new Promise(resolve => setTimeout(resolve, 2000));

            // 3. Lê o contato atualizado
            const updatedContact = Contacts ? Contacts.get(wid) : null;
            if (updatedContact) {
              const p = updatedContact.profilePicThumb || updatedContact.__x_profilePicThumb;
              if (p) {
                return p.__x_imgFull || p.__x_img || p.imgFull || p.img || null;
              }
            }

            // Fallback de última instância para o próprio bot (lê a imagem do cabeçalho de perfil no DOM)
            if (Store.Conn && Store.Conn.wid && (Store.Conn.wid._serialized === jidStr || Store.Conn.wid.user === jidStr.split('@')[0])) {
              const myHeaderImg = document.querySelector('header img') || document.querySelector('div[title="Foto do perfil"] img') || document.querySelector('div[title="Profile photo"] img');
              if (myHeaderImg && myHeaderImg.src && (myHeaderImg.src.includes('http') || myHeaderImg.src.includes('blob'))) {
                return myHeaderImg.src;
              }
              const thumb = Store.Conn.profilePicThumb || Store.Conn.__x_profilePicThumb;
              if (thumb) {
                return thumb.__x_imgFull || thumb.__x_img || thumb.eurl || thumb.img || thumb.eurlFull || thumb.imgFull || null;
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

    // Foco Total no Bot: Tenta obter e printar a foto do próprio bot repetidamente a cada 5s
    const botInterval = setInterval(async () => {
      try {
        if (!client.info || !client.info.wid) return;
        const botJid = client.info.wid._serialized;
        
        // 1. Tenta obter pelo resolvedor avançado
        const botInfo = await resolveContactInfo(client, botJid);
        if (botInfo.photoUrl) {
          dashboard.addLog(`[FOTO BOT] FOTO ENCONTRADA VIA RESOLVER! 🎉 URL: ${botInfo.photoUrl.substring(0, 80)}...`);
          
          // Grava a foto do próprio bot no Supabase de forma segura
          try {
            await supabase
              .from("passengers")
              .update({ photo_url: botInfo.photoUrl })
              .eq("phone", botJid.split('@')[0]);
          } catch (dbErr) {
            dashboard.addLog(`[FOTO BOT] Erro ao gravar foto no Supabase: ${dbErr.message}`);
          }

          clearInterval(botInterval);

          // Iniciamos a sincronização dos membros dos grupos agora que o bot já foi resolvido com sucesso!
          syncRecentPhotos(client).catch((err) => {
            dashboard.addLog(`[SYNC FOTO] Erro na sincronização inicial de fotos: ${err.message}`);
          });

          return;
        }

        dashboard.addLog(`[FOTO BOT] Buscando... JID: ${botJid}`);

        // 2. Diagnóstico de coleções de mídia no Store
        const storePicKeys = await client.pupPage.evaluate(() => {
          const Store = window.Store;
          if (!Store) return "Sem Store";
          return Object.keys(Store).filter(k => k.toLowerCase().includes("profilepic") || k.toLowerCase().includes("thumb"));
        }).catch((e) => e.message);
        dashboard.addLog(`[DIAG STORE PIC] Coleções: ${JSON.stringify(storePicKeys)}`);

        // 3. Execução direta e captura de retorno das Promises de rede passando o contato correto do Backbone
        const serverResponse = await client.pupPage.evaluate(async (jidStr) => {
          try {
            const Store = window.Store;
            if (!Store || !Store.ProfilePic) return "Sem ProfilePic no Store";
            const wid = Store.WidFactory.createWid(jidStr);
            const Contacts = Store.Contact || Store.ContactCollection;
            const contactObj = Contacts ? Contacts.get(wid) : null;
            if (!contactObj) return "Contato do bot não encontrado no cache";
            
            if (Store.ProfilePic.requestProfilePicFromServer) {
              const res = await Store.ProfilePic.requestProfilePicFromServer(contactObj);
              return { method: "requestProfilePicFromServer", raw: res };
            }
            if (Store.ProfilePic.profilePicResync) {
              const res = await Store.ProfilePic.profilePicResync(contactObj);
              return { method: "profilePicResync", raw: res };
            }
            return "Sem método de rede";
          } catch (e) {
            return { error: e.message };
          }
        }, botJid).catch((e) => ({ error: e.message }));
        dashboard.addLog(`[DIAG SERVER RES] Retorno: ${JSON.stringify(serverResponse)}`);

        // 4. Varredura irrestrita de todas as tags img do DOM (captura blobs e avatares locais)
        const allDomImages = await client.pupPage.evaluate(() => {
          const imgs = Array.from(document.querySelectorAll("img"));
          return imgs.map(img => ({
            src: img.src.substring(0, 100) + (img.src.length > 100 ? "..." : ""),
            alt: img.alt || "Sem alt",
            tagName: img.tagName
          }));
        }).catch(() => []);
        dashboard.addLog(`[DIAG DOM IMGS] Total imgs no HTML: ${allDomImages.length} | URLs: ${JSON.stringify(allDomImages)}`);
      } catch (e) {
        dashboard.addLog(`[FOTO BOT] Erro no loop de foco: ${e.message}`);
      }
    }, 5000);

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

    // A sincronização dos membros dos grupos agora é disparada automaticamente assim que a foto do BOT é resolvida.

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

    const batchSize = 5;
    const idsArray = Array.from(voterIds);

    for (let i = 0; i < idsArray.length; i += batchSize) {
      const batch = idsArray.slice(i, i + batchSize);
      await Promise.all(
        batch.map(async (id) => {
          try {
            if (!id || !id.includes("@")) {
              skipped++;
              return;
            }

            const contactInfo = await resolveContactInfo(client, id);
            const name = formatName(contactInfo.name) || "Desconhecido";
            const photoUrl = contactInfo.photoUrl;

            if (photoUrl) {
              // 1. Atualiza metadados na tabela passengers se o passageiro existir
              await statistics.syncPassengerMetadata(id, name, photoUrl).catch(() => null);
              
              // 2. Atualiza retroativamente a foto em todas as linhas de votos históricos dele
              await supabase
                .from("votes")
                .update({ photo_url: photoUrl })
                .eq("voter_id", id)
                .catch(() => null);

              count++;
              dashboard.addLog(
                `[SYNC FOTO] Foto obtida para ${name} (${id.split('@')[0]}): ${photoUrl.substring(0, 60)}...`
              );
            } else {
              semFoto++;
            }
          } catch (err) {
            errors++;
            dashboard.addLog(`[SYNC FOTO ERR] ID: ${id.split('@')[0]} | Erro: ${err.message}`);
          }
        })
      );
      // Breve pausa para respiro de rede e do Puppeteer entre os lotes
      await new Promise((resolve) => setTimeout(resolve, 800));
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
