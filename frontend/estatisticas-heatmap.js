
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
    // Forçar início no Domingo anterior ao primeiro registro de forma manual e segura
    let startDate = moment(dbDates[0]).tz("America/Sao_Paulo").startOf('day');
    while (startDate.day() !== 0) {
        startDate.subtract(1, 'day');
    }
    
    const heatmapFlex = document.createElement("div");
    heatmapFlex.className = "heatmap-flex";

    // Header dos meses
    const monthsRow = document.createElement("div");
    monthsRow.className = "heatmap-months";
    
    // Labels dos dias da semana
    const labels = document.createElement("div");
    labels.className = "heatmap-labels";
    const dayLabels = ["", "Seg", "Ter", "Qua", "Qui", "Sex", ""];
    for (let i = 0; i < 7; i++) {
        const span = document.createElement("span");
        span.innerHTML = dayLabels[i] || "&nbsp;";
        labels.appendChild(span);
    }

    const gridWrapper = document.createElement("div");
    gridWrapper.style.display = "flex";
    gridWrapper.style.flexDirection = "column";

    const grid = document.createElement("div");
    grid.className = "heatmap-container";

    let maxPresence = 0;
    const dailyData = {};
    const months = [];

    let current = startDate.clone();
    let lastMonth = -1;

    while (current.isBefore(today) || current.isSame(today, 'day')) {
        const dateStr = current.format('YYYY-MM-DD');
        
        // Adicionar label do mês se mudar e for início da semana
        if (current.month() !== lastMonth && current.day() === 0) {
            months.push({ name: current.format('MMM'), pos: Math.floor(Object.keys(dailyData).length / 7) });
            lastMonth = current.month();
        }

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

        dailyData[dateStr] = presence;
        if (presence > maxPresence) maxPresence = presence;
        current.add(1, 'day');
    }

    // Renderizar meses
    months.forEach((m) => {
        const mSpan = document.createElement("span");
        mSpan.textContent = m.name;
        // Posição absoluta baseada na largura do quadradinho (12px) + gap (4px)
        const leftPos = m.pos * (12 + 4);
        mSpan.style.left = `${leftPos}px`;
        monthsRow.appendChild(mSpan);
    });

    // Renderizar os quadradinhos
    current = startDate.clone();
    while (current.isBefore(today) || current.isSame(today, 'day')) {
        const dateStr = current.format('YYYY-MM-DD');
        const presence = dailyData[dateStr] || 0;
        
        let level = 0;
        if (presence > 0) {
            const ratio = presence / (maxPresence || 1);
            if (ratio <= 0.25) level = 1;
            else if (ratio <= 0.5) level = 2;
            else if (ratio <= 0.75) level = 3;
            else level = 4;
        }

        const dayEl = document.createElement("div");
        dayEl.className = "heatmap-day";
        dayEl.dataset.level = level;
        dayEl.title = `${current.format('DD/MM/YYYY')}: ${presence} presenças`;
        
        grid.appendChild(dayEl);
        current.add(1, 'day');
    }

    gridWrapper.appendChild(monthsRow);
    gridWrapper.appendChild(grid);
    
    heatmapFlex.appendChild(labels);
    heatmapFlex.appendChild(gridWrapper);
    container.appendChild(heatmapFlex);
    container.appendChild(heatmapFlex);
};

window.renderHeatmap = renderHeatmap;
