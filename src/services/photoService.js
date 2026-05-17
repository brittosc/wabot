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

            // Busca e assegura o carregamento do contato na memória, obtendo seu LID se houver
            let contactWid = WidFactory.createWid(targetJid);
            if (Store.Contact && typeof Store.Contact.find === 'function') {
              try {
                const contact = await Store.Contact.find(contactWid);
                if (contact && contact.lid) {
                  contactWid = contact.lid;
                }
              } catch (e) {}
            }

            const ProfilePicThumb = Store.ProfilePicThumb;
            if (!ProfilePicThumb) return null;

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

            // Atraso extra de segurança para a API do WhatsApp Web obter a foto do servidor
            await new Promise(resolve => setTimeout(resolve, 800));

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
