const fs = require("fs");
const configService = require("./configService");
const moment = require("moment-timezone");
const dashboard = require("./dashboard");
const supabase = require("../database/supabaseClient");
const weatherService = require("./weatherService");

const htmlFile = "./public/estatisticas.html";

const normalizePhone = (p) => {
  if (!p) return "";
  return p.replace(/\D/g, "");
};

const readStats = async () => {
  try {
    // Filtramos apenas os últimos 90 dias para reduzir o payload e uso de RAM na VPS
    const thresholdDate = moment()
      .tz("America/Sao_Paulo")
      .subtract(90, "days")
      .format("YYYY-MM-DD");

    const { data: rows, error } = await supabase
      .from("votes")
      .select("voter_id, group_name, vote_date, option, poll_name, created_at")
      .gte("vote_date", thresholdDate)
      .order("vote_date", { ascending: false })
      .limit(10000);

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
      // Garante que votos são objetos com option e timestamp
      let voteObj = row.option;
      if (typeof row.option === "string") {
        voteObj = { option: row.option, timestamp: row.created_at };
      }
      stats[date].grupos[row.group_name].votes[row.voter_id] = voteObj;
    });

    // Verificar se houve enquete hoje
    const todayStr = moment().tz("America/Sao_Paulo").format("YYYY-MM-DD");
    const { data: pollHist } = await supabase
      .from("poll_history")
      .select("poll_date")
      .eq("poll_date", todayStr);
    const isPollSentToday = pollHist && pollHist.length > 0;

    return { rawDB: stats, isPollSentToday };
  } catch (e) {
    console.error("Erro ao ler stats do Supabase:", e.message);
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
      let status = `${count}/${cap}`;

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
    
    // Busca todos para verificar se o telefone já existe (considerando variações de formato)
    const { data: allPassengers } = await supabase
      .from("passengers")
      .select("id, phone");

    const existing = allPassengers?.find(p => normalizePhone(p.phone) === phone);

    if (!existing) {
      const config = configService.getConfig();
      const targetGroups = config.targetGroups || [];
      const busIndex = targetGroups.indexOf(groupName);
      const busNumber = busIndex !== -1 ? busIndex + 1 : 1;
      
      await supabase.from("passengers").insert({
        name: voterName || "Aluno Novo",
        phone: phone, // Armazena apenas os dígitos para consistência
        bus_number: busNumber,
        status: "aprovado",
        registration_number: "AUTO_" + phone.slice(-6) // Fallback para campo único
      });
    }
  } catch (err) {
    console.error("[Stats] Erro no auto-registro:", err.message);
  }

  if (vote.selectedOptions && vote.selectedOptions.length > 0) {
    const selectedOption = vote.selectedOptions[0].name;
    // Upsert no Supabase
    await supabase.from("votes").upsert(
      {
        voter_id: voterId,
        group_name: groupName,
        vote_date: todayStr,
        option: selectedOption,
        poll_name: pollName,
      },
      { onConflict: "voter_id,group_name,vote_date" },
    );
  } else {
    // Deletar voto (desmarcado)
    await supabase
      .from("votes")
      .delete()
      .match({ voter_id: voterId, group_name: groupName, vote_date: todayStr });
  }

  // Atualiza ocupação no terminal imediatamente (leve)
  await updateTerminalOccupancy();

  // REMOVIDO: Escrita recorrente de HTML em disco (I/O pesado)
  // O dashboard web agora consome os dados via /api/stats
};

const getDashboardData = async () => {
  const stats = await readStats();
  const config = configService.getConfig();
  const weather = weatherService.getWeather();
  const weatherLastUpdate = weatherService.lastUpdate ? 
    moment(weatherService.lastUpdate).tz("America/Sao_Paulo").format("HH:mm") : "--:--";

  // Buscar passageiros
  let passengers = [];
  try {
    const { data, error } = await supabase
      .from("passengers")
      .select("name, phone, photo_url, bus_number, status");

    const targetGroups = config.targetGroups || [];

    if (!error && data) {
      passengers = data
        .filter(
          (p) =>
            p.status === "aprovativo" || p.status === "aprovado" || !p.status,
        )
        .map((p) => {
          const gName = targetGroups[p.bus_number - 1] || "Desconhecido";
          return {
            ...p,
            group_name: gName,
            jid: normalizePhone(p.phone || ""),
          };
        });
    }
  } catch (e) {
    console.error("Erro ao buscar passageiros para API:", e.message);
  }

  return {
    votes: stats.rawDB || {},
    isPollSentToday: !!stats.isPollSentToday,
    passengers: passengers,
    capacities: config.groupCapacities || {},
    aliases: config.groupAliases || {},
    skipDates: config.skipDates || {},
    pollTime: config.pollTime || "05:30",
    targetGroups: config.targetGroups || [],
    weather: weather,
    weatherLastUpdate: weatherLastUpdate,
    lastUpdate: moment().tz("America/Sao_Paulo").format("DD/MM/YYYY HH:mm:ss")
  };
};

