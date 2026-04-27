const configService = require("./configService");
const moment = require("moment-timezone");
const dashboard = require("./dashboard");
const supabase = require("../database/supabaseClient");
const { withRetry } = require("./utils");

const normalizePhone = (p) => {
  if (!p) return "";
  return p.replace(/\D/g, "");
};


const readStats = async () => {
  try {
    const { data: rows, error } = await withRetry(() => 
      supabase
        .from("votes")
        .select("voter_id, group_name, vote_date, option, poll_name, voter_name, created_at")
        .order("vote_date", { ascending: false })
        .limit(10000)
    , 5, 1000, "Supabase:Votes");

    if (error) throw error;

    const stats = {};
    rows.forEach((row) => {
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
          voter_name: row.voter_name 
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
      occupancySummary.push({ name: displayName, count, cap, status });
      votesSummary.push({ name: displayName, ida, soIda, soVolta, nao });
    });

    dashboard.setOccupancy(occupancySummary);
    dashboard.printVotesSummary(votesSummary);
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

  // Sincroniza metadados do passageiro (nome e foto) na tabela passengers
  if (voterName || photoUrl) {
    await syncPassengerMetadata(voterId, voterName, photoUrl, groupName);
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
          voter_name: voterName,
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
 * Útil para garantir que o dashboard tenha o nome e a foto atualizados.
 */
const syncPassengerMetadata = async (whatsappId, name, photoUrl, groupName) => {
  try {
    const updateData = {
      whatsapp_id: whatsappId,
      updated_at: new Date().toISOString()
    };
    
    if (name) updateData.name = name;
    if (photoUrl) {
      updateData.photo_url = photoUrl;
      // dashboard.addLog(`DEBUG: Salvando foto para ${whatsappId}`);
    }
    
    // Só atualiza se o passageiro já existe — nunca insere (evita erro de NOT NULL em registration_number)
    await withRetry(() =>
      supabase.from("passengers")
        .update(updateData)
        .eq("whatsapp_id", whatsappId)
    , 2, 1000, "Supabase:SyncPassenger");
  } catch (e) {
    // Silencioso — falha de sync de foto não é crítica
  }
};

module.exports = { readStats, readPassengers, registerVote, updateTerminalOccupancy, syncPassengerMetadata };
