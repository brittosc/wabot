const fs = require('fs');
const moment = require('moment-timezone');
const dashboard = require('./dashboard');
const supabase = require('./supabaseClient');

const htmlFile = './estatisticas.html';

const readStats = async () => {
    try {
        // Buscamos os últimos 10.000 votos (suficiente para vários meses)
        // Mais para frente, podemos otimizar filtrando apenas o período necessário
        const { data: rows, error } = await supabase
            .from('votes')
            .select('*')
            .order('vote_date', { ascending: false })
            .limit(10000);

        if (error) throw error;

        const stats = {};
        rows.forEach(row => {
            const date = row.vote_date; // 'YYYY-MM-DD'
            if (!stats[date]) {
                stats[date] = { Version2: true, grupos: {} };
            }
            if (!stats[date].grupos[row.group_name]) {
                stats[date].grupos[row.group_name] = {
                    pollName: row.poll_name || 'Enquete do dia',
                    votes: {}
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
        const todayStr = moment().tz('America/Sao_Paulo').format('YYYY-MM-DD');
        const dayEntry = stats[todayStr];
        if (!dayEntry || !dayEntry.grupos) {
            dashboard.setOccupancy([]);
            return;
        }

        const config = JSON.parse(fs.readFileSync('./config.json', 'utf8'));
        const capacities = config.groupCapacities || {};

        const occupancySummary = [];
        Object.keys(capacities).forEach(gName => {
            let count = 0;
            const cap = capacities[gName];
            const groupData = dayEntry.grupos[gName];
            if (groupData && groupData.votes) {
                Object.values(groupData.votes).forEach(opt => {
                    if (opt === "Irei, ida e volta." || opt === "Irei, mas não retornarei." || opt === "Não irei, apenas retornarei.") {
                        count++;
                    }
                });
            }

            let status = `${count}/${cap}`;
            if (count > cap) status += " (EXCEDENTE)";
            else if (count === cap) status += " (LOTADO)";

            occupancySummary.push({ name: gName, count, cap, status });
        });

        dashboard.setOccupancy(occupancySummary);
    } catch (e) {
        // Ignora erros de atualização do terminal
    }
};

const saveStats = async (data) => {
    // Esta função era usada para salvar o JSON inteiro. 
    // Agora o salvamento é feito de forma atômica no registerVote via Supabase.
    // Mantida apenas para evitar erros de referência se esquecida em algum lugar, mas sem efeito.
};

const registerVote = async (vote) => {
    const now = moment().tz('America/Sao_Paulo');
    const todayStr = now.format('YYYY-MM-DD');

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
        await supabase.from('votes').upsert({
            voter_id: voterId,
            group_name: groupName,
            vote_date: todayStr,
            option: selectedOption,
            poll_name: pollName
        }, { onConflict: 'voter_id,group_name,vote_date' });
    } else {
        // Deletar voto (desmarcado)
        await supabase.from('votes')
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
    const lastUpdateFormated = moment().tz('America/Sao_Paulo').format('DD/MM/YYYY HH:mm:ss');

    // Carregar capacidades do config.json
    let capacities = {};
    try {
        const config = JSON.parse(fs.readFileSync('./config.json', 'utf8'));
        capacities = config.groupCapacities || {};
    } catch (e) {
        console.error("Erro ao ler capacidades do config.json:", e.message);
    }
    const capacitiesJSONStr = JSON.stringify(capacities);

    const htmlContent = `
<!DOCTYPE html>
<html lang="pt-BR">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Painel Avançado</title>
    <link rel="icon" href="https://dayz.com/favicon.ico">
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
        body {
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
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
            margin-bottom: 20px;
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
        .card {
            background-color: var(--card-bg);
            border-radius: 12px;
            box-shadow: 0 4px 6px rgba(0,0,0,0.3);
            padding: 20px;
            display: flex;
            flex-direction: column;
            align-items: center;
            border: 1px solid var(--border-color);
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

        <select id="periodSelect">
            <option value="7">Últimos 7 dias</option>
            <option value="15">Últimos 15 dias</option>
            <option value="30">Últimos 30 dias</option>
            <option value="90">Últimos 3 meses</option>
            <option value="180">Últimos 6 meses</option>
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
            <h2>Média / Total Geral (Opções)</h2>
            <div class="chart-container">
                <canvas id="pieChart"></canvas>
            </div>
        </div>

        <div class="card">
            <h2>Votos por Dia</h2>
            <div class="chart-container">
                <canvas id="barChart"></canvas>
            </div>
        </div>
        
        <div class="card" style="grid-column: 1 / -1;">
            <h2>Proporção Diária</h2>
            <div class="chart-container">
                <canvas id="stackedBarChart"></canvas>
            </div>
        </div>

        <!-- Cards de Picos e Vales agora abaixo da Proporção Diária -->
        <div class="highlights" style="grid-column: 1 / -1;">
            <div class="highlight-card">
                <div class="card-title"><h3>Lotação (Ida/Volta)</h3></div>
                <div class="split-container">
                    <div class="split-half split-peak">
                        <span class="label">Pico</span>
                        <span class="value" id="hlLotacaoVal">-</span>
                        <span class="date" id="hlLotacaoDate">-</span>
                    </div>
                    <div class="split-half split-valley">
                        <span class="label">Vale</span>
                        <span class="value" id="hlLotacaoMinVal">-</span>
                        <span class="date" id="hlLotacaoMinDate">-</span>
                    </div>
                </div>
            </div>
            <div class="highlight-card">
                <div class="card-title"><h3>Ausência</h3></div>
                <div class="split-container">
                    <div class="split-half split-peak">
                        <span class="label">Pico</span>
                        <span class="value" id="hlAusenciaVal">-</span>
                        <span class="date" id="hlAusenciaDate">-</span>
                    </div>
                    <div class="split-half split-valley">
                        <span class="label">Vale</span>
                        <span class="value" id="hlAusenciaMinVal">-</span>
                        <span class="date" id="hlAusenciaMinDate">-</span>
                    </div>
                </div>
            </div>
            <div class="highlight-card">
                <div class="card-title"><h3>Demanda (Só Ida)</h3></div>
                <div class="split-container">
                    <div class="split-half split-peak">
                        <span class="label">Pico</span>
                        <span class="value" id="hlSoIdaVal">-</span>
                        <span class="date" id="hlSoIdaDate">-</span>
                    </div>
                    <div class="split-half split-valley">
                        <span class="label">Vale</span>
                        <span class="value" id="hlSoIdaMinVal">-</span>
                        <span class="date" id="hlSoIdaMinDate">-</span>
                    </div>
                </div>
            </div>
            <div class="highlight-card">
                <div class="card-title"><h3>Demanda (Só Volta)</h3></div>
                <div class="split-container">
                    <div class="split-half split-peak">
                        <span class="label">Pico</span>
                        <span class="value" id="hlSoVoltaVal">-</span>
                        <span class="date" id="hlSoVoltaDate">-</span>
                    </div>
                    <div class="split-half split-valley">
                        <span class="label">Vale</span>
                        <span class="value" id="hlSoVoltaMinVal">-</span>
                        <span class="date" id="hlSoVoltaMinDate">-</span>
                    </div>
                </div>
            </div>
        </div>
        
        <div class="card" style="grid-column: 1 / -1; display: flex; flex-direction: row; justify-content: space-around; padding: 30px;">
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

    <div class="footer">
        Atualizado pela última vez em: <span id="lblLastUpdate">${lastUpdateFormated}</span>
    </div>

    <script>
        let rawDB = ${statsJSONStr};
        let capacities = ${capacitiesJSONStr};
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
                opt.textContent = g;
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

            // Update Labels
            document.getElementById("txtPeriod").innerText = targetDaysStr;
            document.getElementById("lblTotalVotes").innerText = accumTotalVotes.toLocaleString('pt-BR');
            
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
            
            let statusColor = "#94a3b8";
            let statusText = (cap - count) + " vagas";
            if (count > cap) {
                statusColor = "#f44336";
                statusText = "Excesso: " + (count - cap);
            } else if (count === cap) {
                statusColor = "#f44336";
                statusText = "Lotado!";
            } else if (percentage > 85) {
                statusColor = "#ff9800";
                statusText = "Quase lotado.";
            }

            const barHtml = \`
                <div style="margin-bottom: 12px;">
                    <div style="display: flex; justify-content: space-between; align-items: flex-end; margin-bottom: 6px;">
                        <span style="font-size: 0.9rem; font-weight: 600; color: var(--title-color);">\${name}</span>
                        <div style="text-align: right;">
                            <span style="font-size: 0.8rem; color: \${statusColor}; font-weight: 500; margin-right: 8px;">\${statusText}</span>
                            <span style="font-size: 1rem; font-weight: bold; color: var(--accent);">\${count}/\${cap}</span>
                        </div>
                    </div>
                    <div style="width: 100%; height: 10px; background: #2c2c2c; border-radius: 5px; overflow: hidden; border: 1px solid var(--border-color);">
                        <div style="width: \${percentage}%; height: 100%; background: linear-gradient(90deg, #2196f3, #4caf50); transition: width 0.8s ease;"></div>
                    </div>
                </div>
            \`;
            capacityList.innerHTML += barHtml;
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
                    plugins: { legend: { position: 'bottom' } }
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
                            ticks: { stepSize: 1 } 
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
                        y: { stacked: true, beginAtZero: true, ticks: { stepSize: 1 } }
                    },
                    plugins: { legend: { position: 'bottom' } }
                }
            });
        };

        const updateDash = () => {
            const grp = document.getElementById("groupSelect").value;
            const per = document.getElementById("periodSelect").value;
            processData(grp, per);
        };

        // Boot instantâneo
        initSelects();
        
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
            try {
                const res = await fetch('/api/stats');
                if (res.ok) {
                    const data = await res.json();
                    
                    // Compara as chaves para verificar levemente as mudanças, caso contrário o dashboard recarrega
                    if (JSON.stringify(rawDB) !== JSON.stringify(data)) {
                        rawDB = data;
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

    fs.writeFileSync(htmlFile, htmlContent, 'utf8');
};

module.exports = { registerVote, readStats, generateHtmlDashboard, updateTerminalOccupancy };