const generateHtmlDashboard = async (stats) => {
  // Chamado apenas uma vez na inicialização ou se o arquivo não existir
  if (fs.existsSync(htmlFile)) return;
  
  dashboard.addLog("[Stats] Gerando template estático inicial do Dashboard.");

  // Inject the raw JS object directly into HTML for dynamic reading
  const statsJSONStr = JSON.stringify(stats.rawDB);
  const passengersJSONStr = JSON.stringify(passengers);
  const isPollSentToday = !!stats.isPollSentToday;
  const lastUpdateFormated = moment()
    .tz("America/Sao_Paulo")
    .format("DD/MM/YYYY HH:mm:ss");
  
  const weatherLastUpdate = weatherService.lastUpdate ? 
    moment(weatherService.lastUpdate).tz("America/Sao_Paulo").format("HH:mm") : "--:--";

  // Dados de Clima
  const weather = weatherService.getWeather();
  const weatherJSONStr = JSON.stringify(weather);

  let capacities = {};
  let aliases = {};
  const config = configService.getConfig();
  capacities = config.groupCapacities || {};
  aliases = config.groupAliases || {};
  const capacitiesJSONStr = JSON.stringify(capacities);
  const aliasesJSONStr = JSON.stringify(aliases);
  const skipDatesJSONStr = JSON.stringify(config.skipDates || {});
  const pollTimeStr = config.pollTime || "06:00";
  const targetGroupsJSONStr = JSON.stringify(config.targetGroups || []);

  const htmlContent = `
<!DOCTYPE html>
<html lang="pt-BR">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Estatísticas das Enquetes</title>
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Inter:ital,opsz,wght@0,14..32,100..900;1,14..32,100..900&display=swap" rel="stylesheet">
    <script src="https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.min.js" crossorigin="anonymous" referrerpolicy="no-referrer"></script>
    <script src="https://cdnjs.cloudflare.com/ajax/libs/moment.js/2.29.4/moment.min.js"></script>
    <script src="https://cdnjs.cloudflare.com/ajax/libs/moment-timezone/0.5.43/moment-timezone-with-data.min.js"></script>
    <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
    <script src="https://unpkg.com/lucide@latest"></script>
    <style>
        :root {
            --bg-color: #121212;
            --card-bg: #1e1e1e;
            --text-color: #e0e0e0;
            --accent: #2196f3;
            --accent-glow: rgba(33, 150, 243, 0.3);
            --title-color: #ffffff;
            --border-color: #333333;
            --peak-color: #4caf50;
            --valley-color: #f44336;
            --pending-color: #ff9800;
            --weather-bg: linear-gradient(135deg, #1e3a8a, #1e40af);
        }
        * {
            box-sizing: border-box;
            transition: background-color 0.3s, border-color 0.3s;
        }
        body {
            font-family: 'Inter', -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
            background-color: var(--bg-color);
            color: var(--text-color);
            margin: 0;
            padding: 20px;
            display: flex;
            flex-direction: column;
            align-items: center;
        }
        h1 {
            color: var(--title-color);
            margin-bottom: 30px;
            font-weight: 800;
            letter-spacing: -0.02em;
        }
        .controls {
            margin-bottom: 30px;
            display: flex;
            gap: 15px;
            flex-wrap: wrap;
            justify-content: center;
            width: 100%;
            max-width: 1000px;
        }
        select {
            padding: 12px 20px;
            border-radius: 12px;
            border: 1px solid var(--border-color);
            background-color: var(--card-bg);
            color: var(--text-color);
            font-size: 0.95rem;
            font-weight: 500;
            cursor: pointer;
            outline: none;
            box-shadow: 0 4px 6px rgba(0,0,0,0.1);
            min-width: 180px;
        }
        select:hover {
            border-color: var(--accent);
        }
        .dashboard {
            display: flex;
            flex-wrap: wrap;
            gap: 25px;
            width: 100%;
            max-width: 1100px;
            margin: 0 auto;
            justify-content: center;
        }
        .highlights {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
            gap: 20px;
            width: 100%;
            margin-bottom: 25px;
        }
        .highlight-card {
            background: linear-gradient(145deg, #1e1e1e, #161616);
            padding: 20px;
            border-radius: 16px;
            border: 1px solid var(--border-color);
            text-align: center;
            position: relative;
            overflow: hidden;
        }
        .highlight-card::after {
            content: '';
            position: absolute;
            top: 0; left: 0; width: 4px; height: 100%;
            background: var(--accent);
        }
        .card-title h3 {
            margin: 0 0 15px 0;
            font-size: 0.85rem;
            text-transform: uppercase;
            letter-spacing: 0.1em;
            color: #888;
        }
        .split-container {
            display: flex;
            justify-content: center;
            gap: 15px;
        }
        .split-half {
            flex: 1;
            display: flex;
            flex-direction: column;
            align-items: center;
        }
        .split-half .label {
            font-size: 0.7rem;
            font-weight: 800;
            margin-bottom: 4px;
        }
        .split-peak .label { color: var(--peak-color); }
        .split-valley .label { color: var(--valley-color); }

        .split-half .value {
            font-size: 1.8rem;
            font-weight: 800;
            color: var(--title-color);
            line-height: 1;
        }
        .split-half .date {
            font-size: 0.75rem;
            color: #666;
            margin-top: 4px;
        }
        @media (max-width: 480px) {
            .dashboard {
                grid-template-columns: 1fr;
            }
            .split-half .value {
                font-size: 1.4rem;
            }
        }
        .summary-card {
            display: flex;
            flex-direction: row;
            justify-content: space-between;
            align-items: center;
            padding: 25px 40px;
            background: linear-gradient(145deg, #1e1e1e, #161616);
            border-radius: 16px;
            border: 1px solid var(--border-color);
            max-width: 1100px;
            margin: 10px auto 30px auto;
            width: 100%;
            gap: 20px;
        }
        .summary-item {
            flex: 1;
            text-align: center;
            position: relative;
        }
        .summary-item:not(:last-child)::after {
            content: '';
            position: absolute;
            right: -10px;
            top: 20%;
            height: 60%;
            width: 1px;
            background: rgba(255, 255, 255, 0.1);
        }
        .summary-item h3 {
            margin: 0 0 8px 0;
            color: #7f8c8d;
            font-size: 0.8rem;
            text-transform: uppercase;
            letter-spacing: 0.05em;
        }
        .summary-item p {
            margin: 0;
            font-size: 2rem;
            font-weight: 800;
            color: var(--title-color);
        }
        .summary-item p.accent-val {
            color: var(--accent);
            text-shadow: 0 0 15px var(--accent-glow);
        }
        .card {
            background-color: var(--card-bg);
            border-radius: 12px;
            box-shadow: 0 4px 6px rgba(0,0,0,0.3);
            padding: 20px;
            display: flex;
            flex-direction: column;
            align-items: center;
            border: 1px solid var(--border-color);
            flex: 1 1 400px;
            max-width: 100%;
        }
        .card.card-wide {
            flex: 1 1 100%;
        }
        .card h2 {
            font-size: 1.2rem;
            margin-bottom: 20px;
            color: var(--title-color);
        }
        .chart-container {
            position: relative;
            width: 100%;
            height: 300px;
        }
        .footer {
            margin-top: 40px;
            font-size: 0.9rem;
            color: #7f8c8d;
            max-width: 1100px;
            width: 100%;
            margin: 40px auto;
            text-align: center;
            border-top: 1px solid var(--border-color);
            padding-top: 30px;
        }
        
        /* Novas Estilizações para o Feed */
        .feed-container {
            width: 100%;
            max-width: 1100px;
            margin: 30px auto;
        }
        .feed-table {
            width: 100%;
            border-collapse: separate;
            border-spacing: 0 8px;
            margin-top: 20px;
        }
        .feed-table th {
            text-align: left;
            padding: 12px 15px;
            font-size: 0.75rem;
            text-transform: uppercase;
            color: #888;
            letter-spacing: 0.05em;
        }
        .feed-row {
            background-color: var(--card-bg);
            transition: transform 0.2s, background-color 0.2s;
        }
        .feed-row:hover {
            transform: scale(1.01);
            background-color: #252525;
        }
        .feed-row td {
            padding: 15px;
            border-top: 1px solid var(--border-color);
            border-bottom: 1px solid var(--border-color);
        }
        .feed-row td:first-child { border-left: 1px solid var(--border-color); border-radius: 12px 0 0 12px; }
        .feed-row td:last-child { border-right: 1px solid var(--border-color); border-radius: 0 12px 12px 0; }
        
        .user-cell {
            display: flex;
            align-items: center;
            gap: 12px;
        }
        .user-avatar {
            width: 36px;
            height: 36px;
            border-radius: 50%;
            object-fit: cover;
            background-color: #333;
        }
        .user-name {
            font-weight: 600;
            font-size: 0.9rem;
        }
        .tag {
            padding: 4px 10px;
            border-radius: 20px;
            font-size: 0.7rem;
            font-weight: 700;
            text-transform: uppercase;
        }
        .tag-route { background: rgba(33, 150, 243, 0.15); color: var(--accent); }
        .tag-vote { background: rgba(76, 175, 80, 0.15); color: #4caf50; }
        .tag-waiting { background: rgba(255, 152, 0, 0.15); color: #ff9800; }
        .tag-absence { background: rgba(244, 67, 54, 0.15); color: #f44336; }
        .timestamp-cell {
            font-size: 0.8rem;
            color: #777;
            font-family: monospace;
        }
        .live-indicator {
            display: inline-flex;
            align-items: center;
            gap: 5px;
            font-size: 0.7rem;
            font-weight: 800;
            color: #4caf50;
        }
        .dot {
            width: 6px;
            height: 6px;
            background-color: #4caf50;
            border-radius: 50%;
            animation: pulse 1.5s infinite;
        }
        @keyframes pulse {
            0% { opacity: 0.4; }
            50% { opacity: 1; }
            100% { opacity: 0.4; }
        }

        /* Paginação e Botão Ver Mais */
        .load-more-container {
            text-align: center;
            margin-top: 20px;
            padding-bottom: 20px;
        }
        .btn-load-more {
            background: rgba(33, 150, 243, 0.1);
            color: var(--accent);
            border: 1px solid var(--accent);
            padding: 10px 25px;
            border-radius: 25px;
            font-weight: 600;
            cursor: pointer;
            transition: all 0.2s;
        }
        .btn-load-more:hover {
            background: var(--accent);
            color: white;
            box-shadow: 0 0 15px var(--accent-glow);
        }
        .btn-load-more:disabled {
            opacity: 0.5;
            cursor: not-allowed;
            border-color: #555;
            color: #777;
            background: transparent;
        }

        /* Tabs para Feed e Pendentes */
        .feed-tabs {
            display: flex;
            gap: 10px;
            margin-bottom: 15px;
        }
        .feed-tab {
            padding: 8px 16px;
            border-radius: 8px;
            cursor: pointer;
            font-size: 0.85rem;
            font-weight: 600;
            background: #252525;
            color: #888;
            transition: all 0.2s;
        }
        .feed-tab.active {
            background: var(--accent);
            color: white;
        }

        /* Próximas Enquetes - Redesign */
        #nextPollsList {
            display: flex;
            flex-direction: column;
        }
        .poll-item {
            display: flex;
            align-items: center;
            padding: 14px 0;
            border-bottom: 1px solid rgba(255, 255, 255, 0.05);
            gap: 15px;
            transition: background 0.2s;
        }
        .poll-item:last-child {
            border-bottom: none;
        }
        .calendar-box {
            width: 52px;
            height: 52px;
            background: #161616;
            border-radius: 12px;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            border: 1px solid rgba(255, 255, 255, 0.08);
            flex-shrink: 0;
        }
        .calendar-box .cal-icon {
            color: #666;
            margin-bottom: 4px;
            width: 16px;
            height: 16px;
        }
        .calendar-box .cal-date {
            font-size: 9px;
            font-weight: 600;
            color: #ddd;
            text-transform: uppercase;
            line-height: 1.1;
            text-align: center;
        }
        .poll-info {
            flex: 1;
            display: flex;
            flex-direction: column;
        }
        .poll-title {
            font-size: 0.95rem;
            font-weight: 600;
            color: #ffffff;
            margin-bottom: 1px;
        }
        .poll-subtitle {
            font-size: 0.8rem;
            color: #888888;
        }
        .status-badge {
            padding: 4px 14px;
            border-radius: 20px;
            font-size: 0.75rem;
            font-weight: 600;
            border: 1px solid transparent;
            white-space: nowrap;
        }
        .status-agendada {
            background: rgba(76, 175, 80, 0.1);
            color: #4caf50;
            border-color: rgba(76, 175, 80, 0.2);
        }
        .status-pendente {
            background: rgba(255, 152, 0, 0.1);
            color: #ff9800;
            border-color: rgba(255, 152, 0, 0.2);
        }
        .status-rascunho {
            background: rgba(158, 158, 158, 0.1);
            color: #9e9e9e;
            border-color: rgba(158, 158, 158, 0.2);
        }
        .status-bloqueada {
            background: rgba(244, 67, 54, 0.05);
            color: #f44336;
            border-color: rgba(244, 67, 54, 0.1);
            opacity: 0.6;
        }
        .poll-weather {
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            min-width: 50px;
            gap: 2px;
            font-size: 0.75rem;
            font-weight: 700;
            color: #ddd;
            margin: 0 10px;
        }
        .poll-weather-icon {
            width: 18px;
            height: 18px;
            opacity: 0.9;
        }
        /* Widget de Clima */
        .weather-widget {
            display: flex;
            align-items: center;
            background: var(--weather-bg);
            padding: 15px 25px;
            border-radius: 16px;
            margin-bottom: 25px;
            color: #fff;
            box-shadow: 0 10px 20px rgba(0,0,0,0.2);
            gap: 20px;
            animation: fadeIn 0.8s ease-out;
        }
        .weather-info {
            display: flex;
            flex-direction: column;
        }
        .weather-temp {
            font-size: 2.2rem;
            font-weight: 800;
            line-height: 1;
        }
        .weather-desc {
            font-size: 0.85rem;
            font-weight: 500;
            opacity: 0.9;
            text-transform: capitalize;
        }
        .weather-details {
            display: flex;
            gap: 15px;
            margin-top: 5px;
            font-size: 0.75rem;
            opacity: 0.8;
        }
        .weather-icon-large {
            width: 48px;
            height: 48px;
        }
        @keyframes fadeIn {
            from { opacity: 0; transform: translateY(-10px); }
            to { opacity: 1; transform: translateY(0); }
        }
    </style>
</head>
<body>

    <div style="width: 100%; max-width: 1100px; margin: 0 auto; display: flex; flex-direction: column; align-items: center;">
        
        <h1>Estatísticas das Enquetes</h1>

        <div class="controls">
            <select id="groupSelect">
                <option value="Todos">Todos os Grupos</option>
                <!-- Preenchido via JS -->
            </select>

            <select id="periodSelect">
                <option value="7" selected>Últimos 7 dias</option>
                <option value="15">Últimos 15 dias</option>
                <option value="30">Últimos 30 dias</option>
                <option value="60">Últimos 2 meses</option>
                <option value="90">Últimos 3 meses</option>
                <option value="365">Últimos 12 meses</option>
            </select>
        </div>
    </div>

    <!-- Barra de Lotação do Dia -->
    <div id="capacitySection" style="display: none; width: 100%; max-width: 1100px; margin: 0 auto 25px auto;">
        <div class="card" style="width: 100%; align-items: stretch; padding: 25px; box-sizing: border-box;">
            <div id="totalBusVotes" style="font-size: 0.85rem; font-weight: 600; color: var(--accent); margin-bottom: 5px; text-align: center; width: 100%;"></div>
            <div id="capacityList" style="padding-top: 15px;">
                <!-- Preenchido via JS -->
            </div>
        </div>
    </div>

    <div class="dashboard">
        <div class="card">
            <h2 id="titlePieChart">Consolidado Geral</h2>
            <div class="chart-container">
                <canvas id="pieChart"></canvas>
            </div>
        </div>

        <div class="card">
            <h2 id="titleBarChart">Votos por Dia</h2>
            <div class="chart-container">
                <canvas id="barChart"></canvas>
            </div>
        </div>
        
        <div class="card card-wide" style="position: relative;">
            <div style="display: flex; justify-content: space-between; align-items: center; width: 100%; margin-bottom: 20px; flex-wrap: wrap; gap: 10px;">
                <h2 id="titleStackedBarChart" style="margin: 0;">Proporção Diária</h2>
                <select id="chartTypeSelect" style="min-width: 150px; padding: 8px 12px; font-size: 0.85rem; border-radius: 8px;">
                    <option value="bar">Barras Empilhadas</option>
                    <option value="line">Áreas (Linhas)</option>
                    <option value="radar">Radar</option>
                    <option value="polarArea">Área Polar</option>
                </select>
            </div>
            <div class="chart-container">
                <canvas id="stackedBarChart"></canvas>
            </div>
        </div>

        <!-- Cards de MAXs e MININ.s agora abaixo da Proporção Diária -->
        <div class="highlights">
            <div class="highlight-card">
                <div class="card-title"><h3>Ida/Volta</h3></div>
                <div class="split-container">
                    <div class="split-half split-peak">
                        <span class="label">MÁXIMO</span>
                        <span class="value" id="hlLotacaoVal">-</span>
                        <span class="date" id="hlLotacaoDate">-</span>
                    </div>
                    <div class="split-half split-valley">
                        <span class="label">MÍNIMO</span>
                        <span class="value" id="hlLotacaoMinVal">-</span>
                        <span class="date" id="hlLotacaoMinDate">-</span>
                    </div>
                </div>
            </div>
            <div class="highlight-card">
                <div class="card-title"><h3>Ausência</h3></div>
                <div class="split-container">
                    <div class="split-half split-peak">
                        <span class="label">MÁXIMO</span>
                        <span class="value" id="hlAusenciaVal">-</span>
                        <span class="date" id="hlAusenciaDate">-</span>
                    </div>
                    <div class="split-half split-valley">
                        <span class="label">MÍNIMO</span>
                        <span class="value" id="hlAusenciaMinVal">-</span>
                        <span class="date" id="hlAusenciaMinDate">-</span>
                    </div>
                </div>
            </div>
            <div class="highlight-card">
                <div class="card-title"><h3>Só Ida</h3></div>
                <div class="split-container">
                    <div class="split-half split-peak">
                        <span class="label">MÁXIMO</span>
                        <span class="value" id="hlSoIdaVal">-</span>
                        <span class="date" id="hlSoIdaDate">-</span>
                    </div>
                    <div class="split-half split-valley">
                        <span class="label">MÍNIMO</span>
                        <span class="value" id="hlSoIdaMinVal">-</span>
                        <span class="date" id="hlSoIdaMinDate">-</span>
                    </div>
                </div>
            </div>
            <div class="highlight-card">
                <div class="card-title"><h3>Só Volta</h3></div>
                <div class="split-container">
                    <div class="split-half split-peak">
                        <span class="label">MÁXIMO</span>
                        <span class="value" id="hlSoVoltaVal">-</span>
                        <span class="date" id="hlSoVoltaDate">-</span>
                    </div>
                    <div class="split-half split-valley">
                        <span class="label">MÍNIMO</span>
                        <span class="value" id="hlSoVoltaMinVal">-</span>
                        <span class="date" id="hlSoVoltaMinDate">-</span>
                    </div>
                </div>
            </div>
            <div class="highlight-card" style="background: linear-gradient(145deg, #1e1e1e, #1a2a1a);">
                <div class="card-title"><h3>Mais Presença</h3></div>
                <div class="split-container">
                    <div class="split-half split-peak" style="align-items: center; text-align: center;">
                        <span class="label" id="hlWeekdayPeakLabel">DIA DE PICO</span>
                        <span class="value" id="hlWeekdayPeakVal">-</span>
                        <span class="date" id="hlWeekdayPeakDate">Carregando...</span>
                    </div>
                </div>
            </div>
            <div class="highlight-card" style="background: linear-gradient(145deg, #1e1e1e, #2a1a1a);">
                <div class="card-title"><h3>Menos Presença</h3></div>
                <div class="split-container">
                    <div class="split-half split-valley" style="align-items: center; text-align: center;">
                        <span class="label" id="hlWeekdayValleyLabel">DIA MÍNIMO</span>
                        <span class="value" id="hlWeekdayValleyVal">-</span>
                        <span class="date" id="hlWeekdayValleyDate">Carregando...</span>
                    </div>
                </div>
            </div>
        </div>

        <!-- Calendário de Próximas Enquetes (Item 9) -->
        <div id="calendarSection" style="width: 100%;">
            <div class="card card-wide" style="align-items: stretch;">
                <h2 style="margin-bottom: 15px;">Próximas Enquetes</h2>
                <div id="nextPollsList" style="display: flex; flex-direction: column; gap: 8px;">
                    <!-- Preenchido via JS com layout de lista premium -->
                </div>
            </div>
        </div>
        
        <div class="summary-card">
            <div class="summary-item">
                <h3 id="lblTotalVotesTitle">Total Votos (7 dias)</h3>
                <p id="lblTotalVotes">0</p>
            </div>
            <div class="summary-item">
                <h3>Média Diária</h3>
                <p id="lblAverage">0</p>
            </div>
            <div class="summary-item">
                <h3>Tempo Médio Voto</h3>
                <p id="lblAvgVoteTime" class="accent-val">--</p>
            </div>
        </div>

        <div class="feed-container">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 15px; flex-wrap: wrap; gap: 10px;">
                <div style="display: flex; align-items: center; gap: 15px;">
                    <h2 style="margin: 0; font-size: 1.2rem;">Relatório de Respostas</h2>
                    <div class="live-indicator"><div class="dot"></div> LIVE</div>
                </div>
                <div class="feed-tabs">
                    <div class="feed-tab active" id="tabVotes" onclick="switchFeedTab('votes')">Votos do Dia</div>
                    <div class="feed-tab" id="tabPending" onclick="switchFeedTab('pending')">Aguardando Resposta</div>
                </div>
            </div>
            
            <div class="card card-wide" style="padding: 0; border: none; background: transparent; box-shadow: none;">
                <table class="feed-table">
                    <thead>
                        <tr id="feedHeader">
                            <th>Horário</th>
                            <th>Estudante</th>
                            <th>Rota</th>
                            <th>Resposta</th>
                        </tr>
                    </thead>
                    <tbody id="voteFeedBody">
                        <!-- Preenchido via JS -->
                    </tbody>
                </table>
                <div id="loadMoreContainer" class="load-more-container">
                    <button id="btnLoadMore" class="btn-load-more" onclick="loadMoreVotes()">Ver Mais</button>
                </div>
            </div>
        </div>
    </div>

    <div class="footer">
        <p style="margin: 0; font-weight: 600;">Atualizado: <span id="lblLastUpdate">${lastUpdateFormated}</span></p>
        <p style="margin: 8px 0 0 0; opacity: 0.7;">&copy; <span id="copyrightYear">2026</span> Grupo Britto. Todos os direitos reservados.</p>
    </div>

    <script>
        // Variáveis globais inicializadas vazias (serão preenchidas via fetch)
        let rawDB = {};
        let passengers = [];
        let isPollSentToday = false;
        let capacities = {};
        let groupAliases = {};
        let skipDates = {};
        let pollTime = "05:30";
        let targetGroups = [];
        let weatherData = null;
        let weatherLastUpdateStr = "--:--";
        
        let lastNotifiedCount = {}; // Para o item 4
        let notificationEnabled = false;
        
        // Estado do Feed
        let currentFeedTab = 'votes';
        let feedLimit = 10;
        let currentTargetGroup = "Todos";
        const optionColors = {
            "Irei, ida e volta.": "#4caf50",
            "Irei, mas não retornarei.": "#2196f3",
            "Não irei, apenas retornarei.": "#ff9800",
            "Não irei à faculdade hoje.": "#f44336"
        };

        let pieChartIns = null;
        let barChartIns = null;
        let stackedChartIns = null;

        const normalizePhone = (p) => {
            if (!p) return "";
            let digits = p.replace(/\D/g, "");
            if (digits.length === 11 && digits.startsWith("0")) digits = digits.substring(1);
            if (digits.length <= 11) digits = "55" + digits;
            // Caso especial: WhatsApp remove o 9 extra de certas regiões em alguns JIDs
            // Se tiver 13 dígitos e começar com 55, tentamos também a versão com 12 dígitos
            return digits;
        };

        const getPassengerByJid = (jid) => {
            if (!jid) return null;
            const jidDigits = jid.split('@')[0];
            
            // Tenta match direto no telefone normalizado
            let found = passengers.find(p => normalizePhone(p.phone) === jidDigits);
            
            // Se não achou, tenta match ignorando o '9' extra (comum no BR)
            if (!found && jidDigits.length === 13 && jidDigits.startsWith("55")) {
                const withoutNine = jidDigits.substring(0, 4) + jidDigits.substring(5);
                found = passengers.find(p => normalizePhone(p.phone) === withoutNine);
            }
            if (!found && jidDigits.length === 12 && jidDigits.startsWith("55")) {
                const withNine = jidDigits.substring(0, 4) + "9" + jidDigits.substring(4);
                found = passengers.find(p => normalizePhone(p.phone) === withNine);
            }
            
            return found;
        };

        // Extracts all unique group names across entire DB history
        const extractGroups = () => {
            const groups = new Set();
            Object.values(rawDB).forEach(dayData => {
                if(dayData.Version2 && dayData.grupos) {
                    Object.keys(dayData.grupos).forEach(g => groups.add(g));
                } else {
                    // Legacy fallback
                    groups.add("Grupo Geral (Legado)");
                }
            });
            return Array.from(groups).sort();
        };

        const initSelects = () => {
            const gSelect = document.getElementById("groupSelect");
            extractGroups().forEach(g => {
                const opt = document.createElement("option");
                opt.value = g;
                opt.textContent = groupAliases[g] || g;
                gSelect.appendChild(opt);
            });

            gSelect.addEventListener("change", updateDash);
            document.getElementById("periodSelect").addEventListener("change", updateDash);
            document.getElementById("chartTypeSelect").addEventListener("change", updateChartsOnly);
            
            // Copyright dinâmico
            document.getElementById("copyrightYear").innerText = new Date().getFullYear();

            // Clima no Rodapé
            if (weatherLastUpdateStr !== "--:--") {
                document.getElementById("lblLastUpdate").innerHTML += ' <span style="margin-left: 10px; opacity: 0.7;">| Clima: ' + weatherLastUpdateStr + '</span>';
            }

            // Calendário de Enquetes
            const per = document.getElementById("periodSelect").value;
            updateNextPollsCalendar(per);
        };

        const updateWeatherWidget = () => {
            // Removido conforme solicitação (exibição apenas na lista)
        };

        const getWeatherIcon = (code, isDay = true) => {
            let iconName = "sun";
            if (code >= 1 && code <= 3) iconName = "cloud-sun";
            if (code >= 45 && code <= 48) iconName = "cloud-fog";
            if (code >= 51 && code <= 65) iconName = "cloud-rain";
            if (code >= 80 && code <= 82) iconName = "cloud-rain-wind";
            if (code >= 95) iconName = "cloud-lightning";
            if (!isDay && iconName === "sun") iconName = "moon";
            return iconName;
        };


        const updateChartsOnly = () => {
            const grp = document.getElementById("groupSelect").value;
            const per = document.getElementById("periodSelect").value;
            processData(grp, per);
        };

        const processData = (targetGroup, targetDaysStr) => {
            const targetDays = parseInt(targetDaysStr, 10);
            
            // Get all days from DB that are within the targetDays range (comparing string dates vs today)
            const todayMoment = moment().startOf('day');
            
            let barLabels = [];
            let barData = [];
            
            // Arrays for stacked chart
            let stackedData = {
                "Irei, ida e volta.": [],
                "Irei, mas não retornarei.": [],
                "Não irei, apenas retornarei.": [],
                "Não irei à faculdade hoje.": []
            };
            
            let globalOptionCounts = {
                "Irei, ida e volta.": 0,
                "Irei, mas não retornarei.": 0,
                "Não irei, apenas retornarei.": 0,
                "Não irei à faculdade hoje.": 0
            };

            let accumTotalVotes = 0;
            
            // Destaques de dias da semana
            let weekdayPresence = {
                0: { presence: 0, absence: 0, days: 0 }, 
                1: { presence: 0, absence: 0, days: 0 }, 
                2: { presence: 0, absence: 0, days: 0 },
                3: { presence: 0, absence: 0, days: 0 }, 
                4: { presence: 0, absence: 0, days: 0 }, 
                5: { presence: 0, absence: 0, days: 0 }, 
                6: { presence: 0, absence: 0, days: 0 }
            };

            // Trackers for highlights (Peaks and Valleys)
            let peakLotacao = { val: -1, date: "" };
            let valleyLotacao = { val: Infinity, date: "" };
            
            let peakAusencia = { val: -1, date: "" };
            let valleyAusencia = { val: Infinity, date: "" };
            
            let peakSoIda = { val: -1, date: "" };
            let valleySoIda = { val: Infinity, date: "" };
            
            let peakSoVolta = { val: -1, date: "" };
            let valleySoVolta = { val: Infinity, date: "" };

            const daysOfWeekBR = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];

            // For Average Vote Time
            let voteTimestamps = [];

            for (let i = targetDays - 1; i >= 0; i--) {
                const day = todayMoment.clone().subtract(i, 'days');
                const dateStr = day.format('YYYY-MM-DD');
                const displayDate = day.format('DD/MM');
                barLabels.push(displayDate);
                
                let dayTotal = 0;
                
                let dayCounts = {
                    "Irei, ida e volta.": 0,
                    "Irei, mas não retornarei.": 0,
                    "Não irei, apenas retornarei.": 0,
                    "Não irei à faculdade hoje.": 0
                };
                
                if (rawDB[dateStr]) {
                    const dayEntry = rawDB[dateStr];

                    // Determine if legacy or V2
                    let groupsToProcess = [];
                    if(dayEntry.Version2 && dayEntry.grupos) {
                        if (targetGroup === "Todos") {
                            groupsToProcess = Object.values(dayEntry.grupos);
                        } else if (dayEntry.grupos[targetGroup]) {
                            groupsToProcess = [ dayEntry.grupos[targetGroup] ];
                        }
                    } else if (!dayEntry.Version2) {
                        // Legacy data exists for this day
                        if (targetGroup === "Todos" || targetGroup === "Grupo Geral (Legado)") {
                            groupsToProcess = [ dayEntry ]; // DayEntry itself is the poll in legacy
                        }
                    }

                    groupsToProcess.forEach(groupPayload => {
                        if(!groupPayload.votes) return;
                        const voters = Object.keys(groupPayload.votes);
                        dayTotal += voters.length;

                        voters.forEach(v => {
                            const vData = groupPayload.votes[v];
                            const opt = typeof vData === 'object' ? vData.option : vData;
                            
                            if (globalOptionCounts[opt] !== undefined) globalOptionCounts[opt]++;
                            else globalOptionCounts[opt] = 1;

                            if (dayCounts[opt] !== undefined) dayCounts[opt]++;
                            
                            if (typeof vData === 'object' && vData.timestamp) {
                                voteTimestamps.push(moment(vData.timestamp));
                            }
                        });
                    });
                }

                // Check Peaks & Valleys
                // Lotação
                if (dayCounts["Irei, ida e volta."] > peakLotacao.val) {
                    peakLotacao.val = dayCounts["Irei, ida e volta."];
                    peakLotacao.date = displayDate;
                }
                if (dayCounts["Irei, ida e volta."] < valleyLotacao.val && dayTotal > 0) {
                    valleyLotacao.val = dayCounts["Irei, ida e volta."];
                    valleyLotacao.date = displayDate;
                }

                // Ausência
                if (dayCounts["Não irei à faculdade hoje."] > peakAusencia.val) {
                    peakAusencia.val = dayCounts["Não irei à faculdade hoje."];
                    peakAusencia.date = displayDate;
                }
                if (dayCounts["Não irei à faculdade hoje."] < valleyAusencia.val && dayTotal > 0) {
                    valleyAusencia.val = dayCounts["Não irei à faculdade hoje."];
                    valleyAusencia.date = displayDate;
                }

                // Só Ida
                if (dayCounts["Irei, mas não retornarei."] > peakSoIda.val) {
                    peakSoIda.val = dayCounts["Irei, mas não retornarei."];
                    peakSoIda.date = displayDate;
                }
                if (dayCounts["Irei, mas não retornarei."] < valleySoIda.val && dayTotal > 0) {
                    valleySoIda.val = dayCounts["Irei, mas não retornarei."];
                    valleySoIda.date = displayDate;
                }

                // Só Volta
                if (dayCounts["Não irei, apenas retornarei."] > peakSoVolta.val) {
                    peakSoVolta.val = dayCounts["Não irei, apenas retornarei."];
                    peakSoVolta.date = displayDate;
                }
                if (dayCounts["Não irei, apenas retornarei."] < valleySoVolta.val && dayTotal > 0) {
                    valleySoVolta.val = dayCounts["Não irei, apenas retornarei."];
                    valleySoVolta.date = displayDate;
                }

                stackedData["Irei, ida e volta."].push(dayCounts["Irei, ida e volta."]);
                stackedData["Irei, mas não retornarei."].push(dayCounts["Irei, mas não retornarei."]);
                stackedData["Não irei, apenas retornarei."].push(dayCounts["Não irei, apenas retornarei."]);
                stackedData["Não irei à faculdade hoje."].push(dayCounts["Não irei à faculdade hoje."]);

                barData.push(dayTotal);
                accumTotalVotes += dayTotal;

                if (dayTotal > 0) {
                    const dow = day.day();
                    const sumPresence = dayCounts["Irei, ida e volta."] + dayCounts["Irei, mas não retornarei."] + dayCounts["Não irei, apenas retornarei."];
                    const sumAbsence = dayCounts["Não irei à faculdade hoje."];
                    
                    weekdayPresence[dow].presence += sumPresence;
                    weekdayPresence[dow].absence += sumAbsence;
                    weekdayPresence[dow].days += 1;
                    console.log("[Stats] " + dateStr + " (" + daysOfWeekBR[dow] + "): Presença=" + sumPresence + ", Ausência=" + sumAbsence);
                }
            }

            // Calcula picos por dia da semana
            let bestDay = { dow: -1, avg: -1 };
            let worstDay = { dow: -1, avg: -1 };

            for (let d = 1; d <= 5; d++) { // Apenas dias úteis
                if (weekdayPresence[d].days > 0) {
                    const avgPresence = weekdayPresence[d].presence / weekdayPresence[d].days;
                    const avgAbsence = weekdayPresence[d].absence / weekdayPresence[d].days;
                    
                    if (avgPresence > bestDay.avg) { bestDay = { dow: d, avg: avgPresence }; }
                    // Item: Menos presença usa maior média de "Não irei"
                    if (avgAbsence > worstDay.avg) { worstDay = { dow: d, avg: avgAbsence }; }
                }
            }

            if (bestDay.dow !== -1) {
                document.getElementById("hlWeekdayPeakVal").innerText = daysOfWeekBR[bestDay.dow];
                document.getElementById("hlWeekdayPeakDate").innerText = "";
            }
            if (worstDay.dow !== -1) {
                document.getElementById("hlWeekdayValleyVal").innerText = daysOfWeekBR[worstDay.dow];
                document.getElementById("hlWeekdayValleyDate").innerText = "";
            }

            document.getElementById("lblTotalVotes").innerText = accumTotalVotes.toLocaleString('pt-BR');
            const totalTitle = document.getElementById("lblTotalVotesTitle");
            if (totalTitle) totalTitle.innerText = "Total Votos (" + targetDaysStr + " dias)";
            calculateAverageInterval(voteTimestamps);

            // Item 2 & 3: Títulos dinâmicos
            const pieTitle = document.getElementById("titlePieChart");
            const barTitle = document.getElementById("titleBarChart");
            const stackTitle = document.getElementById("titleStackedBarChart");
            
            if(pieTitle) pieTitle.innerText = "Consolidado Geral (" + targetDaysStr + " dias)";
            if(barTitle) barTitle.innerText = "Votos por Dia (" + targetDaysStr + " dias)";
            if(stackTitle) stackTitle.innerText = "Proporção Diária (" + targetDaysStr + " dias)";

            // Update Highlights
            const setHighlight = (valId, dateId, peakObj) => {
                const valEl = document.getElementById(valId);
                const dateEl = document.getElementById(dateId);
                if(peakObj.val !== -1 && peakObj.val !== Infinity) {
                    valEl.innerText = peakObj.val.toLocaleString('pt-BR');
                    dateEl.innerText = peakObj.date;
                } else {
                    valEl.innerText = "0";
                    dateEl.innerText = "Sem dados";
                }
            };

            setHighlight("hlLotacaoVal", "hlLotacaoDate", peakLotacao);
            setHighlight("hlLotacaoMinVal", "hlLotacaoMinDate", valleyLotacao);

            setHighlight("hlAusenciaVal", "hlAusenciaDate", peakAusencia);
            setHighlight("hlAusenciaMinVal", "hlAusenciaMinDate", valleyAusencia);

            setHighlight("hlSoIdaVal", "hlSoIdaDate", peakSoIda);
            setHighlight("hlSoIdaMinVal", "hlSoIdaMinDate", valleySoIda);

            setHighlight("hlSoVoltaVal", "hlSoVoltaDate", peakSoVolta);
            setHighlight("hlSoVoltaMinVal", "hlSoVoltaMinDate", valleySoVolta);
            
            const numActiveDays = targetDays; // Always use target days since we show all days now
            document.getElementById("lblAverage").innerText = (accumTotalVotes / numActiveDays).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

            // Atualizar Lotação do Dia (Hoje)
            updateCapacityCard(targetGroup);

            // Item 9: Próximas Enquetes
            updateNextPollsCalendar();

            // Item 2: Feed de Respostas
            updateVoteFeed(targetGroup);

            renderCharts(barLabels, barData, globalOptionCounts, stackedData);
        };

        const calculateAverageInterval = (timestamps) => {
            const label = document.getElementById("lblAvgVoteTime");
            if (!timestamps || timestamps.length < 2) {
                label.innerText = "--";
                return;
            }
            
            // Ordena por tempo
            timestamps.sort((a, b) => a.valueOf() - b.valueOf());
            
            let totalDiff = 0;
            let count = 0;
            
            for (let i = 1; i < timestamps.length; i++) {
                const diff = timestamps[i].diff(timestamps[i-1], 'seconds');
                // Ignora intervalos muito longos (mais de 2 horas) que podem ser entre polls de dias diferentes ou pausas longas
                if (diff > 0 && diff < 7200) { 
                    totalDiff += diff;
                    count++;
                }
            }
            
            if (count === 0) {
                label.innerText = "--";
                return;
            }
            
            const avgSeconds = totalDiff / count;
            if (avgSeconds < 60) {
                label.innerText = Math.round(avgSeconds) + "s";
            } else {
                label.innerText = Math.round(avgSeconds / 60) + "m " + Math.round(avgSeconds % 60) + "s";
            }
        };

        const switchFeedTab = (tab) => {
            currentFeedTab = tab;
            feedLimit = 10;
            document.getElementById('tabVotes').classList.toggle('active', tab === 'votes');
            document.getElementById('tabPending').classList.toggle('active', tab === 'pending');
            updateVoteFeed(currentTargetGroup);
        };

        const loadMoreVotes = () => {
            feedLimit += 10;
            updateVoteFeed(currentTargetGroup);
        };

        const updateVoteFeed = (targetGroup) => {
            currentTargetGroup = targetGroup;
            const body = document.getElementById("voteFeedBody");
            const header = document.getElementById("feedHeader");
            const btnContainer = document.getElementById("loadMoreContainer");
            if (!body) return;
            
            const formatPhone = (raw) => {
                let clean = raw.replace(/\D/g, "");
                if (clean.startsWith("55")) clean = clean.substring(2);
                if (clean.length < 10) return raw;
                const ddd = clean.substring(0, 2);
                const hasNine = clean.length === 11;
                const nine = hasNine ? clean.substring(2, 3) + "-" : "";
                const prefix = clean.substring(hasNine ? 3 : 2, hasNine ? 7 : 6);
                return "(" + ddd + ")" + nine + prefix + "-xxxx";
            };

            const todayStr = moment().tz("America/Sao_Paulo").format('YYYY-MM-DD');
            const dayEntry = rawDB[todayStr] || { grupos: {} };
            
            // Header dinâmico baseado na aba
            if (currentFeedTab === 'votes') {
                header.innerHTML = '<th>Horário</th><th>Estudante</th><th>Rota</th><th>Resposta</th>';
            } else {
                header.innerHTML = '<th>Estudante</th><th>Rota</th><th>Status</th>';
                if (!isPollSentToday) {
                    body.innerHTML = '<tr><td colspan="3" style="text-align: center; color: #555; padding: 40px;">' +
                        '<div style="margin-bottom: 10px; opacity: 0.5; font-size: 2rem;">🕒</div>' +
                        'Aguardando o envio da enquete de hoje (' + moment().tz("America/Sao_Paulo").format("DD/MM") + ').</td></tr>';
                    btnContainer.style.display = "none";
                    return;
                }
            }

            if (currentFeedTab === 'votes') {
                let allTodayVotes = [];
                Object.keys(dayEntry.grupos).forEach(gName => {
                    if (targetGroup !== "Todos" && gName !== targetGroup) return;
                    const groupData = dayEntry.grupos[gName];
                    Object.keys(groupData.votes).forEach(vId => {
                        const vData = groupData.votes[vId];
                        allTodayVotes.push({
                            voter_id: vId,
                            group: gName,
                            option: typeof vData === 'object' ? vData.option : vData,
                            timestamp: vData.timestamp || todayStr
                        });
                    });
                });

                allTodayVotes.sort((a, b) => moment(b.timestamp).valueOf() - moment(a.timestamp).valueOf());
                
                body.innerHTML = "";
                const visibleVotes = allTodayVotes.slice(0, feedLimit);
                
                if (visibleVotes.length === 0) {
                    body.innerHTML = '<tr><td colspan="4" style="text-align: center; color: #555; padding: 30px;">Nenhum voto registrado hoje.</td></tr>';
                    btnContainer.style.display = "none";
                } else {
                    visibleVotes.forEach(vote => {
                        const pass = getPassengerByJid(vote.voter_id);
                        const row = document.createElement("tr");
                        row.className = "feed-row";
                        const timeStr = vote.timestamp ? moment(vote.timestamp).tz("America/Sao_Paulo").format("HH:mm") : "--:--";
                        
                        // Máscara de Nome e Telefone: Nome - (DD)9-XXXX-xxxx
                        const voterIdDigit = vote.voter_id.split('@')[0];
                        const maskedPhone = formatPhone(voterIdDigit);
                        const rawName = pass ? pass.name : "Ext";
                        const firstName = rawName.split(' ')[0];
                        const displayName = firstName + " - " + maskedPhone;

                        const photo = (pass && pass.photo_url) ? pass.photo_url : "https://ui-avatars.com/api/?name=" + encodeURIComponent(displayName) + "&background=333&color=fff";
                        const routeAlias = groupAliases[vote.group] || vote.group;
                        let optClass = "tag-vote";
                        if (vote.option.includes("Não irei")) optClass = "tag-absence";
                        if (vote.option.includes("apenas retornarei")) optClass = "tag-waiting";
                        
                        row.innerHTML = ' \
                            <td class="timestamp-cell">' + timeStr + '</td> \
                            <td><div class="user-cell"><img src="' + photo + '" class="user-avatar" onerror="this.src=\\\'https://ui-avatars.com/api/?name=?\\\'"><span class="user-name">' + displayName + '</span></div></td> \
                            <td><span class="tag tag-route">' + routeAlias + '</span></td> \
                            <td><span class="tag ' + optClass + '">' + vote.option + '</span></td> \
                        ';
                        body.appendChild(row);
                    });
                    btnContainer.style.display = (allTodayVotes.length > feedLimit) ? "block" : "none";
                }
            } else {
                // Aba PENDENTES
                if (btnContainer) btnContainer.style.display = "none";
                const votersToday = [];
                Object.keys(dayEntry.grupos).forEach(gName => {
                    Object.keys(dayEntry.grupos[gName].votes).forEach(vId => votersToday.push(vId));
                });

                const tGroup = (targetGroup === "Todos") ? null : targetGroup;
                const pendingUsers = passengers.filter(p => {
                    if (tGroup && p.group_name !== tGroup) return false;
                    return !votersToday.includes(p.jid);
                });

                body.innerHTML = "";
                if (pendingUsers.length === 0) {
                    body.innerHTML = '<tr><td colspan="3" style="text-align: center; color: #4caf50; padding: 30px;">✅ Todos os passageiros votaram hoje!</td></tr>';
                } else {
                    pendingUsers.forEach(user => {
                        const row = document.createElement("tr");
                        row.className = "feed-row";
                        const routeAlias = groupAliases[user.group_name] || user.group_name;
                        const firstName = user.name.split(' ')[0];
                        const maskedPhone = formatPhone(user.phone || user.jid.split('@')[0]);
                        const displayName = firstName + " - " + maskedPhone;
                        const photo = user.photo_url || "https://ui-avatars.com/api/?name=" + encodeURIComponent(displayName) + "&background=333&color=fff";
                        
                        row.innerHTML = ' \
                            <td><div class="user-cell"><img src="' + photo + '" class="user-avatar" onerror="this.src=\\\'https://ui-avatars.com/api/?name=?\\\'"><span class="user-name">' + displayName + '</span></div></td> \
                            <td><span class="tag tag-route">' + routeAlias + '</span></td> \
                            <td><span class="tag tag-pending">PENDENTE</span></td> \
                        ';
                        body.appendChild(row);
                    });
                }
            }
        };

        const updateCapacityCard = (targetGroup) => {
            const todayStr = moment().startOf('day').format('YYYY-MM-DD');
            const capacitySection = document.getElementById("capacitySection");
            const capacityList = document.getElementById("capacityList");
            const totalLabel = document.getElementById("totalBusVotes");
            capacityList.innerHTML = "";
            
            let hasAnyCapacity = false;
            let totalVotes = 0;
            const dayEntry = rawDB[todayStr] || { Version2: true, grupos: {} };
            
            let groupsToShow = [];
            if (targetGroup === "Todos") {
                groupsToShow = Object.keys(capacities);
            } else if (capacities[targetGroup]) {
                groupsToShow = [targetGroup];
            }

            groupsToShow.forEach(gName => {
                let confirmations = 0;
                const groupData = dayEntry.grupos ? dayEntry.grupos[gName] : null;
                const votedCount = (groupData && groupData.votes) ? Object.keys(groupData.votes).length : 0;

                if (groupData && groupData.votes) {
                    Object.values(groupData.votes).forEach(vData => {
                        const opt = typeof vData === 'object' ? vData.option : vData;
                        if (opt === "Irei, ida e volta." || opt === "Irei, mas não retornarei." || opt === "Não irei, apenas retornarei.") {
                            confirmations++;
                        }
                    });
                }
                
                // Busca total de passageiros para esta rota (Item 3)
                // Usamos o mapeamento de bus_number (1, 2, 3) baseado na ordem do config
                const busIdx = targetGroups.indexOf(gName) + 1;
                const totalPassengers = passengers.filter(p => p.bus_number === busIdx).length;
                const pending = Math.max(0, totalPassengers - votedCount);

                totalVotes += confirmations;
                renderCompactBar(gName, confirmations, capacities[gName], pending);
                hasAnyCapacity = true;
            });

            if (totalLabel) totalLabel.innerText = "Total de votos: " + totalVotes;
            capacitySection.style.display = hasAnyCapacity ? "block" : "none";
        };

        const renderCompactBar = (name, count, cap, pending) => {
            const capacityList = document.getElementById("capacityList");
            const percentage = Math.round(Math.min(100, (count / cap) * 100));
            const displayName = groupAliases[name] || name;
            
            const isFull = count >= cap;
            const excess = count > cap ? (count - cap) : 0;
            
            const busColors = [
                { grad: 'linear-gradient(90deg, #2196f3, #4caf50)', glow: '#4caf50' },
                { grad: 'linear-gradient(90deg, #9c27b0, #00bcd4)', glow: '#00bcd4' },
                { grad: 'linear-gradient(90deg, #fb8c00, #ffeb3b)', glow: '#ffeb3b' },
                { grad: 'linear-gradient(90deg, #f44336, #e91e63)', glow: '#e91e63' },
                { grad: 'linear-gradient(90deg, #3f51b5, #2196f3)', glow: '#2196f3' }
            ];
            const colorIdx = Object.keys(capacities).indexOf(name) % busColors.length;
            let barStyle = busColors[colorIdx];

            if (isFull) {
                barStyle = { grad: 'linear-gradient(90deg, #f44336, #ff5252)', glow: '#ff5252' };
            }

            const container = document.createElement("div");
            container.style.marginBottom = "18px";

            const header = document.createElement("div");
            header.style.cssText = "display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;";

            const nameSpan = document.createElement("span");
            nameSpan.style.cssText = "font-size: 0.9rem; font-weight: 600; color: #fff; opacity: 0.9;";
            nameSpan.innerText = displayName;

            const infoDiv = document.createElement("div");
            infoDiv.style.cssText = "font-size: 0.9rem; font-weight: 500; color: #888; text-align: right;";
            
            let statusText = percentage + "% / " + count + " Votos";
            if (excess > 0) statusText = "Excesso: +" + excess + " / " + count + " Votos";
            else if (count === cap) statusText = "Lotado! / " + count + " Votos";
            
            infoDiv.innerText = statusText;
            if (isFull) {
                infoDiv.style.color = "#ff5252";
                infoDiv.style.fontWeight = "700";
            }

            header.appendChild(nameSpan);
            header.appendChild(infoDiv);

            const progressContainer = document.createElement("div");
            progressContainer.style.cssText = "width: 100%; height: 8px; background: #222; border-radius: 4px; overflow: visible;";

            const progressBar = document.createElement("div");
            progressBar.style.cssText = "height: 100%; background: " + barStyle.grad + "; border-radius: 4px; transition: width 1s cubic-bezier(0.4, 0, 0.2, 1); position: relative;";
            progressBar.style.width = percentage + "%";

            progressContainer.appendChild(progressBar);
            container.appendChild(header);
            container.appendChild(progressContainer);
            
            capacityList.appendChild(container);
        };

        const hexToRgba = (hex, alpha) => {
            const r = parseInt(hex.slice(1, 3), 16);
            const g = parseInt(hex.slice(3, 5), 16);
            const b = parseInt(hex.slice(5, 7), 16);
            return "rgba(" + r + ", " + g + ", " + b + ", " + alpha + ")";
        };

        const renderCharts = (barLabels, barData, pieCountsMap, stackedData) => {
            const selectedType = document.getElementById("chartTypeSelect").value;
            const isLine = selectedType === 'line';

            const pieLabels = Object.keys(pieCountsMap);
            const pieData = Object.values(pieCountsMap);
            const pieColors = pieLabels.map(l => optionColors[l] || "#9e9e9e");

            Chart.defaults.color = 'rgba(255, 255, 255, 0.7)';
            Chart.defaults.borderColor = 'rgba(255, 255, 255, 0.1)';
            Chart.defaults.font.family = "'Inter', sans-serif";

            if(pieChartIns) pieChartIns.destroy();
            const pieCtx = document.getElementById('pieChart').getContext('2d');
            pieChartIns = new Chart(pieCtx, {
                type: 'doughnut',
                data: {
                    labels: pieLabels,
                    datasets: [{
                        data: pieData,
                        backgroundColor: pieColors,
                        borderWidth: 0,
                        hoverOffset: 15
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    cutout: '70%',
                    plugins: { 
                        legend: { 
                            position: 'bottom',
                            labels: {
                                boxWidth: 12,
                                usePointStyle: true,
                                padding: 20,
                                font: { size: 11, weight: 600 }
                            }
                        } 
                    }
                }
            });

            if(barChartIns) barChartIns.destroy();
            const barCtx = document.getElementById('barChart').getContext('2d');
            barChartIns = new Chart(barCtx, {
                type: 'line',
                data: {
                    labels: barLabels,
                    datasets: [{
                        label: 'Votos',
                        data: barData,
                        borderColor: '#2196f3',
                        backgroundColor: (context) => {
                            const chart = context.chart;
                            const {ctx, chartArea} = chart;
                            if (!chartArea) return null;
                            const gradient = ctx.createLinearGradient(0, chartArea.top, 0, chartArea.bottom);
                            gradient.addColorStop(0, 'rgba(33, 150, 243, 0.3)');
                            gradient.addColorStop(1, 'rgba(33, 150, 243, 0)');
                            return gradient;
                        },
                        borderWidth: 3,
                        fill: true,
                        tension: 0.4,
                        pointRadius: 4,
                        pointBackgroundColor: '#2196f3',
                        pointBorderColor: '#fff',
                        pointBorderWidth: 2
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    scales: { 
                        y: { 
                            beginAtZero: true,
                            grid: { drawTicks: false },
                            border: { display: false }
                        },
                        x: {
                            grid: { display: false },
                            border: { display: false }
                        }
                    },
                    plugins: { legend: { display: false } }
                }
            });

            if(stackedChartIns) stackedChartIns.destroy();
            const stackedCtx = document.getElementById('stackedBarChart').getContext('2d');
            
            const datasets = [
                {
                    label: 'Só Volta',
                    data: stackedData["Não irei, apenas retornarei."],
                    backgroundColor: isLine ? (context => {
                        const chart = context.chart;
                        const {ctx, chartArea} = chart;
                        if (!chartArea) return null;
                        const gradient = ctx.createLinearGradient(0, chartArea.top, 0, chartArea.bottom);
                        gradient.addColorStop(0, hexToRgba(optionColors["Não irei, apenas retornarei."], 0.5));
                        gradient.addColorStop(1, hexToRgba(optionColors["Não irei, apenas retornarei."], 0));
                        return gradient;
                    }) : optionColors["Não irei, apenas retornarei."],
                    borderColor: optionColors["Não irei, apenas retornarei."],
                    fill: isLine,
                    tension: isLine ? 0.4 : 0,
                    pointRadius: isLine ? 2 : 0,
                    borderWidth: isLine ? 2 : 1
                },
                {
                    label: 'Só Ida',
                    data: stackedData["Irei, mas não retornarei."],
                    backgroundColor: isLine ? (context => {
                        const chart = context.chart;
                        const {ctx, chartArea} = chart;
                        if (!chartArea) return null;
                        const gradient = ctx.createLinearGradient(0, chartArea.top, 0, chartArea.bottom);
                        gradient.addColorStop(0, hexToRgba(optionColors["Irei, mas não retornarei."], 0.5));
                        gradient.addColorStop(1, hexToRgba(optionColors["Irei, mas não retornarei."], 0));
                        return gradient;
                    }) : optionColors["Irei, mas não retornarei."],
                    borderColor: optionColors["Irei, mas não retornarei."],
                    fill: isLine,
                    tension: isLine ? 0.4 : 0,
                    pointRadius: isLine ? 2 : 0,
                    borderWidth: isLine ? 2 : 1
                },
                {
                    label: 'Ausente',
                    data: stackedData["Não irei à faculdade hoje."],
                    backgroundColor: isLine ? (context => {
                        const chart = context.chart;
                        const {ctx, chartArea} = chart;
                        if (!chartArea) return null;
                        const gradient = ctx.createLinearGradient(0, chartArea.top, 0, chartArea.bottom);
                        gradient.addColorStop(0, hexToRgba(optionColors["Não irei à faculdade hoje."], 0.5));
                        gradient.addColorStop(1, hexToRgba(optionColors["Não irei à faculdade hoje."], 0));
                        return gradient;
                    }) : optionColors["Não irei à faculdade hoje."],
                    borderColor: optionColors["Não irei à faculdade hoje."],
                    fill: isLine,
                    tension: isLine ? 0.4 : 0,
                    pointRadius: isLine ? 2 : 0,
                    borderWidth: isLine ? 2 : 1
                },
                {
                    label: 'Ida e Volta',
                    data: stackedData["Irei, ida e volta."],
                    backgroundColor: isLine ? (context => {
                        const chart = context.chart;
                        const {ctx, chartArea} = chart;
                        if (!chartArea) return null;
                        const gradient = ctx.createLinearGradient(0, chartArea.top, 0, chartArea.bottom);
                        gradient.addColorStop(0, hexToRgba(optionColors["Irei, ida e volta."], 0.5));
                        gradient.addColorStop(1, hexToRgba(optionColors["Irei, ida e volta."], 0));
                        return gradient;
                    }) : optionColors["Irei, ida e volta."],
                    borderColor: optionColors["Irei, ida e volta."],
                    fill: isLine,
                    tension: isLine ? 0.4 : 0,
                    pointRadius: isLine ? 2 : 0,
                    borderWidth: isLine ? 2 : 1
                }
            ];

            const isPolar = selectedType === 'polarArea';
            let finalData;

            if (isPolar) {
                const labels = Object.keys(stackedData);
                const data = labels.map(k => (stackedData[k] || []).reduce((a, b) => a + b, 0));
                finalData = {
                    labels: labels,
                    datasets: [{
                        data: data,
                        backgroundColor: labels.map(k => optionColors[k]),
                        borderWidth: 1
                    }]
                };
            } else {
                finalData = {
                    labels: barLabels,
                    datasets: datasets
                };
            }

            stackedChartIns = new Chart(stackedCtx, {
                type: isLine ? 'line' : selectedType,
                data: finalData,
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    interaction: {
                        mode: 'index',
                        intersect: false,
                    },
                    scales: {
                        x: { 
                            display: !['radar', 'polarArea'].includes(selectedType),
                            stacked: selectedType === 'bar' 
                        },
                        y: { 
                            display: !['radar', 'polarArea'].includes(selectedType),
                            stacked: selectedType === 'bar', 
                            beginAtZero: true, 
                            grace: '10%' 
                        },
                        r: {
                            display: ['radar', 'polarArea'].includes(selectedType),
                            ticks: { display: false },
                            grid: { color: 'rgba(255, 255, 255, 0.05)' },
                            angleLines: { color: 'rgba(255, 255, 255, 0.1)' }
                        }
                    },
                    plugins: { 
                        legend: { 
                            position: 'bottom',
                            labels: {
                                boxWidth: 10,
                                padding: 8,
                                font: {
                                    size: window.innerWidth < 400 ? 8 : (window.innerWidth < 600 ? 9 : 12)
                                }
                            }
                        },
                        tooltip: {
                            mode: 'index',
                            intersect: false
                        }
                    }
                }
            });
        };

        const updateDash = () => {
            const grp = document.getElementById("groupSelect").value;
            const per = document.getElementById("periodSelect").value;
            processData(grp, per);
            updateNextPollsCalendar(per);
        };

        // Item 4: Notificações Automatizadas
        const initNotification = () => {
            if (!("Notification" in window)) return;
            
            if (Notification.permission === "default") {
                Notification.requestPermission().then(permission => {
                    if (permission === "granted") {
                        notificationEnabled = true;
                        new Notification("Dashboard", { body: "Notificações ativadas com sucesso!" });
                    }
                });
            } else if (Notification.permission === "granted") {
                notificationEnabled = true;
            }
        };

        // Item 9: Calendário de Próximas Enquetes (Lista Premium v2)
        const updateNextPollsCalendar = (limitDays = 7) => {
            const list = document.getElementById("nextPollsList");
            if (!list) return;
            list.innerHTML = "";
            
            const displayLimit = Math.min(30, parseInt(limitDays, 10)); // No máximo 30 dias para evitar excesso
            
            const daysOfWeekBR = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];
            const now = moment();
            let current = moment();
            const timeParts = pollTime.split(':');
            current.set({ hour: parseInt(timeParts[0]), minute: parseInt(timeParts[1]), second: 0 });
            
            if (current.isBefore(now)) {
                current.add(1, 'days');
            }
            
            let safetyLimit = displayLimit * 2; // Segurança para pular feriados/finais de semana
            
            for (let i = 0; i < displayLimit; i++) {
                const dayOfWeek = current.day();
                const isWeekend = (dayOfWeek === 0 || dayOfWeek === 6);
                const brDate = current.format('DD/MM/YYYY');
                const skipReason = skipDates[brDate];
                
                let reason = "";
                if (isWeekend) reason = "Fim de Semana";
                else if (skipReason) reason = skipReason;
                
                const row = document.createElement("div");
                row.className = "poll-item";

                const dateISO = current.format('YYYY-MM-DD');
                const dateDisplay = current.format('DD MMM'); // Ex: 08 Nov
                
                // Buscar Clima para este dia (Somente se não houver impedimento/feriado)
                let weatherHtml = "";
                if (!reason && weatherData && weatherData.daily && weatherData.daily.time) {
                    const idx = weatherData.daily.time.indexOf(dateISO);
                    if (idx !== -1) {
                        const code = weatherData.daily.weather_code[idx];
                        const max = Math.round(weatherData.daily.temperature_2m_max[idx]);
                        const min = Math.round(weatherData.daily.temperature_2m_min[idx]);
                        const icon = getWeatherIcon(code);
                        weatherHtml = ' \
                            <div class="poll-weather"> \
                                <i data-lucide="' + icon + '" class="poll-weather-icon"></i> \
                                <div>' + max + '° / ' + min + '°</div> \
                            </div> \
                        ';
                    }
                }

                const weekNum = current.isoWeek();
                
                if (reason) {
                    row.innerHTML = ' \
                        <div class="calendar-box" style="opacity: 0.5;"> \
                            <i data-lucide="calendar-x" class="cal-icon"></i> \
                            <div class="cal-date">' + dateDisplay + '</div> \
                        </div> \
                        <div class="poll-info" style="opacity: 0.5;"> \
                            <div class="poll-title">Indisponível</div> \
                            <div class="poll-subtitle">' + reason + '</div> \
                        </div> \
                        ' + weatherHtml + ' \
                        <div class="status-badge status-bloqueada">Offline</div> \
                    ';
                } else {
                    const duration = moment.duration(current.diff(now));
                    const d = Math.floor(duration.asDays());
                    const h = duration.hours();
                    const m = duration.minutes();
                    
                    let timeRemaining = "";
                    if (d > 0) timeRemaining = d + "d " + h + "h";
                    else if (h > 0) timeRemaining = h + "h " + m + "m";
                    else timeRemaining = m + "m";

                    row.innerHTML = ' \
                        <div class="calendar-box"> \
                            <i data-lucide="calendar" class="cal-icon"></i> \
                            <div class="cal-date">' + dateDisplay + '</div> \
                        </div> \
                        <div class="poll-info"> \
                            <div class="poll-title">Enquete de Frequência</div> \
                            <div class="poll-subtitle">Semana ' + weekNum + ' • ' + pollTime + '</div> \
                        </div> \
                        ' + weatherHtml + ' \
                        <div class="status-badge status-agendada">Agendada</div> \
                    ';
                }
                
                list.appendChild(row);
                current.add(1, 'days');
            }

            if (window.lucide) {
                lucide.createIcons();
            }
        };

        // Item 7: Reset automático à meia-noite
        let lastDay = moment().format('YYYY-MM-DD');
        const checkMidnightReset = () => {
            const currentDay = moment().format('YYYY-MM-DD');
            if (currentDay !== lastDay) {
                console.log("Meia-noite detectada! Resetando dados...");
                lastDay = currentDay;
                // Limpa notificações da mudança de dia e força update visual
                lastNotifiedCount = {};
                updateDash(); 
                fetchStats();
            }
        };

        // Boot instantâneo com carregamento de dados via API
        const loadInitialData = async () => {
            try {
                const res = await fetch('/api/stats');
                if (res.ok) {
                    const data = await res.json();
                    applyData(data);
                    
                    // Inicializa os selects somente após o primeiro carregamento
                    initSelects();
                    initNotification();
                    updateDash();
                }
            } catch (err) {
                console.error('Erro ao carregar dados iniciais:', err);
            }
        };

        const applyData = (data) => {
            rawDB = data.votes || {};
            passengers = data.passengers || [];
            isPollSentToday = !!data.isPollSentToday;
            capacities = data.capacities || {};
            groupAliases = data.aliases || {};
            skipDates = data.skipDates || {};
            pollTime = data.pollTime || "05:30";
            targetGroups = data.targetGroups || [];
            weatherData = data.weather || null;
            weatherLastUpdateStr = data.weatherLastUpdate || "--:--";
            
            if (data.lastUpdate) {
                document.getElementById('lblLastUpdate').innerText = data.lastUpdate;
            }
        };

        loadInitialData();
        
        // Auto-refresh via JS fetch para não piscar a tela
        const fetchStats = async () => {
            checkMidnightReset();
            try {
                const res = await fetch('/api/stats');
                if (res.ok) {
                    const data = await res.json();
                    
                    // Se houver mudança nos dados, atualiza
                    if (JSON.stringify(rawDB) !== JSON.stringify(data.votes) || isPollSentToday !== data.isPollSentToday) {
                        applyData(data);
                        updateDash(); // Re-render dos gráficos
                    }
                }
            } catch (err) {
                console.error('Erro no Auto-Refresh:', err);
            }
        };

        // Poll de 10 em 10 segundos
        setInterval(fetchStats, 10000);
    </script>
</body>
</html>
    `;

  fs.writeFileSync(htmlFile, htmlContent, "utf8");
};

module.exports = {
  registerVote,
  readStats,
  generateHtmlDashboard,
  updateTerminalOccupancy,
};
