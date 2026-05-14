
const renderPrediction = (targetGroup) => {
    const elParticipation = document.getElementById("predParticipation");
    const elOccupancy = document.getElementById("predOccupancy");
    const elPeakHour = document.getElementById("predPeakHour");
    const elConfidence = document.getElementById("predConfidence");
    const elTargetDate = document.getElementById("predictionTargetDate");

    if (!elParticipation) return;

    // 1. Identificar a data da próxima enquete
    // Se hoje ainda não foi enviada a enquete, a próxima é HOJE.
    // Se já foi enviada, a próxima é AMANHÃ (ou o próximo dia útil/configurado).
    let nextPollMoment = moment().tz("America/Sao_Paulo");
    if (isPollSentToday) {
        nextPollMoment.add(1, 'day');
    }

    // Pular finais de semana ou datas de skip (simplificado para amanhã/próximo dia útil)
    while (nextPollMoment.day() === 0 || nextPollMoment.day() === 6 || skipDates[nextPollMoment.format('DD/MM/YYYY')]) {
        nextPollMoment.add(1, 'day');
    }

    const weekdayIndex = nextPollMoment.day(); // 0-6
    const weekdayName = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'][weekdayIndex];
    elTargetDate.textContent = `Previsão para ${weekdayName} (${nextPollMoment.format('DD/MM')})`;

    // 2. Analisar histórico para esse dia da semana
    const historicalDays = [];
    Object.keys(rawDB).forEach(dateStr => {
        if (moment(dateStr).day() === weekdayIndex) {
            historicalDays.push(dateStr);
        }
    });

    if (historicalDays.length === 0) {
        elParticipation.textContent = "--";
        elOccupancy.textContent = "Sem dados";
        elPeakHour.textContent = "--";
        elConfidence.textContent = "Baixa";
        return;
    }

    let totalVotesSum = 0;
    let occupancySum = 0;
    const hourCounts = {};

    historicalDays.forEach(dateStr => {
        const dayEntry = rawDB[dateStr];
        let groupsToProcess = [];
        if (dayEntry.Version2 && dayEntry.grupos) {
            if (targetGroup === "Todos") groupsToProcess = Object.values(dayEntry.grupos);
            else if (dayEntry.grupos[targetGroup]) groupsToProcess = [dayEntry.grupos[targetGroup]];
        } else if (!dayEntry.Version2) {
            if (targetGroup === "Todos" || targetGroup === "Grupo Geral (Legado)") groupsToProcess = [dayEntry];
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
    
    // Encontrar hora de pico
    let peakHour = "--";
    let maxHourVotes = -1;
    Object.entries(hourCounts).forEach(([hr, count]) => {
        if (count > maxHourVotes) {
            maxHourVotes = count;
            peakHour = hr.padStart(2, '0') + ":00";
        }
    });

    // Confiança baseada na quantidade de dados históricos
    let confidence = "Baixa";
    if (historicalDays.length >= 8) confidence = "Altíssima";
    else if (historicalDays.length >= 4) confidence = "Alta";
    else if (historicalDays.length >= 2) confidence = "Média";

    // 3. Atualizar UI
    elParticipation.textContent = avgVotes;
    elOccupancy.textContent = `${avgOccupancy} vagas`;
    elPeakHour.textContent = peakHour;
    elConfidence.textContent = confidence;
};

window.renderPrediction = renderPrediction;
