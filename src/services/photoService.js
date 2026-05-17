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

    // 1. Tenta a estratégia avançada e oficial do wa-js no Puppeteer
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

          // Busca ou instancia dinamicamente o modelo de foto de perfil na coleção oficial
          let thumb = ProfilePicThumb.get(wid);
          if (!thumb && ProfilePicThumb.modelClass) {
            try {
              thumb = new ProfilePicThumb.modelClass({ id: wid });
              ProfilePicThumb.add(thumb);
            } catch (e) {}
          }

          // Se a miniatura não possui imagem válida no cache local, força a sincronização com o servidor
          if (thumb && (!thumb.imgFull && !thumb.eurl && !thumb.img)) {
            if (Store.ProfilePic && Store.ProfilePic.profilePicResync) {
              try {
                await Store.ProfilePic.profilePicResync([thumb]);
              } catch (err) {
                // Fallback para requestProfilePicFromServer passando o objeto thumb
                if (Store.ProfilePic.requestProfilePicFromServer) {
                  try {
                    await Store.ProfilePic.requestProfilePicFromServer(thumb);
                  } catch (e2) {}
                }
              }
            }
          }

          // Curto atraso para garantir o recebimento dos pacotes da CDN
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

    // 2. Fallback final usando a API padrão do whatsapp-web.js (caso seja corrigida no futuro)
    if (!photoUrl) {
      try {
        photoUrl = await client.getProfilePicUrl(jidStr).catch(() => null);
      } catch (e) {}
    }

    return photoUrl;
  } catch (error) {
    dashboard.addLog(`Erro ao obter foto para ${id}: ${error.message}`);
    return null;
  }
}

module.exports = { getProfilePhoto };
