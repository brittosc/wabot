
const updateGroupMilestones = (targetGroup) => {
    const elRecord = document.getElementById("milestoneRecord");
    const elRecordDate = document.getElementById("milestoneRecordDate");
    const elEngagement = document.getElementById("milestoneEngagement");
    const elGoal = document.getElementById("milestoneGoal");
    const elGoalStatus = document.getElementById("milestoneGoalStatus");

    if (!elRecord) return;

    let maxPresence = 0;
    let recordDate = "";
    let minAbsence = Infinity;
    let minAbsenceDate = "";
    let fastestTime = Infinity;
    let fastestDate = "";

    let totalPresenceLast30 = 0;
    let daysWithDataLast30 = 0;
    
    const today = moment().tz("America/Sao_Paulo");
    const thirtyDaysAgo = today.clone().subtract(30, 'days');

    Object.keys(rawDB).forEach(dateStr => {
        const mDate = moment(dateStr);
        const dayEntry = rawDB[dateStr];
        let groupsToProcess = [];
        
        if (dayEntry.Version2 && dayEntry.grupos) {
            if (targetGroup === "Todos") groupsToProcess = Object.values(dayEntry.grupos);
            else if (dayEntry.grupos[targetGroup]) groupsToProcess = [dayEntry.grupos[targetGroup]];
        } else if (!dayEntry.Version2) {
            if (targetGroup === "Todos" || targetGroup === "Grupo Geral (Legado)") groupsToProcess = [dayEntry];
        }

        const dayUniqueVoters = new Map();
        groupsToProcess.forEach(payload => {
            if (!payload.votes) return;
            Object.entries(payload.votes).forEach(([jid, vData]) => {
                const opt = typeof vData === 'object' ? vData.option : vData;
                const ts = typeof vData === 'object' ? vData.timestamp : null;
                if (!dayUniqueVoters.has(jid)) {
                    dayUniqueVoters.set(jid, { opt, ts });
                }
            });
        });

        if (dayUniqueVoters.size === 0) return;

        let dayPresence = 0;
        let dayAbsence = 0;
        let dayTotalSeconds = 0;
        let dayVoteCount = 0;

        dayUniqueVoters.forEach(vData => {
            const opt = vData.opt;
            if (["Irei, ida e volta.", "Irei, mas não retornarei.", "Não irei, apenas retornarei."].includes(opt)) {
                dayPresence++;
            } else if (opt === "Não irei à faculdade hoje.") {
                dayAbsence++;
            }

            if (vData.ts) {
                const m = moment(vData.ts).tz("America/Sao_Paulo");
                dayTotalSeconds += m.hours() * 3600 + m.minutes() * 60 + m.seconds();
                dayVoteCount++;
            }
        });

        // Recorde Histórico de Presença
        if (dayPresence > maxPresence) {
            maxPresence = dayPresence;
            recordDate = mDate.format('DD/MM/YYYY');
        }

        // Recorde de Menor Ausência (Mínimo de 10 votos totais para ser relevante)
        if (dayUniqueVoters.size >= 10 && dayAbsence < minAbsence) {
            minAbsence = dayAbsence;
            minAbsenceDate = mDate.format('DD/MM/YYYY');
        }

        // Recorde de Velocidade (Média de horário mais cedo)
        if (dayVoteCount >= 5) {
            const dayAvgTime = dayTotalSeconds / dayVoteCount;
            if (dayAvgTime < fastestTime) {
                fastestTime = dayAvgTime;
                fastestDate = mDate.format('DD/MM/YYYY');
            }
        }

        // Médias últimos 30 dias
        if (mDate.isAfter(thirtyDaysAgo)) {
            totalPresenceLast30 += dayPresence;
            daysWithDataLast30++;
        }
    });

    // Atualizar UI
    elRecord.textContent = `${maxPresence} alunos`;
    elRecordDate.textContent = recordDate;

    const elMinAbsence = document.getElementById("milestoneMinAbsence");
    const elMinAbsenceDate = document.getElementById("milestoneMinAbsenceDate");
    if (elMinAbsence) {
        elMinAbsence.textContent = minAbsence === Infinity ? "--" : `${minAbsence} faltas`;
        elMinAbsenceDate.textContent = minAbsenceDate || "--/--/----";
    }

    const elFastest = document.getElementById("milestoneFastest");
    const elFastestDate = document.getElementById("milestoneFastestDate");
    if (elFastest) {
        if (fastestTime === Infinity) {
            elFastest.textContent = "--:--";
        } else {
            const h = Math.floor(fastestTime / 3600);
            const m = Math.floor((fastestTime % 3600) / 60);
            elFastest.textContent = String(h).padStart(2, '0') + ":" + String(m).padStart(2, '0');
        }
        elFastestDate.textContent = fastestDate || "--/--/----";
    }

    const avgPresence30 = daysWithDataLast30 > 0 ? (totalPresenceLast30 / daysWithDataLast30) : 0;
    
    // Engajamento (Estimativa baseada na capacidade se disponível)
    // Se targetGroup for Todos, somamos capacidades
    let totalCap = 0;
    if (targetGroup === "Todos") {
        Object.values(capacities).forEach(c => totalCap += c);
    } else {
        totalCap = capacities[targetGroup] || 44; // Default para o ônibus
    }

    const engagementPercent = totalCap > 0 ? (avgPresence30 / totalCap) * 100 : 0;
    elEngagement.textContent = `${Math.round(engagementPercent)}%`;

    // Meta de Presença (Hoje ou Média)
    const goalStatus = engagementPercent >= 90 ? "Meta Atingida! 🚀" : `Faltam ${Math.round(90 - engagementPercent)}%`;
    elGoal.textContent = `${Math.round(engagementPercent)}%`;
    elGoalStatus.textContent = goalStatus;
};

window.updateGroupMilestones = updateGroupMilestones;
