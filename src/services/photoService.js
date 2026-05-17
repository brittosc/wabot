const dashboard = require("./dashboard");

/**
 * Tenta obter a URL da foto de perfil de um contato usando múltiplas estratégias.
 */
async function getProfilePhoto(client, id) {
  if (!id || !id.includes("@")) return null;

  try {
    let photoUrl = null;

    // Se for LID, tenta converter para o JID real de telefone c.us
    let jidStr = id;
    if (id.includes("@lid")) {
      try {
        const contact = await client.getContactById(id);
        const contactNumber = contact.number || (contact.id && contact.id.user);
        if (contactNumber && !contactNumber.includes("@")) {
          jidStr = `${contactNumber}@c.us`;
        }
      } catch (e) {}
    }

    // 1. Tenta a API padrão e oficial do whatsapp-web.js (prioritária sob User Agent real)
    try {
      photoUrl = await client.getProfilePicUrl(jidStr).catch(() => null);
    } catch (e) {}

    // 2. Fallback avançado usando a estratégia do wa-js no Puppeteer caso a API oficial venha vazia
    if (!photoUrl) {
      try {
        photoUrl = await client.pupPage.evaluate(async (targetJid) => {
          try {
            const Store = window.Store;
            if (!Store) return null;

            const WidFactory = Store.WidFactory || (Store.Wid && Store.Wid.WidFactory);
            if (!WidFactory) return null;

            // Busca e assegura o carregamento do contato obtendo seu LID
            let contactWid = WidFactory.createWid(targetJid);
            try {
              // 1. Tenta obter da coleção Store.Lid (tradutor nativo de LIDs)
              let foundLid = null;
              if (Store.Lid && Store.Lid.models) {
                const lidItem = Store.Lid.models.find(m => m.jid && m.jid._serialized === targetJid);
                if (lidItem && lidItem.id) {
                  foundLid = lidItem.id._serialized;
                }
              }

              // 2. Tenta obter da coleção de contatos na memória
              if (!foundLid && Store.Contact) {
                const contact = Store.Contact.get(contactWid);
                if (contact && contact.lid) {
                  foundLid = contact.lid._serialized;
                }
              }

              // 3. Tenta obter do IndexedDB local como última alternativa
              if (!foundLid) {
                foundLid = await new Promise((resolve) => {
                  try {
                    const req = indexedDB.open("wawc");
                    req.onsuccess = (ev) => {
                      const db = ev.target.result;
                      try {
                        const tx = db.transaction(["contact"], "readonly");
                        const store = tx.objectStore("contact");
                        const getReq = store.get(targetJid);
                        getReq.onsuccess = (e) => {
                          const res = e.target.result;
                          resolve(res && res.lid ? res.lid : null);
                        };
                        getReq.onerror = () => resolve(null);
                      } catch (e2) { resolve(null); }
                    };
                    req.onerror = () => resolve(null);
                  } catch (e1) { resolve(null); }
                });
              }

              if (foundLid) {
                contactWid = WidFactory.createWid(foundLid);
              }
            } catch (e) {}

            // Estratégia Principal: Usar o método oficial de busca assíncrona do próprio WhatsApp Web
            if (Store.ProfilePic && typeof Store.ProfilePic.profilePicFind === 'function') {
              try {
                const picResult = await Store.ProfilePic.profilePicFind(contactWid);
                if (picResult) {
                  const url = picResult.imgFull || picResult.eurl || picResult.img || null;
                  if (url) return url;
                }
              } catch (picErr) {}
            }

            // Fallback: Estratégia de inserção direta na coleção ProfilePicThumb e resync manual
            const ProfilePicThumb = Store.ProfilePicThumb;
            if (ProfilePicThumb) {
              let thumb = ProfilePicThumb.get(contactWid);
              if (!thumb && ProfilePicThumb.modelClass) {
                try {
                  thumb = new ProfilePicThumb.modelClass({ id: contactWid });
                  ProfilePicThumb.add(thumb);
                } catch (e) {}
              }

              if (thumb && (!thumb.imgFull && !thumb.eurl && !thumb.img)) {
                if (Store.ProfilePic && Store.ProfilePic.profilePicResync) {
                  try {
                    await Store.ProfilePic.profilePicResync([thumb]);
                  } catch (err) {
                    if (Store.ProfilePic.requestProfilePicFromServer) {
                      try {
                        await Store.ProfilePic.requestProfilePicFromServer(thumb);
                      } catch (e2) {}
                    }
                  }
                }
              }

              // Atraso de estabilização
              await new Promise(resolve => setTimeout(resolve, 800));

              if (thumb) {
                return thumb.imgFull || thumb.eurl || thumb.img || null;
              }
            }

            return null;
          } catch (e) {
            return null;
          }
        }, jidStr);
      } catch (e) {}
    }

    return photoUrl;
  } catch (error) {
    dashboard.addLog(`Erro ao obter foto para ${id}: ${error.message}`);
    return null;
  }
}

module.exports = { getProfilePhoto };
