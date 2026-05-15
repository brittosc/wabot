
const renderPrediction = (targetGroup) => {
    const container = document.getElementById("predictionSection");
    if (!container) return;
    container.innerHTML = "";

    const groups = targetGroup === "Todos" ? extractGroups() : [targetGroup];

    groups.forEach(groupName => {
        const stats = calculatePredictionForGroup(groupName);
        if (stats) {
            const card = createPredictionCard(groupName, stats);
            container.appendChild(card);
        }
    });

    if (window.lucide) lucide.createIcons();
};

const calculatePredictionForGroup = (groupName) => {
    // 1. Identificar a data da próxima enquete
    let nextPollMoment = moment().tz("America/Sao_Paulo");
    if (isPollSentToday) {
        nextPollMoment.add(1, 'day');
    }

    // Pular finais de semana ou datas de skip
    while (nextPollMoment.day() === 0 || nextPollMoment.day() === 6 || (skipDates && skipDates[nextPollMoment.format('DD/MM/YYYY')])) {
        nextPollMoment.add(1, 'day');
    }

    const weekdayIndex = nextPollMoment.day();
    const weekdayName = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'][weekdayIndex];
    const targetDateStr = `${weekdayName} (${nextPollMoment.format('DD/MM')})`;

    // 2. Analisar histórico para esse dia da semana
    const historicalDays = [];
    Object.keys(rawDB).forEach(dateStr => {
        if (moment(dateStr).day() === weekdayIndex) {
            historicalDays.push(dateStr);
        }
    });

    if (historicalDays.length === 0) return null;

    let totalVotesSum = 0;
    let occupancySum = 0;
    const hourCounts = {};

    historicalDays.forEach(dateStr => {
        const dayEntry = rawDB[dateStr];
        let groupsToProcess = [];
        
        if (dayEntry.Version2 && dayEntry.grupos) {
            if (groupName === "Todos") groupsToProcess = Object.values(dayEntry.grupos);
            else if (dayEntry.grupos[groupName]) groupsToProcess = [dayEntry.grupos[groupName]];
        } else if (!dayEntry.Version2) {
            if (groupName === "Todos" || groupName === "Grupo Geral (Legado)") groupsToProcess = [dayEntry];
        }

        let dayTotalVotes = 0;
        let dayOccupancy = 0;

        groupsToProcess.forEach(payload => {
            if (!payload.votes) return;
            Object.entries(payload.votes).forEach(([jid, vData]) => {
                dayTotalVotes++;
                const opt = typeof vData === 'object' ? vData.option : vData;
                if (["Irei, ida e volta.", "Irei, mas não retornarei.", "Não irei, apenas retornarei."].includes(opt)) {
                    dayOccupancy++;
                }

                if (vData.timestamp) {
                    const hr = moment(vData.timestamp).tz("America/Sao_Paulo").hour();
                    hourCounts[hr] = (hourCounts[hr] || 0) + 1;
                }
            });
        });

        totalVotesSum += dayTotalVotes;
        occupancySum += dayOccupancy;
    });

    const avgVotes = Math.round(totalVotesSum / historicalDays.length);
    const avgOccupancy = Math.round(occupancySum / historicalDays.length);
    
    let peakHour = "--";
    let maxHourVotes = -1;
    Object.entries(hourCounts).forEach(([hr, count]) => {
        if (count > maxHourVotes) {
            maxHourVotes = count;
            peakHour = hr.padStart(2, '0') + ":00";
        }
    });

    let confidence = "Baixa";
    if (historicalDays.length >= 8) confidence = "Altíssima";
    else if (historicalDays.length >= 4) confidence = "Alta";
    else if (historicalDays.length >= 2) confidence = "Média";

    return {
        targetDate: targetDateStr,
        avgVotes,
        avgOccupancy,
        peakHour,
        confidence
    };
};

const createPredictionCard = (groupName, stats) => {
    const card = document.createElement("div");
    card.className = "prediction-card";
    
    const aliasSource = (typeof groupAliases !== 'undefined') ? groupAliases : window.groupAliases;
    const displayName = (aliasSource && aliasSource[groupName]) ? aliasSource[groupName] : groupName;

    card.innerHTML = `
        <div class="prediction-header">
            <div style="display: flex; align-items: center; gap: 10px;">
                <div class="ai-icon"><i data-lucide="sparkles" style="width: 18px; height: 18px;"></i></div>
                <div style="display: flex; flex-direction: column;">
                    <h2 style="margin: 0; font-size: 1.1rem; color: #fff; font-weight: 700;">Previsão Inteligente</h2>
                    <span style="font-size: 0.75rem; color: rgba(255,255,255,0.7); font-weight: 600;">${displayName}</span>
                </div>
            </div>
            <div style="font-size: 0.8rem; color: rgba(255,255,255,0.5); font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em;">${stats.targetDate}</div>
        </div>
        <div class="prediction-body">
            <div class="prediction-main">
                <div style="display: flex; flex-direction: column;">
                    <span class="prediction-label">Presença Estimada</span>
                    <div style="display: flex; align-items: baseline; gap: 8px;">
                        <span class="prediction-value">${stats.avgOccupancy}</span>
                        <span class="prediction-unit">estudantes</span>
                    </div>
                </div>
            </div>
            <div class="prediction-divider"></div>
            <div class="prediction-stats">
                <div class="p-stat">
                    <span class="p-label">Horário de Pico</span>
                    <span class="p-val">${stats.peakHour}</span>
                </div>
                <div class="p-stat">
                    <span class="p-label">Nível de Confiança</span>
                    <span class="p-val">${stats.confidence}</span>
                </div>
            </div>
        </div>
    `;
    return card;
};

window.renderPrediction = renderPrediction;
