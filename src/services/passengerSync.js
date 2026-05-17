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
    let photoCache = new Map();
    try {
      photoCache = await precarregarFotosVisualmente(client, groups, logCallback);
    } catch (err) {
      logCallback(chalk.gray(`⚠️ Falha ao pré-carregar fotos visualmente: ${err.message}`));
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

        // 2. Obter foto de perfil pública: tenta primeiro do cache visual e usa o serviço oficial como fallback
        let photoUrl = photoCache.get(jid) || null;
        if (!photoUrl) {
          try {
            const { getProfilePhoto } = require("./photoService");
            photoUrl = await getProfilePhoto(client, jid);
          } catch (e) {
            // Ignora silenciosamente erros de foto
          }
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

/**
 * Executa automação visual no navegador para carregar as fotos dos participantes na modal.
 */
async function precarregarFotosVisualmente(client, groups, logCallback) {
  const page = client.pupPage;
  const photoCache = new Map();

  logCallback(chalk.gray("⏳ Aguardando renderização completa da barra lateral de chats..."));
  await page.waitForSelector('#pane-side', { timeout: 15000 }).catch(() => null);
  await new Promise(r => setTimeout(r, 2000)); // Delay extra de estabilização

  for (const group of groups) {
    const groupJid = group.id._serialized;
    const groupName = group.name;
    logCallback(chalk.blue(`📸 Executando varredura visual no grupo: ${chalk.bold(groupName)}...`));

    try {
      // 1. Abrir o grupo de forma ultra-estável usando comando nativo interno do WhatsApp Web
      const chatOpened = await page.evaluate(async (jid) => {
        try {
          const Store = window.Store;
          if (Store && Store.Cmds && Store.Cmds.openChatAt && Store.WidFactory) {
            const wid = Store.WidFactory.createWid(jid);
            await Store.Cmds.openChatAt(wid);
            return true;
          }
        } catch (e) {}
        return false;
      }, groupJid);

      if (!chatOpened) {
        logCallback(chalk.yellow(`  ⚠️ Não foi possível abrir o chat do grupo "${groupName}" via comando interno.`));
        continue;
      }

      await new Promise(r => setTimeout(r, 2000)); // Aguarda carregar o chat na tela

      // 2. Clicar no cabeçalho do chat ativo de forma ultra-precisa
      const headerOpened = await page.evaluate(() => {
        let header = document.querySelector('header');
        if (!header) {
          header = document.querySelector('#main header') || 
                   document.querySelector('[data-testid="conversation-header"]');
        }
        if (header) {
          header.click();
          return true;
        }
        return false;
      });

      if (!headerOpened) {
        logCallback(chalk.yellow(`  ⚠️ Não foi possível abrir o painel de Dados do Grupo do chat "${groupName}".`));
        continue;
      }

      await new Promise(r => setTimeout(r, 2000)); // Aguarda abrir a barra lateral

      // 3. Procurar e clicar no botão "Ver todos" membros, restrito à barra lateral direita
      const verTodosClicked = await page.evaluate(() => {
        const rightPane = document.querySelector('#app div[style*="overflow-y"]') || 
                          document.querySelector('#app div[role="region"]') ||
                          document.querySelector('#app') || document;

        const elementos = Array.from(rightPane.querySelectorAll('span, div, [role="button"]'));
        const btn = elementos.find(el => {
          const txt = el.textContent || "";
          return txt.includes("Ver todos") || txt.includes("Ver mais") || txt.includes("Mostrar todos");
        });
        if (btn) {
          btn.click();
          return true;
        }
        return false;
      });

      if (verTodosClicked) {
        logCallback(chalk.gray(`  • Modal de participantes aberta. Rolando lista...`));
        await new Promise(r => setTimeout(r, 2000)); // Aguarda abrir a modal

        // 4. Rolar a modal suavemente em etapas para forçar o carregamento de LIDs e avatares
        await page.evaluate(async () => {
          const scrollContainer = document.querySelector('div[role="dialog"] div[style*="overflow-y"]') || 
                                  document.querySelector('div[role="dialog"] .vcard') ||
                                  document.querySelector('div[role="dialog"] [role="list"]') ||
                                  document.querySelector('.vcard')?.parentElement;
          if (scrollContainer) {
            for (let i = 0; i < 20; i++) {
              scrollContainer.scrollTop += 350;
              await new Promise(r => setTimeout(r, 250));
            }
          }
        });

        await new Promise(r => setTimeout(r, 1500)); // Delay de estabilização

        // Fechar a modal para liberar a tela para o próximo grupo
        await page.evaluate(() => {
          const closeBtn = document.querySelector('div[role="dialog"] button span[data-icon="x"]') || 
                           document.querySelector('div[role="dialog"] button');
          if (closeBtn) closeBtn.click();
        });

        await new Promise(r => setTimeout(r, 1000));
      } else {
        logCallback(chalk.gray(`  • Grupo pequeno (sem botão "Ver todos"). Rolando painel lateral...`));
        // Se for grupo pequeno, rola o próprio painel lateral
        await page.evaluate(async () => {
          const pane = document.querySelector('#app div[style*="overflow-y"]') || 
                       document.querySelector('#app div[role="region"]') ||
                       document.querySelector('.vcard')?.parentElement;
          if (pane) {
            for (let i = 0; i < 8; i++) {
              pane.scrollTop += 300;
              await new Promise(r => setTimeout(r, 200));
            }
          }
        });
        await new Promise(r => setTimeout(r, 1000));
      }
    } catch (err) {
      logCallback(chalk.red(`  ⚠️ Erro durante processamento visual do grupo: ${err.message}`));
    }
  }

  // 5. Extrair todas as fotos da coleção ProfilePicThumb de forma ultra-resiliente com tradução LID -> JID clássico
  logCallback(chalk.blue("\n📥 Extraindo cache de fotos obtidas visualmente..."));
  try {
    try {
      const dumpData = await page.evaluate(() => {
        const Store = window.Store;
        if (!Store) return { storeExists: false };
        return {
          storeExists: true,
          lidCollectionExists: !!Store.Lid,
          lidModelsCount: Store.Lid && Store.Lid.models ? Store.Lid.models.length : 0,
          contactCollectionExists: !!Store.Contact,
          contactModelsCount: Store.Contact && Store.Contact.models ? Store.Contact.models.length : 0,
          profilePicThumbCount: Store.ProfilePicThumb && Store.ProfilePicThumb.models ? Store.ProfilePicThumb.models.length : 0,
          sampleLids: Store.Lid && Store.Lid.models ? Store.Lid.models.slice(0, 15).map(m => ({
            id: m.id ? m.id._serialized : null,
            jid: m.jid ? m.jid._serialized : null
          })) : [],
          sampleThumbs: Store.ProfilePicThumb && Store.ProfilePicThumb.models ? Store.ProfilePicThumb.models.slice(0, 15).map(m => ({
            id: m.id ? m.id._serialized : null,
            img: !!m.img,
            eurl: !!m.eurl,
            imgFull: !!m.imgFull
          })) : []
        };
      });
      const fs = require('fs');
      fs.writeFileSync('d:\\Github\\wabot\\scratch\\memory_dump.json', JSON.stringify(dumpData, null, 2));
    } catch (dumpErr) {}

    const extractedPhotos = await page.evaluate(() => {
      const Store = window.Store;
      if (!Store || !Store.ProfilePicThumb) return {};

      // Criar mapa de de-para para traduzir JIDs temporários LID para JIDs de telefone clássicos
      const lidToJid = {};
      if (Store.Lid && Store.Lid.models) {
        for (const item of Store.Lid.models) {
          if (item.id && item.jid) {
            lidToJid[item.id._serialized] = item.jid._serialized;
          }
        }
      }
      if (Store.Contact && Store.Contact.models) {
        for (const c of Store.Contact.models) {
          if (c.id && c.lid) {
            lidToJid[c.lid._serialized] = c.id._serialized;
          }
        }
      }
      
      // Resiliência de leitura de coleção Backbone no WhatsApp Web
      const collection = Store.ProfilePicThumb;
      let models = [];
      if (typeof collection.toArray === 'function') {
        models = collection.toArray();
      } else if (collection.models) {
        models = collection.models;
      } else if (collection._models) {
        models = collection._models;
      } else if (typeof collection.values === 'function') {
        models = Array.from(collection.values());
      }
      
      const map = {};
      for (const t of models) {
        if (t && t.id) {
          const rawJid = t.id._serialized;
          // Traduz LID para JID clássico se existir, senão usa o próprio JID
          const jid = lidToJid[rawJid] || rawJid;
          const url = t.imgFull || t.eurl || t.img || null;
          if (url) map[jid] = url;
        }
      }
      return map;
    });

    Object.entries(extractedPhotos).forEach(([jid, url]) => {
      photoCache.set(jid, url);
    });

    logCallback(chalk.green(`✓ Total de fotos públicas mapeadas no cache visual: ${chalk.bold(photoCache.size)}\n`));
  } catch (err) {
    logCallback(chalk.red(`⚠️ Falha ao extrair dados de ProfilePicThumb: ${err.message}`));
  }

  return photoCache;
}

module.exports = { sincronizarParticipantes };
