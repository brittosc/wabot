const fs = require("fs");
const configService = require("./configService");
const moment = require("moment-timezone");
const dashboard = require("./dashboard");
const supabase = require("../database/supabaseClient");

const htmlFile = "./public/estatisticas.html";

const readStats = async () => {
  try {
    // Buscamos os últimos 10.000 votos (suficiente para vários meses)
    // Mais para frente, podemos otimizar filtrando apenas o período necessário
    const { data: rows, error } = await supabase
      .from("votes")
      .select("*")
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
      stats[date].grupos[row.group_name].votes[row.voter_id] = row.option;
    });
    return stats;
  } catch (e) {
    console.error("Erro ao ler stats do Supabase:", e.message);
    return {};
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
        Object.values(groupData.votes).forEach((opt) => {
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

const registerVote = async (vote) => {
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

  // Recarregar stats para atualizar terminal e dashboard
  const stats = await readStats();
  await updateTerminalOccupancy(stats);
  generateHtmlDashboard(stats);
};

const generateHtmlDashboard = (stats) => {
  // Inject the raw JS object directly into HTML for dynamic reading
  const statsJSONStr = JSON.stringify(stats);
  const lastUpdateFormated = moment()
    .tz("America/Sao_Paulo")
    .format("DD/MM/YYYY HH:mm:ss");

  let capacities = {};
  let aliases = {};
  const config = configService.getConfig();
  capacities = config.groupCapacities || {};
  aliases = config.groupAliases || {};
  const capacitiesJSONStr = JSON.stringify(capacities);
  const aliasesJSONStr = JSON.stringify(aliases);
  const skipDatesJSONStr = JSON.stringify(config.skipDates || {});
  const pollTimeStr = config.pollTime || "06:00";

  const htmlContent = `
<!DOCTYPE html>
<html lang="pt-BR">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Painel Avançado de Estatísticas</title>
    
    <!-- SEO Meta Tags -->
    <meta name="description" content="Acompanhe em tempo real a ocupação dos ônibus e estatísticas detalhadas de presença da faculdade.">
    <meta name="keywords" content="ônibus, universitário, estatísticas, enquetes, lotação, faculdade">
    <meta name="author" content="Mauricio de Britto">
    <meta name="theme-color" content="#2196f3">
    
    <!-- Open Graph / Social Media -->
    <meta property="og:type" content="website">
    <meta property="og:title" content="Painel de Estatísticas">
    <meta property="og:description" content="Dashboard interativo para monitoramento de transporte universitário.">
    <meta property="og:image" content="https://cdn-icons-png.flaticon.com/512/2850/2850383.png">
    
    <!-- PWA -->
    <link rel="manifest" href="/manifest.json">
    <link rel="icon" href="https://dayz.com/favicon.ico">
    <link rel="apple-touch-icon" href="https://cdn-icons-png.flaticon.com/512/2850/2850383.png">

    <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
    <script src="https://cdnjs.cloudflare.com/ajax/libs/moment.js/2.29.4/moment.min.js"></script>
    <style>
        :root {
            --bg-color: #121212;
            --card-bg: #1e1e1e;
            --text-color: #e0e0e0;
            --title-color: #ffffff;
            --accent: #2196f3;
            --border-color: #333;
        }
        html, body {
            max-width: 100%;
            overflow-x: hidden;
        }
        * {
            box-sizing: border-box;
        }
        body {
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            background-color: var(--bg-color);
            color: var(--text-color);
            margin: 0;
            padding: 10px;
            display: flex;
            flex-direction: column;
            align-items: center;
        }
        h1, h2, h3 {
            word-wrap: break-word;
            max-width: 100%;
        }
        h1 {
            color: var(--title-color);
            margin-bottom: 20px;
            text-align: center;
        }
        .controls {
            display: flex;
            gap: 15px;
            margin-bottom: 30px;
            flex-wrap: wrap;
            justify-content: center;
        }
        select {
            padding: 10px 15px;
            border-radius: 8px;
            border: 1px solid var(--border-color);
            font-size: 1rem;
            outline: none;
            cursor: pointer;
            background-color: #2c2c2c;
            color: var(--title-color);
            box-shadow: 0 2px 4px rgba(0,0,0,0.2);
        }
        select:focus {
            border-color: var(--accent);
        }
        .dashboard {
            display: grid;
            grid-template-columns: 1fr;
            gap: 20px;
            max-width: 1000px;
            width: 100%;
        }
        .highlights {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
            gap: 15px;
            width: 100%;
            max-width: 1000px;
        }
        @media (max-width: 600px) {
            .highlights {
                grid-template-columns: 1fr;
            }
        }
        .highlight-card {
            background-color: var(--card-bg);
            border-radius: 12px;
            padding: 0;
            border: 1px solid var(--border-color);
            display: flex;
            flex-direction: column;
            overflow: hidden;
            box-shadow: 0 4px 6px rgba(0,0,0,0.3);
            position: relative;
            min-height: 120px;
        }
        .highlight-card .card-title {
            position: absolute;
            top: 10px;
            left: 0;
            right: 0;
            z-index: 10;
            pointer-events: none;
            text-align: center;
        }
        .highlight-card h3 {
            font-size: 0.8rem;
            color: #ffffff;
            margin: 0;
            font-weight: 600;
            text-shadow: 0 2px 4px rgba(0,0,0,0.5);
            background: rgba(0,0,0,0.3);
            display: inline-block;
            padding: 2px 8px;
            border-radius: 4px;
        }
        .split-container {
            display: flex;
            width: 100%;
            height: 100%;
            position: absolute;
            top: 0;
            left: 0;
            background: linear-gradient(135deg, rgba(76, 175, 80, 0.15) 0%, rgba(76, 175, 80, 0.05) 49.9%, rgba(244, 67, 54, 0.05) 50.1%, rgba(244, 67, 54, 0.15) 100%);
        }
        .split-half {
            flex: 1;
            display: flex;
            flex-direction: column;
            justify-content: center;
            padding: 35px 15px 15px 15px;
            position: relative;
            z-index: 1;
        }
        .split-peak {
            align-items: flex-start;
            text-align: left;
        }
        .split-valley {
            align-items: flex-end;
            text-align: right;
        }
        .split-half .label {
            font-size: 0.65rem;
            text-transform: uppercase;
            letter-spacing: 1px;
            margin-bottom: 4px;
            font-weight: 800;
        }
        .split-peak .label { color: #4caf50; }
        .split-valley .label { color: #f44336; }

        .split-half .value {
            font-size: 1.8rem;
            font-weight: 800;
            color: var(--title-color);
            line-height: 1;
        }
        .split-half .date {
            font-size: 0.7rem;
            color: var(--accent);
            margin-top: 4px;
            font-weight: bold;
            opacity: 0.9;
        }
        @media (min-width: 768px) {
            .dashboard {
                grid-template-columns: 1fr 1fr;
            }
        }
        @media (max-width: 600px) {
            .controls {
                flex-direction: column;
                width: 100%;
            }
            select {
                width: 100%;
            }
            .summary-card {
                flex-direction: column !important;
                gap: 20px;
                padding: 20px !important;
            }
            .highlight-card {
                min-height: 100px;
            }
            .split-half .value {
                font-size: 1.4rem;
            }
            .card h2 {
                font-size: 1rem;
                text-align: center;
            }
        }
        .summary-card {
            display: flex;
            flex-direction: row;
            justify-content: space-around;
            padding: 30px;
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
            max-width: 100%;
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
        }
    </style>
</head>
<body>

    <h1>Estatísticas das Enquetes</h1>

    <div class="controls">
        <select id="groupSelect">
            <option value="Todos">Todos os Grupos</option>
            <!-- Preenchido via JS -->
        </select>

        <select id="periodSelect" style="padding: 10px 15px; border-radius: 8px; border: 1px solid var(--border-color); font-size: 1rem; outline: none; cursor: pointer; background-color: #2c2c2c; color: var(--title-color); box-shadow: 0 2px 4px rgba(0,0,0,0.2);">
            <option value="7">Últimos 7 dias</option>
            <option value="15" selected>Últimos 15 dias</option>
            <option value="30">Últimos 30 dias</option>
            <option value="60">Últimos 2 meses</option>
            <option value="90">Últimos 3 meses</option>
            <option value="365">Últimos 12 meses</option>
        </select>

    </div>

    <!-- Destaques removidos daqui para serem movidos para baixo da proporção -->

    <!-- Barra de Lotação do Dia -->
    <div id="capacitySection" style="display: none; width: 100%; max-width: 1000px; margin-bottom: 20px;">
        <div class="card" style="width: 100%; align-items: stretch; padding: 15px 20px; box-sizing: border-box;">
            <div id="capacityList">
                <!-- Preenchido via JS para suportar múltiplos grupos de forma compacta -->
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
        
        <div class="card" style="grid-column: 1 / -1;">
            <h2 id="titleStackedBarChart">Proporção Diária</h2>
            <div class="chart-container">
                <canvas id="stackedBarChart"></canvas>
            </div>
        </div>

        <!-- Cards de MAXs e MININ.s agora abaixo da Proporção Diária -->
        <div class="highlights" style="grid-column: 1 / -1;">
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
        </div>

        <!-- Calendário de Próximas Enquetes (Item 9) -->
        <div id="calendarSection" style="grid-column: 1 / -1; width: 100%;">
            <div class="card" style="width: 100%; align-items: stretch;">
                <h2 style="margin-bottom: 15px;">📅 Próximas Enquetes</h2>
                <div id="nextPollsList" style="display: flex; flex-direction: column; gap: 8px;">
                    <!-- Preenchido via JS com layout de lista premium -->
                </div>
            </div>
        </div>
        
        <div class="card summary-card" style="grid-column: 1 / -1;">
            <div style="text-align: center;">
                <h3 style="margin: 0; color: #7f8c8d; font-size: 1rem;">Total Votos (<span id="txtPeriod">7</span> dias)</h3>
                <p id="lblTotalVotes" style="margin: 10px 0 0 0; font-size: 2.5rem; font-weight: bold; color: var(--title-color);">0</p>
            </div>
            <div style="text-align: center;">
                <h3 style="margin: 0; color: #7f8c8d; font-size: 1rem;">Média Diária</h3>
                <p id="lblAverage" style="margin: 10px 0 0 0; font-size: 2.5rem; font-weight: bold; color: var(--title-color);">0</p>
            </div>
        </div>
    </div>

    <div class="footer" style="margin-bottom: 40px;">
        Atualizado pela última vez em: <span id="lblLastUpdate">${lastUpdateFormated}</span>
    </div>

    <script>
        let rawDB = ${statsJSONStr};
        let capacities = ${capacitiesJSONStr};
        let groupAliases = ${aliasesJSONStr};
        let skipDates = ${skipDatesJSONStr};
        let pollTime = "${pollTimeStr}";
        
        let lastNotifiedCount = {}; // Para o item 4
        let notificationEnabled = false;
        const optionColors = {
            "Irei, ida e volta.": "#4caf50",
            "Irei, mas não retornarei.": "#2196f3",
            "Não irei, apenas retornarei.": "#ff9800",
            "Não irei à faculdade hoje.": "#f44336"
        };

        let pieChartIns = null;
        let barChartIns = null;

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

            // Trackers for highlights (Peaks and Valleys)
            let peakLotacao = { val: -1, date: "" };
            let valleyLotacao = { val: Infinity, date: "" };
            
            let peakAusencia = { val: -1, date: "" };
            let valleyAusencia = { val: Infinity, date: "" };
            
            let peakSoIda = { val: -1, date: "" };
            let valleySoIda = { val: Infinity, date: "" };
            
            let peakSoVolta = { val: -1, date: "" };
            let valleySoVolta = { val: Infinity, date: "" };

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
                            const opt = groupPayload.votes[v];
                            if (globalOptionCounts[opt] !== undefined) globalOptionCounts[opt]++;
                            else globalOptionCounts[opt] = 1;

                            if (dayCounts[opt] !== undefined) dayCounts[opt]++;
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
            }

            document.getElementById("txtPeriod").innerText = targetDaysStr;
            document.getElementById("lblTotalVotes").innerText = accumTotalVotes.toLocaleString('pt-BR');
            
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

            renderCharts(barLabels, barData, globalOptionCounts, stackedData);
        };

        const updateCapacityCard = (targetGroup) => {
            const todayStr = moment().startOf('day').format('YYYY-MM-DD');
            const capacitySection = document.getElementById("capacitySection");
            const capacityList = document.getElementById("capacityList");
            capacityList.innerHTML = "";
            
            let hasAnyCapacity = false;
            const dayEntry = rawDB[todayStr] || { Version2: true, grupos: {} };
            
            let groupsToShow = [];
            if (targetGroup === "Todos") {
                // Mostrar todos os grupos que possuem capacidade configurada
                groupsToShow = Object.keys(capacities);
            } else if (capacities[targetGroup]) {
                groupsToShow = [targetGroup];
            }

            groupsToShow.forEach(gName => {
                let confirmations = 0;
                const groupData = dayEntry.grupos ? dayEntry.grupos[gName] : null;

                if (groupData && groupData.votes) {
                    Object.values(groupData.votes).forEach(opt => {
                        if (opt === "Irei, ida e volta." || opt === "Irei, mas não retornarei." || opt === "Não irei, apenas retornarei.") {
                            confirmations++;
                        }
                    });
                }
                
                renderCompactBar(gName, confirmations, capacities[gName]);
                hasAnyCapacity = true;
            });

            capacitySection.style.display = hasAnyCapacity ? "block" : "none";
        };

        const renderCompactBar = (name, count, cap) => {
            const capacityList = document.getElementById("capacityList");
            const percentage = Math.min(100, (count / cap) * 100);
            const displayName = groupAliases[name] || name;
            
            // Item 8: Cores diferentes para cada ônibus
            const busColors = [
                'linear-gradient(90deg, #2196f3, #4caf50)', // Azul para Verde
                'linear-gradient(90deg, #9c27b0, #00bcd4)', // Roxo para Cyan
                'linear-gradient(90deg, #fb8c00, #ffeb3b)', // Laranja para Amarelo (mais vibrante)
                'linear-gradient(90deg, #f44336, #e91e63)', // Vermelho para Rosa
                'linear-gradient(90deg, #3f51b5, #2196f3)'  // Indigo para Azul
            ];
            // Usa o index do nome na lista de capacidades para decidir a cor
            const colorIdx = Object.keys(capacities).indexOf(name) % busColors.length;
            const barGradient = busColors[colorIdx];

            let statusColor = "#94a3b8";
            let statusText = (cap - count) + " vagas";
            if (count > cap) {
                statusColor = "#f44336";
                statusText = "Excesso: " + (count - cap);
            } else if (count === cap) {
                statusColor = "#f44336";
                statusText = "Lotado!";
            } else if (percentage > 80) {
                statusColor = "#ff9800";
                statusText = "Quase lotado!";
            }

            // Item 4: Verificação de Notificação
            if (notificationEnabled && (count === cap || (count > 0 && count % 5 === 0))) {
                if (lastNotifiedCount[name] !== count) {
                    new Notification("Alerta de Lotação", {
                        body: "O ônibus " + displayName + " atingiu " + count + "/" + cap + " passageiros!",
                        icon: "https://cdn-icons-png.flaticon.com/512/2850/2850383.png"
                    });
                    lastNotifiedCount[name] = count;
                }
            }

            const container = document.createElement("div");
            container.style.marginBottom = "12px";

            const header = document.createElement("div");
            header.style.cssText = "display: flex; justify-content: space-between; align-items: flex-end; margin-bottom: 6px;";

            const nameSpan = document.createElement("span");
            nameSpan.style.cssText = "font-size: 0.9rem; font-weight: 600; color: var(--title-color);";
            nameSpan.innerText = displayName;

            const infoDiv = document.createElement("div");
            infoDiv.style.textAlign = "right";

            const sSpan = document.createElement("span");
            sSpan.style.cssText = "font-size: 0.8rem; color: " + statusColor + "; font-weight: 500; margin-right: 8px;";
            sSpan.innerText = statusText;

            const cSpan = document.createElement("span");
            cSpan.style.cssText = "font-size: 1rem; font-weight: bold; color: var(--accent);";
            cSpan.innerText = count + "/" + cap;

            infoDiv.appendChild(sSpan);
            infoDiv.appendChild(cSpan);
            header.appendChild(nameSpan);
            header.appendChild(infoDiv);

            const progressContainer = document.createElement("div");
            progressContainer.style.cssText = "width: 100%; height: 10px; background: #2c2c2c; border-radius: 5px; overflow: hidden; border: 1px solid var(--border-color);";

            const progressBar = document.createElement("div");
            progressBar.style.cssText = "height: 100%; background: " + barGradient + "; transition: width 0.8s ease;";
            progressBar.style.width = percentage + "%";

            progressContainer.appendChild(progressBar);
            container.appendChild(header);
            container.appendChild(progressContainer);
            
            capacityList.appendChild(container);
        };

        let stackedChartIns = null;

        const renderCharts = (barLabels, barData, pieCountsMap, stackedData) => {
            const pieLabels = Object.keys(pieCountsMap);
            const pieData = Object.values(pieCountsMap);
            const pieColors = pieLabels.map(l => optionColors[l] || "#9e9e9e");

            Chart.defaults.color = '#e0e0e0';
            Chart.defaults.borderColor = '#333';

            if(pieChartIns) pieChartIns.destroy();
            const pieCtx = document.getElementById('pieChart').getContext('2d');
            pieChartIns = new Chart(pieCtx, {
                type: 'doughnut',
                data: {
                    labels: pieLabels,
                    datasets: [{
                        data: pieData,
                        backgroundColor: pieColors,
                        borderWidth: 1
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: { 
                        legend: { 
                            position: 'bottom',
                            labels: {
                                boxWidth: 10,
                                padding: 10,
                                font: {
                                    size: window.innerWidth < 400 ? 8 : (window.innerWidth < 600 ? 10 : 12)
                                }
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
                        label: 'Número de Votos',
                        data: barData,
                        borderColor: '#2196f3',
                        backgroundColor: 'rgba(33, 150, 243, 0.1)',
                        borderWidth: 2,
                        fill: true,
                        tension: 0.4,
                        pointBackgroundColor: '#2196f3'
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    scales: { 
                        y: { 
                            beginAtZero: true,
                            grace: '10%'
                        } 
                    },
                    plugins: { legend: { display: false } }
                }
            });

            if(stackedChartIns) stackedChartIns.destroy();
            const stackedCtx = document.getElementById('stackedBarChart').getContext('2d');
            stackedChartIns = new Chart(stackedCtx, {
                type: 'bar',
                data: {
                    labels: barLabels,
                    datasets: [
                        {
                            label: 'Ida e Volta',
                            data: stackedData["Irei, ida e volta."],
                            backgroundColor: optionColors["Irei, ida e volta."]
                        },
                        {
                            label: 'Só Ida',
                            data: stackedData["Irei, mas não retornarei."],
                            backgroundColor: optionColors["Irei, mas não retornarei."]
                        },
                        {
                            label: 'Só Volta',
                            data: stackedData["Não irei, apenas retornarei."],
                            backgroundColor: optionColors["Não irei, apenas retornarei."]
                        },
                        {
                            label: 'Ausente',
                            data: stackedData["Não irei à faculdade hoje."],
                            backgroundColor: optionColors["Não irei à faculdade hoje."]
                        }
                    ]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    scales: {
                        x: { stacked: true },
                        y: { stacked: true, beginAtZero: true, grace: '10%' }
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
                        } 
                    }
                }
            });
        };

        const updateDash = () => {
            const grp = document.getElementById("groupSelect").value;
            const per = document.getElementById("periodSelect").value;
            processData(grp, per);
            updateNextPollsCalendar();
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
        const updateNextPollsCalendar = () => {
            const list = document.getElementById("nextPollsList");
            if (!list) return;
            list.innerHTML = "";
            
            const daysOfWeekBR = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];
            const now = moment();
            let current = moment();
            const timeParts = pollTime.split(':');
            current.set({ hour: parseInt(timeParts[0]), minute: parseInt(timeParts[1]), second: 0 });
            
            if (current.isBefore(now)) {
                current.add(1, 'days');
            }
            
            let found = 0;
            let safetyLimit = 40; 
            
            while (found < 5 && safetyLimit > 0) {
                const dayOfWeek = current.day();
                const isWeekend = (dayOfWeek === 0 || dayOfWeek === 6);
                const brDate = current.format('DD/MM/YYYY');
                const skipReason = skipDates[brDate];
                
                let reason = "";
                if (isWeekend) reason = "Fim de Semana";
                else if (skipReason) reason = skipReason;
                
                const row = document.createElement("div");
                row.style.cssText = 'display: flex; align-items: center; padding: 10px 16px; background: rgba(255, 255, 255, 0.03); border: 1px solid rgba(255, 255, 255, 0.05); border-radius: 10px; transition: all 0.2s ease; gap: 15px;';
                
                row.onmouseover = () => { row.style.background = "rgba(255, 255, 255, 0.06)"; row.style.borderColor = "rgba(21, 101, 192, 0.3)"; };
                row.onmouseout = () => { row.style.background = "rgba(255, 255, 255, 0.03)"; row.style.borderColor = "rgba(255, 255, 255, 0.05)"; };

                if (reason) {
                    row.style.opacity = "0.5";
                    row.innerHTML = ' \
                        <div style="font-size: 1.2rem; min-width: 30px; text-align: center;">🚫</div> \
                        <div style="display: flex; flex-direction: column; flex: 1;"> \
                            <span style="font-size: 0.85rem; font-weight: bold; color: #7f8c8d;">' + current.format('DD/MM') + ' <small>(' + daysOfWeekBR[dayOfWeek] + ')</small></span> \
                            <span style="font-size: 0.75rem; color: #f44336; font-weight: 500;">SEM ENQUETE</span> \
                        </div> \
                        <div style="font-size: 0.75rem; color: #555; font-style: italic;">' + reason + '</div> \
                    ';
                } else {
                    const duration = moment.duration(current.diff(now));
                    const d = Math.floor(duration.asDays());
                    const h = duration.hours();
                    const m = duration.minutes();
                    
                    let timeRemaining = "";
                    if (d > 0) timeRemaining = "Em " + d + "d " + h + "h";
                    else if (h > 0) timeRemaining = "Em " + h + "h " + m + "m";
                    else timeRemaining = "Em " + m + "m";

                    row.innerHTML = ' \
                        <div style="font-size: 1.2rem; min-width: 30px; text-align: center;">📅</div> \
                        <div style="display: flex; flex-direction: column; flex: 1;"> \
                            <span style="font-size: 0.85rem; font-weight: bold; color: var(--title-color);">' + current.format('DD/MM') + ' <small>(' + daysOfWeekBR[dayOfWeek] + ')</small></span> \
                            <span style="font-size: 0.75rem; color: #4caf50; font-weight: 600;">AGENDADA - ' + pollTime + '</span> \
                        </div> \
                        <div style="text-align: right;"> \
                            <span style="font-size: 0.75rem; background: rgba(33, 150, 243, 0.15); color: var(--accent); padding: 3px 8px; border-radius: 20px; font-weight: bold; white-space: nowrap;">' + timeRemaining + '</span> \
                        </div> \
                    ';
                    found++;
                }
                
                list.appendChild(row);
                current.add(1, 'days');
                safetyLimit--;
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

        // Boot instantâneo
        initSelects();
        initNotification();
        
        // Pequeno delay apenas para garantir que o DOM e Charts estejam prontos
        window.addEventListener('load', () => {
            updateDash();
            fetchStats(); // Forçar busca imediata para garantir dados frescos
        });
        
        // Execução imediata caso o load já tenha passado
        if (document.readyState === 'complete') {
            updateDash();
            fetchStats();
        }

        // Auto-refresh via JS fetch para não piscar a tela
        const fetchStats = async () => {
            checkMidnightReset();
            try {
                const res = await fetch('/api/stats');
                if (res.ok) {
                    const data = await res.json();
                    
                    // Se houver mudança nos dados ou a data de hoje não existir no cache local mas existir no novo, atualiza
                    if (JSON.stringify(rawDB) !== JSON.stringify(data.votes)) {
                        rawDB = data.votes || {};
                        capacities = data.capacities || {};
                        groupAliases = data.aliases || {};
                        updateDash(); // Re-render dos gráficos
                        
                        const now = new Date();
                        document.getElementById('lblLastUpdate').innerText = now.toLocaleDateString('pt-BR') + ' ' + now.toLocaleTimeString('pt-BR');
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
