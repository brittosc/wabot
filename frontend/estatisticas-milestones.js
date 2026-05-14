
const updateGroupMilestones = (targetGroup) => {
    const elRecord = document.getElementById("milestoneRecord");
    const elRecordDate = document.getElementById("milestoneRecordDate");
    const elEngagement = document.getElementById("milestoneEngagement");
    const elGoal = document.getElementById("milestoneGoal");
    const elGoalStatus = document.getElementById("milestoneGoalStatus");

    if (!elRecord) return;

    let maxPresence = 0;
    let recordDate = "";
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

        const dayUniqueVoters = new Set();
        groupsToProcess.forEach(payload => {
            if (!payload.votes) return;
            Object.entries(payload.votes).forEach(([jid, vData]) => {
                const opt = typeof vData === 'object' ? vData.option : vData;
                if (["Irei, ida e volta.", "Irei, mas não retornarei.", "Não irei, apenas retornarei."].includes(opt)) {
                    dayUniqueVoters.add(jid);
                }
            });
        });

        const dayPresence = dayUniqueVoters.size;
        
        // Recorde Histórico
        if (dayPresence > maxPresence) {
            maxPresence = dayPresence;
            recordDate = mDate.format('DD/MM/YYYY');
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
