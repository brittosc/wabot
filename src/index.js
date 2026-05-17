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

  // Helper de timeout rígido para Promises no Node.js
  const withTimeout = (promise, ms, defaultValue = null) => {
    return Promise.race([
      promise,
      new Promise((resolve) => setTimeout(() => resolve(defaultValue), ms))
    ]);
  };

  try {
    // 1. Tenta buscar a foto via Puppeteer/Store avançado primeiro (100% livre de rede travante se já estiver no cache local do navegador)
    let pupRes = null;
    try {
      pupRes = await withTimeout(
        client.pupPage.evaluate(async (jidStr) => {
          try {
            const Store = window.Store;
            if (!Store) return null;

            const WidFactory = Store.WidFactory || (Store.Wid && Store.Wid.WidFactory);
            if (!WidFactory) return null;

            const wid = WidFactory.createWid(jidStr);
            const Contacts = Store.Contact || Store.ContactCollection;

            let name = null;
            let photoUrl = null;
            let realJid = jidStr;

            // A. Tenta ler o cache em memória síncrono instantaneamente
            const contactObj = Contacts ? Contacts.get(wid) : null;
            if (contactObj) {
              name = contactObj.name || contactObj.pushname || contactObj.formattedName || contactObj.displayName || null;
              if (contactObj.id && contactObj.id._serialized) {
                realJid = contactObj.id._serialized;
              }
              const p = contactObj.profilePicThumb || contactObj.__x_profilePicThumb;
              if (p && (p.__x_imgFull || p.__x_img || p.imgFull || p.img)) {
                photoUrl = p.__x_imgFull || p.__x_img || p.imgFull || p.img || null;
              }
            }

            // Se já achou a foto, retorna direto!
            if (photoUrl) {
              return { photoUrl, name, jid: realJid };
            }

            // B. Dispara consulta de mídia com timeout rígido interno de 1.2s
            let netRes = null;
            const timeoutPromise = new Promise(resolve => setTimeout(() => resolve(null), 1200));

            if (contactObj) {
              if (Store.ProfilePic && Store.ProfilePic.requestProfilePicFromServer) {
                netRes = await Promise.race([
                  Store.ProfilePic.requestProfilePicFromServer(contactObj),
                  timeoutPromise
                ]).catch(() => null);
              } else if (Store.ProfilePic && Store.ProfilePic.profilePicResync) {
                netRes = await Promise.race([
                  Store.ProfilePic.profilePicResync(contactObj),
                  timeoutPromise
                ]).catch(() => null);
              }
            } else {
              if (Store.ProfilePic && Store.ProfilePic.requestProfilePicFromServer) {
                netRes = await Promise.race([
                  Store.ProfilePic.requestProfilePicFromServer(wid),
                  timeoutPromise
                ]).catch(() => null);
              } else if (Store.ProfilePic && Store.ProfilePic.profilePicResync) {
                netRes = await Promise.race([
                  Store.ProfilePic.profilePicResync(wid),
                  timeoutPromise
                ]).catch(() => null);
              }
            }

            if (netRes && (netRes.eurl || netRes.previewEurl)) {
              photoUrl = netRes.eurl || netRes.previewEurl;
              return { photoUrl, name, jid: realJid };
            }

            // Pausa rápida de respiro se foi buscar na rede
            await new Promise(resolve => setTimeout(resolve, 500));

            const updatedContact = Contacts ? Contacts.get(wid) : null;
            if (updatedContact) {
              name = updatedContact.name || updatedContact.pushname || updatedContact.formattedName || updatedContact.displayName || name;
              if (updatedContact.id && updatedContact.id._serialized) {
                realJid = updatedContact.id._serialized;
              }
              const p = updatedContact.profilePicThumb || updatedContact.__x_profilePicThumb;
              if (p) {
                photoUrl = p.__x_imgFull || p.__x_img || p.imgFull || p.img || null;
              }
            }

            if (photoUrl) {
              return { photoUrl, name, jid: realJid };
            }

            // Fallback próprio bot
            if (Store.Conn && Store.Conn.wid && (Store.Conn.wid._serialized === jidStr || Store.Conn.wid.user === jidStr.split('@')[0])) {
              const myHeaderImg = document.querySelector('header img') || document.querySelector('div[title="Foto do perfil"] img') || document.querySelector('div[title="Profile photo"] img');
              if (myHeaderImg && myHeaderImg.src && (myHeaderImg.src.includes('http') || myHeaderImg.src.includes('blob'))) {
                photoUrl = myHeaderImg.src;
              } else {
                const thumb = Store.Conn.profilePicThumb || Store.Conn.__x_profilePicThumb;
                if (thumb) {
                  photoUrl = thumb.__x_imgFull || thumb.__x_img || thumb.eurl || thumb.img || thumb.eurlFull || thumb.imgFull || null;
                }
              }
              name = Store.Conn.pushname || name;
              return { photoUrl, name, jid: Store.Conn.wid._serialized };
            }

            return { photoUrl: null, name, jid: realJid };
          } catch (e) {
            return { photoUrl: null, name: null, jid: jidStr };
          }
        }, jid || voterId),
        2500, // Timeout rígido para o evaluate do Puppeteer inteiro
        null
      );
    } catch (e) {}

    if (pupRes) {
      if (pupRes.photoUrl) {
        photoUrl = pupRes.photoUrl;
      }
      if (pupRes.name) {
        name = pupRes.name;
      }
      if (pupRes.jid) {
        jid = pupRes.jid;
      }
    }

    // Se já encontramos a foto via Puppeteer, pulamos o Node.js pesado!
    if (!photoUrl) {
      // 2. Tenta obter o contato básico do Node.js com timeout rígido de 1.5s
      const contact = await withTimeout(
        client.getContactById(voterId),
        1500,
        null
      ).catch(() => null);

      if (contact) {
        name = name || contact.pushname || contact.name;
        if (contact.number) {
          jid = `${contact.number}@c.us`;
        } else if (contact.id && contact.id._serialized) {
          jid = contact.id._serialized;
        }
      }

      // 3. Fallback LID para converter para c.us e buscar com timeout rígido de 1.5s
      if (voterId.includes("@lid") || jid.includes("@lid")) {
        try {
          const contactObj = contact || await withTimeout(client.getContactById(voterId), 1500, null).catch(() => null);
          if (contactObj) {
            const contactNumber = contactObj.number || (contactObj.id && contactObj.id.user);
            if (contactNumber && !contactNumber.includes("@")) {
              const realJid = `${contactNumber}@c.us`;
              try { 
                await withTimeout(client.getChatById(realJid), 1200, null); 
              } catch (e) {}
              photoUrl = await withTimeout(client.getProfilePicUrl(realJid), 1500, null).catch(() => null);
              if (photoUrl) jid = realJid;
            }
          }
        } catch (e) {}
      }

      // 4. Última tentativa oficial com ID original e timeout de 1.5s
      if (!photoUrl) {
        photoUrl = await withTimeout(client.getProfilePicUrl(jid || voterId), 1500, null).catch(() => null);
      }
    }
  } catch (err) {
    /* erro silencioso */
  }

  // Preenche retornos adicionais de fallback se necessário para o nome
  if (!name) {
    try {
      const contactObj = await withTimeout(client.getContactById(voterId), 1200, null).catch(() => null);
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
 * Busca fotos de perfil para todos os membros dos grupos alvo, 1 a 1,
 * e salva na tabela passengers e retroativamente na tabela votes.
 * Usa client.getProfilePicUrl() que funciona para qualquer membro de grupo,
 * contato salvo ou não.
 */
async function syncRecentPhotos(client) {
  // Delay de 5s para não brigar com as mensagens de inicialização
  await new Promise((resolve) => setTimeout(resolve, 5000));

  dashboard.addLog("[SYNC FOTO] Iniciando varredura rica de membros dos grupos (c.us e lid)...");

  try {
    const config = configService.getConfig();
    const targetGroupNames = config.targetGroups || [];

    if (targetGroupNames.length === 0) {
      dashboard.addLog("[SYNC FOTO] Nenhum grupo alvo configurado no targetGroups.");
      return;
    }

    const chats = await client.getChats().catch(() => []);
    const allGroups = chats.filter((c) => c.isGroup);

    const targetGroupWids = [];
    for (const targetName of targetGroupNames) {
      const group = allGroups.find((g) => g.name === targetName);
      if (group) {
        targetGroupWids.push(group.id._serialized);
        dashboard.addLog(`[SYNC FOTO] Varrendo participantes do grupo: ${targetName}`);
      } else {
        dashboard.addLog(`[SYNC FOTO] Grupo não encontrado nos chats ativos: ${targetName}`);
      }
    }

    if (targetGroupWids.length === 0) {
      dashboard.addLog("[SYNC FOTO] Nenhum grupo alvo encontrado.");
      return;
    }

    // Extrai os participantes de forma rica do WhatsApp Web via Puppeteer
    // Mapeia tanto o c.us quanto o lid de cada participante se disponível
    const membersInfo = await client.pupPage.evaluate(async (groupJids) => {
      try {
        const Store = window.Store;
        if (!Store || !Store.Chat || !Store.Contact) return [];

        const result = [];
        const seen = new Set();

        for (const groupJid of groupJids) {
          const chat = Store.Chat.get(groupJid);
          if (!chat || !chat.groupMetadata || !chat.groupMetadata.participants) continue;

          const participants = chat.groupMetadata.participants.toArray 
            ? chat.groupMetadata.participants.toArray() 
            : chat.groupMetadata.participants;

          for (const p of participants) {
            const pId = p.id ? p.id._serialized || p.id.toString() : null;
            if (!pId) continue;

            let lidStr = null;
            let cUsStr = null;

            if (pId.endsWith('@lid')) {
              lidStr = pId;
              const contact = Store.Contact.get(p.id);
              if (contact && contact.wid && contact.wid._serialized && contact.wid._serialized.endsWith('@c.us')) {
                cUsStr = contact.wid._serialized;
              }
            } else if (pId.endsWith('@c.us')) {
              cUsStr = pId;
              const contact = Store.Contact.get(p.id);
              if (contact && contact.lid) {
                lidStr = contact.lid._serialized || contact.lid.toString();
              }
            }

            // Evitar duplicados na lista final
            const uniqueKey = cUsStr || lidStr || pId;
            if (!seen.has(uniqueKey)) {
              seen.add(uniqueKey);
              result.push({
                id: pId,
                cUs: cUsStr,
                lid: lidStr
              });
            }
          }
        }
        return result;
      } catch (e) {
        return [];
      }
    }, targetGroupWids).catch(() => []);

    if (membersInfo.length === 0) {
      dashboard.addLog("[SYNC FOTO] Nenhum participante mapeado com sucesso.");
      return;
    }

    dashboard.addLog(`[SYNC FOTO] ${membersInfo.length} membros únicos mapeados. Buscando fotos...`);

    let count = 0;
    let semFoto = 0;
    let skipped = 0;
    let errors = 0;

    for (const member of membersInfo) {
      try {
        const id = member.id;
        if (!id || !id.includes("@")) {
          skipped++;
          continue;
        }

        const cleanNumber = member.cUs ? member.cUs.split('@')[0] : id.split('@')[0];
        let photoUrl = null;
        let name = "Desconhecido";

        // -------------------------------------------------------
        // FORÇA CARREGAMENTO E LEITURA: 3 a 5 segundos por contato
        // Dispara getContactById para as variações de IDs possíveis para
        // que o WhatsApp Web faça a busca de rede e popula o cache interno.
        // -------------------------------------------------------
        try {
          client.getContactById(id).catch(() => null);
          if (member.lid) client.getContactById(member.lid).catch(() => null);
          if (member.cUs) client.getContactById(member.cUs).catch(() => null);
        } catch (e) {}

        // Aguarda 4 segundos de leitura ativa para processamento de rede
        await new Promise((resolve) => setTimeout(resolve, 4000));

        // Tenta obter o nome real do contato pós carregamento
        try {
          const contact = await Promise.race([
            client.getContactById(id),
            new Promise((resolve) => setTimeout(() => resolve(null), 2500))
          ]).catch(() => null);
          if (contact && (contact.pushname || contact.name)) {
            name = formatName(contact.pushname || contact.name) || "Desconhecido";
          }
        } catch (e) {}

        // -------------------------------------------------------
        // BUSCA DE FOTO via Store.ProfilePicThumb.find(wid)
        // -------------------------------------------------------
        try {
          photoUrl = await Promise.race([
            client.pupPage.evaluate(async (jidOriginal, jidCUs, jidLid) => {
              try {
                const Store = window.Store;
                if (!Store || !Store.WidFactory) return null;

                const Contacts = Store.Contact || Store.ContactCollection;
                const widsToTry = [];

                // Cria os objetos Wid para cada variação de ID
                if (jidOriginal) widsToTry.push(Store.WidFactory.createWid(jidOriginal));
                if (jidLid) widsToTry.push(Store.WidFactory.createWid(jidLid));
                if (jidCUs) widsToTry.push(Store.WidFactory.createWid(jidCUs));

                // Remove wids inválidos ou duplicados
                const uniqueWids = [];
                const seenWids = new Set();
                for (const w of widsToTry) {
                  if (w && w._serialized && !seenWids.has(w._serialized)) {
                    seenWids.add(w._serialized);
                    uniqueWids.push(w);
                  }
                }

                // Força a resolução oficial na memória do WhatsApp Web antes da varredura
                if (Store.Contact && Store.Contact.find) {
                  for (const targetWid of uniqueWids) {
                    try {
                      await Store.Contact.find(targetWid);
                    } catch (e) {}
                  }
                }

                // Função auxiliar para validar e extrair a URL de forma rica do avatar
                const extractUrl = (obj) => {
                  if (!obj) return null;
                  const url = obj.imgFull || obj.img || obj.eurl || obj.previewEurl || 
                              obj.__x_imgFull || obj.__x_img || obj.img_full ||
                              (obj.raw ? obj.raw.imgFull || obj.raw.img : null);
                  if (url && typeof url === 'string' && !url.includes('/default-user')) {
                    return url;
                  }
                  return null;
                };

                // A. Tenta método principal: ProfilePicThumb.find()
                if (Store.ProfilePicThumb && Store.ProfilePicThumb.find) {
                  for (const targetWid of uniqueWids) {
                    try {
                      const pic = await Store.ProfilePicThumb.find(targetWid);
                      const url = extractUrl(pic);
                      if (url) return url;
                    } catch (e) {}
                  }
                }

                // B. Tenta requisição remota ao servidor: requestProfilePicFromServer
                if (Store.ProfilePic && Store.ProfilePic.requestProfilePicFromServer) {
                  for (const targetWid of uniqueWids) {
                    try {
                      const contactObj = Contacts ? Contacts.get(targetWid) : null;
                      const target = contactObj || targetWid;
                      const result = await Promise.race([
                        Store.ProfilePic.requestProfilePicFromServer(target),
                        new Promise(resolve => setTimeout(() => resolve(null), 4000))
                      ]).catch(() => null);

                      const url = extractUrl(result);
                      if (url) return url;
                    } catch (e) {}
                  }
                }

                // C. Lê do cache do Backbone como último recurso
                for (const targetWid of uniqueWids) {
                  const contactObj = Contacts ? Contacts.get(targetWid) : null;
                  if (contactObj) {
                    const p = contactObj.profilePicThumb || contactObj.__x_profilePicThumb;
                    const url = extractUrl(p);
                    if (url) return url;
                  }
                }

                return null;
              } catch (e) {
                return null;
              }
            }, member.id, member.cUs, member.lid),
            new Promise((resolve) => setTimeout(() => resolve(null), 8500))
          ]).catch(() => null);
        } catch (e) {
          photoUrl = null;
        }

        // Tenta obter o nome real do contato
        try {
          const contact = await Promise.race([
            client.getContactById(id),
            new Promise((resolve) => setTimeout(() => resolve(null), 3000))
          ]).catch(() => null);
          if (contact && (contact.pushname || contact.name)) {
            name = formatName(contact.pushname || contact.name) || "Desconhecido";
          }
        } catch (e) {}

        if (photoUrl) {
          // -------------------------------------------------------
          // PERSISTÊNCIA MULTI-ID (c.us e lid) NO SUPABASE
          // -------------------------------------------------------

          // 1. Sincroniza metadados dos passageiros (tenta salvar para ambos c.us e lid)
          if (member.cUs) {
            try {
              await statistics.syncPassengerMetadata(member.cUs, name, photoUrl);
            } catch (err) {}
          }
          if (member.lid) {
            try {
              await statistics.syncPassengerMetadata(member.lid, name, photoUrl);
            } catch (err) {}
          }
          // Fallback caso id não seja cUs nem lid
          if (id !== member.cUs && id !== member.lid) {
            try {
              await statistics.syncPassengerMetadata(id, name, photoUrl);
            } catch (err) {}
          }

          // 2. Atualiza fotos na tabela votes para TODAS as variações de IDs possíveis
          const idsToUpdate = new Set([id]);
          if (member.cUs) idsToUpdate.add(member.cUs);
          if (member.lid) idsToUpdate.add(member.lid);

          for (const targetId of idsToUpdate) {
            const { error: errExato } = await supabase
              .from("votes")
              .update({ photo_url: photoUrl })
              .eq("voter_id", targetId);
            if (errExato) {
              dashboard.addLog(`[SYNC FOTO ERR] votes@eq ${targetId}: ${errExato.message}`);
            }
          }

          // 3. Atualiza votos onde o voter_id contém o número limpo (formato antigo ou variantes)
          if (cleanNumber) {
            const { error: errLike } = await supabase
              .from("votes")
              .update({ photo_url: photoUrl })
              .like("voter_id", `%${cleanNumber}%`)
              .is("photo_url", null);
            if (errLike) {
              dashboard.addLog(`[SYNC FOTO ERR] votes@like ${cleanNumber}: ${errLike.message}`);
            }
          }

          count++;
          dashboard.addLog(`[SYNC FOTO] ✅ ${name} (${cleanNumber}): foto salva`);
        } else {
          semFoto++;
          dashboard.addLog(`[SYNC FOTO] 🔒 ${cleanNumber}: sem foto pública`);
        }
      } catch (err) {
        errors++;
        dashboard.addLog(`[SYNC FOTO ERR] ${member.id.split('@')[0]}: ${err.message}`);
      }
      
      // Pausa saudável entre os membros para evitar spam block no WebSocket
      await new Promise((resolve) => setTimeout(resolve, 800));
    }

    dashboard.addLog(
      `[SYNC FOTO] Concluído! ✅ Com foto: ${count} | 🔒 Sem foto pública: ${semFoto} | Pulados: ${skipped} | Erros: ${errors}`
    );

  } catch (globalErr) {
    dashboard.addLog(`[SYNC FOTO] Erro crítico: ${globalErr.message}`);
  }
}

// Inicia Dashboard no terminal
dashboard.render();
startServer();
startBot();
