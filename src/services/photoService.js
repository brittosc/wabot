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

    // 1. Tenta a estratégia robusta com Puppeteer, corrigindo o erro isNewsletter
    try {
      photoUrl = await client.pupPage.evaluate(async (targetJid) => {
        try {
          const Store = window.Store;
          if (!Store) return null;

          const WidFactory = Store.WidFactory || (Store.Wid && Store.Wid.WidFactory);
          if (!WidFactory) return null;

          const wid = WidFactory.createWid(targetJid);
          const Contacts = Store.Contact || Store.ContactCollection;
          if (!Contacts) return null;

          // Garante que o contato está no cache do Contacts
          let contactObj = Contacts.get(wid);
          if (!contactObj && Contacts.gadd) {
            Contacts.gadd(wid, { silent: true });
            contactObj = Contacts.get(wid);
          }

          if (!contactObj) return null;

          // Executa a requisição forçada no servidor do WhatsApp passando o contactObj inteiro (corrige isNewsletter!)
          if (Store.ProfilePic && Store.ProfilePic.requestProfilePicFromServer) {
            try {
              const res = await Store.ProfilePic.requestProfilePicFromServer(contactObj);
              if (res && (res.eurl || res.imgFull || res.img)) {
                return res.eurl || res.imgFull || res.img;
              }
            } catch (err) {
              // Se der erro ao passar o objeto, tenta com o wid como fallback
              try {
                const res = await Store.ProfilePic.requestProfilePicFromServer(wid);
                if (res && (res.eurl || res.imgFull || res.img)) {
                  return res.eurl || res.imgFull || res.img;
                }
              } catch (e2) {}
            }
          }

          // Se ainda não obteve, aguarda um pouco para que o profilePicThumbObj seja populado em segundo plano
          await new Promise(resolve => setTimeout(resolve, 800));

          if (contactObj.profilePicThumbObj) {
            const p = contactObj.profilePicThumbObj;
            return p.imgFull || p.eurl || p.img || null;
          }

          if (Store.ProfilePic && Store.ProfilePic.profilePicFind) {
            const pic = await Store.ProfilePic.profilePicFind(wid);
            return pic ? (pic.imgFull || pic.eurl || pic.img) : null;
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
