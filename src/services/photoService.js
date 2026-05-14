const dashboard = require("./dashboard");

/**
 * Tenta obter a URL da foto de perfil de um contato usando múltiplas estratégias.
 */
async function getProfilePhoto(client, id) {
  if (!id || !id.includes("@")) return null;

  try {
    let photoUrl = null;

    // 1. Tenta via objeto de contato (método mais simples)
    try {
      const contact = await client.getContactById(id);
      photoUrl = await contact.getProfilePicUrl().catch(() => null);
    } catch (e) {}

    // 2. Se falhou e for LID, tenta converter para JID real (c.us)
    if (!photoUrl && id.includes("@lid")) {
      try {
        const contact = await client.getContactById(id);
        const contactNumber = contact.number || (contact.id && contact.id.user);
        if (contactNumber && !contactNumber.includes("@")) {
          const jid = `${contactNumber}@c.us`;
          // Força o carregamento do chat antes de pedir a foto
          try { await client.getChatById(jid); } catch (e) {}
          photoUrl = await client.getProfilePicUrl(jid).catch(() => null);
        }
      } catch (e) {}
    }

    // 3. Tenta via Puppeteer/Store (método avançado)
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
            
            if (Store.ProfilePic && Store.ProfilePic.requestProfilePicFromServer) {
              await Store.ProfilePic.requestProfilePicFromServer(wid);
            }
            
            await new Promise(resolve => setTimeout(resolve, 2000));
            
            const contactObj = Contacts ? Contacts.get(wid) : null;
            if (contactObj && contactObj.profilePicThumbObj) {
               const p = contactObj.profilePicThumbObj;
               return p.imgFull || p.eurl || p.img || null;
            }
            
            if (Store.ProfilePic && Store.ProfilePic.profilePicFind) {
              const pic = await Store.ProfilePic.profilePicFind(wid);
              return pic ? (pic.imgFull || pic.eurl || pic.img) : null;
            }
            return null;
          } catch (e) { return null; }
        }, id);
      } catch (e) {}
    }

    // 4. Última tentativa oficial com ID original
    if (!photoUrl) {
      photoUrl = await client.getProfilePicUrl(id).catch(() => null);
    }

    return photoUrl;
  } catch (error) {
    dashboard.addLog(`Erro ao obter foto para ${id}: ${error.message}`);
    return null;
  }
}

module.exports = { getProfilePhoto };
