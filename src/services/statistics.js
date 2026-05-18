const configService = require("./configService");
const moment = require("moment-timezone");
const dashboard = require("./dashboard");
const supabase = require("../database/supabaseClient");
const { withRetry } = require("./utils");
const { formatName } = require("../utils/nameFormatter");

const normalizePhone = (p) => {
  if (!p) return "";
  return p.replace(/\D/g, "");
};


const readStats = async () => {
  try {
    let allRows = [];
    let from = 0;
    const step = 1000;
    let hasMore = true;

    while (hasMore) {
      const { data: rows, error } = await withRetry(() => 
        supabase
          .from("votes")
          .select("voter_id, group_name, vote_date, option, poll_name, voter_name, photo_url, created_at")
          .order("vote_date", { ascending: false })
          .range(from, from + step - 1)
      , 5, 1000, `Supabase:Votes:Batch:${from}`);

      if (error) throw error;
      
      if (rows && rows.length > 0) {
        allRows = allRows.concat(rows);
        if (rows.length < step) {
          hasMore = false;
        } else {
          from += step;
        }
      } else {
        hasMore = false;
      }
      
      // Limite de segurança para evitar loops infinitos
      if (from > 100000) break;
    }

    const stats = {};
    allRows.forEach((row) => {
      const date = row.vote_date; // 'YYYY-MM-DD'
      if (!stats[date]) {
        stats[date] = { Version2: true, grupos: {} };
      }
      if (!stats[date].grupos[row.group_name]) {
        stats[date].grupos[row.group_name] = {
          pollName: row.poll_name || "Enquete do dia",
          votes: {},
        };
      }
      let voteObj = row.option;
      if (typeof row.option === "string") {
        voteObj = { 
          option: row.option, 
          timestamp: row.created_at,
          voter_name: row.voter_name,
          photo_url: row.photo_url || null
        };
      }
      stats[date].grupos[row.group_name].votes[row.voter_id] = voteObj;
    });

    // Verificar se houve enquete hoje
    const todayStr = moment().tz("America/Sao_Paulo").format("YYYY-MM-DD");
    const { data: pollHist } = await withRetry(() => 
      supabase
        .from("poll_history")
        .select("poll_date")
        .eq("poll_date", todayStr)
    , 5, 1000, "Supabase:Polls");
    const isPollSentToday = pollHist && pollHist.length > 0;

    return { rawDB: stats, isPollSentToday };
  } catch (e) {
    dashboard.addLog(`Erro ao ler stats do Supabase: ${e.message}`);
    return { rawDB: {}, isPollSentToday: false };
  }
};

const readPassengers = async () => {
  try {
    const { data, error } = await withRetry(() => 
      supabase
        .from("passengers")
        .select("*")
    , 5, 1000, "Supabase:Passengers");

    if (error) throw error;
    return data || [];
  } catch (e) {
    dashboard.addLog(`Erro ao ler passageiros do Supabase: ${e.message}`);
    return [];
  }
};

const readPollHistory = async () => {
  try {
    const { data, error } = await withRetry(() => 
      supabase
        .from("poll_history")
        .select("poll_date")
        .order("poll_date", { ascending: false })
    , 5, 1000, "Supabase:PollHistory");

    if (error) throw error;
    return data.map(r => r.poll_date) || [];
  } catch (e) {
    dashboard.addLog(`Erro ao ler histórico de enquetes: ${e.message}`);
    return [];
  }
};

const updateTerminalOccupancy = async (stats) => {
  try {
    if (!stats) stats = await readStats();
    const todayStr = moment().tz("America/Sao_Paulo").format("YYYY-MM-DD");
    const dayData = stats.rawDB ? stats.rawDB[todayStr] : stats[todayStr];

    const config = configService.getConfig();
    const capacities = config.groupCapacities || {};
    const aliases = config.groupAliases || {};

    const occupancySummary = [];
    const votesSummary = [];

    Object.keys(capacities).forEach((gName) => {
      const cap = capacities[gName];
      const displayName = aliases[gName] || gName;
      const groupData = dayData && dayData.grupos ? dayData.grupos[gName] : null;

      let count = 0;
      let ida = 0, soIda = 0, soVolta = 0, nao = 0;

      if (groupData && groupData.votes) {
        Object.values(groupData.votes).forEach((vData) => {
          const opt = typeof vData === "object" ? vData.option : vData;
          if (opt === "Irei, ida e volta.") { count++; ida++; }
          else if (opt === "Irei, mas não retornarei.") { count++; soIda++; }
          else if (opt === "Não irei, apenas retornarei.") { count++; soVolta++; }
          else if (opt === "Não irei à faculdade hoje.") { nao++; }
        });
      }

      const status = `${count}/${cap}`;
      if (count > 0) occupancySummary.push({ name: displayName, count, cap, status });
      // Sempre adiciona ao rodapé, mesmo com zeros
      votesSummary.push({ name: displayName, ida, soIda, soVolta, nao });
    });

    dashboard.setOccupancy(occupancySummary);
    dashboard.setVotesFooter(votesSummary);
  } catch (e) {
    // Ignora erros de atualização do terminal
  }
};


