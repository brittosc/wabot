
const renderHeatmap = (targetGroup) => {
    const container = document.getElementById("heatmapContainer");
    if (!container) return;
    container.innerHTML = "";

    const dbDates = Object.keys(rawDB).sort();
    if (dbDates.length === 0) {
        container.innerHTML = '<div style="text-align:center; padding: 20px; color: #666;">Sem dados para exibir o mapa.</div>';
        return;
    }

    const today = moment().tz("America/Sao_Paulo").endOf('day');
    // Iniciar na SEGUNDA-FEIRA anterior ao primeiro registro
    let startDate = moment(dbDates[0]).tz("America/Sao_Paulo").startOf('day');
    while (startDate.day() !== 1) { 
        startDate.subtract(1, 'day');
    }
    
    const heatmapWrapper = document.createElement("div");
    heatmapWrapper.className = "heatmap-wrapper";
    heatmapWrapper.style.display = "flex";
    heatmapWrapper.style.gap = "10px";

    // 1. Labels dos dias (Esquerda)
    const labels = document.createElement("div");
    labels.className = "heatmap-labels";
    const dayLabels = ["Seg", "Ter", "Qua", "Qui", "Sex", "", ""];
    for (let i = 0; i < 7; i++) {
        const span = document.createElement("span");
        span.innerHTML = dayLabels[i] || "&nbsp;";
        span.style.height = "12px";
        span.style.display = "flex";
        span.style.alignItems = "center";
        labels.appendChild(span);
    }
    labels.style.display = "grid";
    labels.style.gridTemplateRows = "repeat(7, 12px)";
    labels.style.gap = "4px";
    labels.style.marginTop = "18px"; // Ajuste fino para alinhar com o centro dos quadradinhos
    labels.style.lineHeight = "12px";

    // 2. Container Principal (Meses + Grid)
    const mainArea = document.createElement("div");
    mainArea.style.display = "flex";
    mainArea.style.flexDirection = "column";
    mainArea.style.gap = "4px";

    // 2a. Header dos meses
    const monthsRow = document.createElement("div");
    monthsRow.className = "heatmap-months";
    monthsRow.style.display = "grid";
    monthsRow.style.gridTemplateColumns = "repeat(auto-fill, 12px)";
    monthsRow.style.gap = "4px";
    monthsRow.style.height = "16px";
    monthsRow.style.fontSize = "0.7rem";
    monthsRow.style.color = "#666";

    // 2b. Grid de quadradinhos
    const grid = document.createElement("div");
    grid.className = "heatmap-grid-inner";
    grid.style.display = "grid";
    grid.style.gridTemplateRows = "repeat(7, 12px)";
    grid.style.gap = "4px";

    const dailyData = {};
    const months = [];
    let current = startDate.clone();
    let lastMonth = -1;

    while (current.isBefore(today) || current.isSame(today, 'day')) {
        const dateStr = current.format('YYYY-MM-DD');
        const diffDays = current.diff(startDate, 'days');
        const col = Math.floor(diffDays / 7) + 1;

        // Adicionar label do mês
        if (current.month() !== lastMonth) {
            months.push({ name: current.format('MMM'), col: col });
            lastMonth = current.month();
        }

        // Processar presença
        let presence = 0;
        if (rawDB[dateStr]) {
            const dayEntry = rawDB[dateStr];
            let groupsToProcess = [];
            if (dayEntry.Version2 && dayEntry.grupos) {
                if (targetGroup === "Todos") groupsToProcess = Object.values(dayEntry.grupos);
                else if (dayEntry.grupos[targetGroup]) groupsToProcess = [dayEntry.grupos[targetGroup]];
            } else if (!dayEntry.Version2) {
                if (targetGroup === "Todos" || targetGroup === "Grupo Geral (Legado)") groupsToProcess = [dayEntry];
            }

            const dayUniqueVoters = new Set();
            groupsToProcess.forEach(groupPayload => {
                if (!groupPayload.votes) return;
                Object.entries(groupPayload.votes).forEach(([jid, vData]) => {
                    const opt = typeof vData === 'object' ? vData.option : vData;
                    if (["Irei, ida e volta.", "Irei, mas não retornarei.", "Não irei, apenas retornarei."].includes(opt)) {
                        dayUniqueVoters.add(jid);
                    }
                });
            });
            presence = dayUniqueVoters.size;
        }

        // Criar quadradinho
        const day = document.createElement("div");
        day.className = "heatmap-day";
        day.title = `${current.format('DD/MM')}: ${presence} presenças`;
        
        let level = 0;
        if (presence > 0) {
            if (presence < 10) level = 1;
            else if (presence < 25) level = 2;
            else if (presence < 45) level = 3;
            else level = 4;
        }
        day.dataset.level = level;

        // Posicionamento Explícito
        const dayOfWeek = current.day(); // 0=Dom, 1=Seg...
        const row = dayOfWeek === 0 ? 7 : dayOfWeek;
        day.style.gridRow = row;
        day.style.gridColumn = col;
        day.style.width = "12px";
        day.style.height = "12px";
        day.style.borderRadius = "2px";

        grid.appendChild(day);
        current.add(1, 'day');
    }

    // Renderizar labels dos meses
    months.forEach(m => {
        const span = document.createElement("span");
        span.textContent = m.name;
        span.style.gridColumn = m.col;
        monthsRow.appendChild(span);
    });

    mainArea.appendChild(monthsRow);
    mainArea.appendChild(grid);
    
    heatmapWrapper.appendChild(labels);
    heatmapWrapper.appendChild(mainArea);
    container.appendChild(heatmapWrapper);
};

window.renderHeatmap = renderHeatmap;
