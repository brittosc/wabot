const fs = require('fs');
const moment = require('moment-timezone');

const statsFile = './statistics.json';
const htmlFile = './estatisticas.html';

const readStats = () => {
    try {
        if (!fs.existsSync(statsFile)) return {};
        const data = fs.readFileSync(statsFile, 'utf8');
        return JSON.parse(data);
    } catch (e) {
        return {};
    }
};

const saveStats = (data) => {
    fs.writeFileSync(statsFile, JSON.stringify(data, null, 2));
};

const registerVote = async (vote) => {
    const now = moment().tz('America/Sao_Paulo');
    const todayStr = now.format('YYYY-MM-DD');

    const stats = readStats();

    // Migração de Estrutura Antiga (V1 para V2)
    if (stats[todayStr] && !stats[todayStr].Version2) {
        const oldData = stats[todayStr];
        stats[todayStr] = {
            Version2: true,
            grupos: {
                "Grupo Geral (Legado)": oldData
            }
        };
    }

    if (!stats[todayStr]) {
        stats[todayStr] = {
            Version2: true,
            grupos: {}
        };
    }

    let groupName = "Desconhecido";
    try {
        if (vote.parentMessage) {
            const chat = await vote.parentMessage.getChat();
            if (chat && chat.name) groupName = chat.name;
        }
    } catch (e) {
        // Ignora caso falhe ao pegar o nome do grupo e mantém como "Desconhecido"
    }

    if (!stats[todayStr].grupos[groupName]) {
        stats[todayStr].grupos[groupName] = {
            pollName: vote.parentMessage ? vote.parentMessage.body : 'Enquete do dia',
            votes: {}
        };
    }

    const voterId = vote.voter;

    // If the user deselected options, selectedOptions will be empty
    if (vote.selectedOptions && vote.selectedOptions.length > 0) {
        const selectedOption = vote.selectedOptions[0].name;
        stats[todayStr].grupos[groupName].votes[voterId] = selectedOption;
    } else {
        if (stats[todayStr].grupos[groupName].votes[voterId]) {
            delete stats[todayStr].grupos[groupName].votes[voterId];
        }
    }

    saveStats(stats);

    // After saving, generate HTML
    generateHtmlDashboard(stats);
};

const generateHtmlDashboard = (stats) => {
    // Inject the raw JS object directly into HTML for dynamic reading
    const statsJSONStr = JSON.stringify(stats);
    const lastUpdateFormated = moment().tz('America/Sao_Paulo').format('DD/MM/YYYY HH:mm:ss');

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
            padding: 15px;
            border: 1px solid var(--border-color);
            display: flex;
            flex-direction: column;
            align-items: center;
            text-align: center;
            box-shadow: 0 4px 6px rgba(0,0,0,0.3);
        }
        .highlight-card i {
            font-size: 1.5rem;
            margin-bottom: 10px;
        }
        .highlight-card h3 {
            font-size: 0.9rem;
            color: #7f8c8d;
            margin: 0 0 5px 0;
            font-weight: normal;
        }
        .highlight-card .value {
            font-size: 1.5rem;
            font-weight: bold;
            color: var(--title-color);
            margin: 0;
        }
        .highlight-card .date {
            font-size: 0.8rem;
            color: var(--accent);
            margin-top: 5px;
            font-weight: bold;
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

    <div class="highlights">
        <div class="highlight-card">
            <i>🔥</i>
            <h3>Pico de Lotação (Ida/Volta)</h3>
            <p class="value" id="hlLotacaoVal">-</p>
            <p class="date" id="hlLotacaoDate">-</p>
        </div>
        <div class="highlight-card">
            <i>🏖️</i>
            <h3>Maior Ausência</h3>
            <p class="value" id="hlAusenciaVal">-</p>
            <p class="date" id="hlAusenciaDate">-</p>
        </div>
        <div class="highlight-card">
            <i>🚌</i>
            <h3>Demanda (Só Ida)</h3>
            <p class="value" id="hlSoIdaVal">-</p>
            <p class="date" id="hlSoIdaDate">-</p>
        </div>
        <div class="highlight-card">
            <i>🏠</i>
            <h3>Demanda (Só Volta)</h3>
            <p class="value" id="hlSoVoltaVal">-</p>
            <p class="date" id="hlSoVoltaDate">-</p>
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
            <h2>Proporção Diária (Stacked)</h2>
            <div class="chart-container">
                <canvas id="stackedBarChart"></canvas>
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

            // Trackers for highlights
            let peakLotacao = { val: -1, date: "" };
            let peakAusencia = { val: -1, date: "" };
            let peakSoIda = { val: -1, date: "" };
            let peakSoVolta = { val: -1, date: "" };

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

                // Check Peaks
                if (dayCounts["Irei, ida e volta."] > peakLotacao.val) {
                    peakLotacao.val = dayCounts["Irei, ida e volta."];
                    peakLotacao.date = displayDate;
                }
                if (dayCounts["Não irei à faculdade hoje."] > peakAusencia.val) {
                    peakAusencia.val = dayCounts["Não irei à faculdade hoje."];
                    peakAusencia.date = displayDate;
                }
                if (dayCounts["Irei, mas não retornarei."] > peakSoIda.val) {
                    peakSoIda.val = dayCounts["Irei, mas não retornarei."];
                    peakSoIda.date = displayDate;
                }
                if (dayCounts["Não irei, apenas retornarei."] > peakSoVolta.val) {
                    peakSoVolta.val = dayCounts["Não irei, apenas retornarei."];
                    peakSoVolta.date = displayDate;
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
                if(peakObj.val > 0) {
                    document.getElementById(valId).innerText = peakObj.val.toLocaleString('pt-BR');
                    document.getElementById(dateId).innerText = "(" + peakObj.date + ")";
                } else {
                    document.getElementById(valId).innerText = "0";
                    document.getElementById(dateId).innerText = "Sem dados";
                }
            };

            setHighlight("hlLotacaoVal", "hlLotacaoDate", peakLotacao);
            setHighlight("hlAusenciaVal", "hlAusenciaDate", peakAusencia);
            setHighlight("hlSoIdaVal", "hlSoIdaDate", peakSoIda);
            setHighlight("hlSoVoltaVal", "hlSoVoltaDate", peakSoVolta);
            
            const numActiveDays = targetDays; // Always use target days since we show all days now
            document.getElementById("lblAverage").innerText = (accumTotalVotes / numActiveDays).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

            renderCharts(barLabels, barData, globalOptionCounts, stackedData);
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

        // Boot
        initSelects();
        updateDash();

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

module.exports = { registerVote, generateHtmlDashboard, readStats };
