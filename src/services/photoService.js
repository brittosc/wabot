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

            const wid = WidFactory.createWid(targetJid);
            const ProfilePicThumb = Store.ProfilePicThumb;
            if (!ProfilePicThumb) return null;

            let thumb = ProfilePicThumb.get(wid);
            if (!thumb && ProfilePicThumb.modelClass) {
              try {
                thumb = new ProfilePicThumb.modelClass({ id: wid });
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

            await new Promise(resolve => setTimeout(resolve, 500));

            if (thumb) {
              return thumb.imgFull || thumb.eurl || thumb.img || null;
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
