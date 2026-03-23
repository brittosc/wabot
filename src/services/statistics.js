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
        .select("voter_id, group_name, vote_date, option, poll_name, created_at")
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
        voteObj = { option: row.option, timestamp: row.created_at };
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

const updateTerminalOccupancy = async (stats) => {
  try {
    if (!stats) stats = await readStats();
    const todayStr = moment().tz("America/Sao_Paulo").format("YYYY-MM-DD");
    const dayEntry = stats[todayStr];
    if (!dayEntry || !dayEntry.grupos) {
      dashboard.setOccupancy([]);
      return;
    }

    const config = configService.getConfig();
    const capacities = config.groupCapacities || {};
    const aliases = config.groupAliases || {};

    const occupancySummary = [];
    Object.keys(capacities).forEach((gName) => {
      let count = 0;
      const cap = capacities[gName];
      const groupData = dayEntry.grupos[gName];
      if (groupData && groupData.votes) {
        Object.values(groupData.votes).forEach((vData) => {
          const opt = typeof vData === "object" ? vData.option : vData;
          if (
            opt === "Irei, ida e volta." ||
            opt === "Irei, mas não retornarei." ||
            opt === "Não irei, apenas retornarei."
          ) {
            count++;
          }
        });
      }

      const displayName = aliases[gName] || gName;
      const status = `${count}/${cap}`;
      occupancySummary.push({ name: displayName, count, cap, status });
    });

    dashboard.setOccupancy(occupancySummary);
  } catch (e) {
    // Ignora erros de atualização do terminal
  }
};

const registerVote = async (vote, voterName) => {
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

  // Auto-registro de passageiros
  try {
    const phone = normalizePhone(voterId);
    const { data: allPassengers } = await withRetry(() => 
      supabase
        .from("passengers")
        .select("id, phone")
    , 5, 1000, "Supabase:Users");

    const existing = allPassengers?.find(
      (p) => normalizePhone(p.phone) === phone,
    );

    if (!existing) {
      const config = configService.getConfig();
      const targetGroups = config.targetGroups || [];
      const busIndex = targetGroups.indexOf(groupName);
      const busNumber = busIndex !== -1 ? busIndex + 1 : 1;

      await withRetry(() => 
        supabase.from("passengers").insert({
          name: voterName || "Aluno Novo",
          phone: phone,
          bus_number: busNumber,
          status: "aprovado",
          registration_number: "AUTO_" + phone.slice(-6),
          authorized_days: [1, 2, 3, 4, 5], // Seg-Sex por padrão
        })
      , 5, 1000, "Supabase:Insert");
    }
  } catch (err) {
    dashboard.addLog(`[Stats] Erro no auto-registro: ${err.message}`);
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

module.exports = { readStats, registerVote, updateTerminalOccupancy };