const registerVote = async (vote, voterName, photoUrl) => {
  const now = moment().tz("America/Sao_Paulo");
  const todayStr = now.format("YYYY-MM-DD");

  let groupName = "Desconhecido";
  let pollName = "Enquete do dia";
  try {
    if (vote.parentMessage) {
      const chat = await vote.parentMessage.getChat();
      if (chat && chat.name) groupName = chat.name;
      pollName = vote.parentMessage.body;
    }
  } catch (e) {
    // Ignora caso falhe ao pegar o nome do grupo
  }

  const voterId = vote.voter;

  let finalPhotoUrl = photoUrl;
  if (!finalPhotoUrl) {
    try {
      const { data: dbPass } = await supabase
        .from("passageiros")
        .select("foto_publica")
        .eq("id", voterId)
        .maybeSingle();
      if (dbPass && dbPass.foto_publica) {
        finalPhotoUrl = dbPass.foto_publica;
      }
    } catch (e) {}

    if (!finalPhotoUrl) {
      try {
        const { data: dbPass2 } = await supabase
          .from("passengers")
          .select("photo_url")
          .eq("whatsapp_id", voterId)
          .maybeSingle();
        if (dbPass2 && dbPass2.photo_url) {
          finalPhotoUrl = dbPass2.photo_url;
        }
      } catch (e2) {}
    }
  }

  // Sincroniza metadados do passageiro (incluindo a foto de perfil) na tabela passengers
  if (voterName) {
    await syncPassengerMetadata(voterId, formatName(voterName), finalPhotoUrl, groupName);
  }

  if (vote.selectedOptions && vote.selectedOptions.length > 0) {
    const selectedOption = vote.selectedOptions[0].name;
    await withRetry(() => 
      supabase.from("votes").upsert(
        {
          voter_id: voterId,
          group_name: groupName,
          vote_date: todayStr,
          option: selectedOption,
          poll_name: pollName,
          voter_name: formatName(voterName),
          photo_url: finalPhotoUrl || null,
        },
        { onConflict: "voter_id,group_name,vote_date" }
      )
    , 5, 1000, "Supabase:Upsert");
  } else {
    // Deletar voto (desmarcado)
    await withRetry(() => 
      supabase
        .from("votes")
        .delete()
        .match({ voter_id: voterId, group_name: groupName, vote_date: todayStr })
    , 5, 1000, "Supabase:Delete");
  }

  // Atualiza ocupação no terminal
  const stats = await readStats();
  await updateTerminalOccupancy(stats);
};

/**
 * Sincroniza metadados básicos do passageiro na tabela passengers.
 * Útil para garantir que o dashboard tenha o nome atualizado.
 */
const syncPassengerMetadata = async (whatsappId, name, photoUrl, groupName) => {
  try {
    const updateData = {
      whatsapp_id: whatsappId,
      updated_at: new Date().toISOString()
    };
    
    if (name) updateData.name = formatName(name);
    if (photoUrl) updateData.photo_url = photoUrl;

    // Sincroniza também na tabela passageiros do Supabase para manter o cache unificado
    try {
      const passengerData = {
        id: whatsappId,
        nome: name ? formatName(name) : "Sem Nome"
      };
      if (photoUrl) {
        passengerData.foto_publica = photoUrl;
      }
      await supabase.from("passageiros").upsert(passengerData, { onConflict: "id" });
    } catch (ePass) {}

    const cleanNumber = normalizePhone(whatsappId.split('@')[0]);

    // Tenta atualizar pelo whatsapp_id (formato completo: 554896864290@c.us)
    const { data: byJid, error: errJid } = await withRetry(() =>
      supabase.from("passengers")
        .update(updateData)
        .eq("whatsapp_id", whatsappId)
        .select("id")
    , 2, 1000, "Supabase:SyncPassengerJid");

    if (errJid) {
      dashboard.addLog(`[SYNC META ERR] passengers@jid ${cleanNumber}: ${errJid.message}`);
    }

    // Se não atualizou nenhuma linha, tenta pelo phone (número limpo)
    if ((!byJid || byJid.length === 0) && cleanNumber) {
      const { error: errPhone } = await withRetry(() =>
        supabase.from("passengers")
          .update(updateData)
          .eq("phone", cleanNumber)
      , 2, 1000, "Supabase:SyncPassengerPhone");

      if (errPhone) {
        dashboard.addLog(`[SYNC META ERR] passengers@phone ${cleanNumber}: ${errPhone.message}`);
      }
    }
  } catch (e) {
    // Silencioso — erro de rede ou timeout
  }
};

module.exports = { readStats, readPassengers, readPollHistory, registerVote, updateTerminalOccupancy, syncPassengerMetadata };
