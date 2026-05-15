let rankingOrder = 'desc'; // 'desc' = Mais, 'asc' = Menos
let rankingSearch = '';
let rankingRoute = 'Todos';
let rankingType = 'presence'; // 'presence' ou 'consistency'
let currentPageRanking = 1;
const itemsPerPageRanking = 10;

window.toggleRankingOrder = () => {
    rankingOrder = rankingOrder === 'desc' ? 'asc' : 'desc';
    const btn = document.getElementById('btnToggleRanking');
    if (btn) {
        let label = rankingOrder === 'desc' ? 'Mais' : 'Menos';
        if (rankingType === 'presence') label += ' Presença';
        else label += ' Consistência';

        btn.innerHTML = rankingOrder === 'desc'
            ? `<i data-lucide="arrow-down-up" style="width: 16px; height: 16px;"></i> ${label}`
            : `<i data-lucide="arrow-up-down" style="width: 16px; height: 16px;"></i> ${label}`;
        if (window.lucide) window.lucide.createIcons();
    }
    currentPageRanking = 1;
    updateRanking();
};

window.handleRankingType = (val) => {
    rankingType = val;
    const btn = document.getElementById('btnToggleRanking');
    if (btn) {
        let label = rankingOrder === 'desc' ? 'Mais' : 'Menos';
        if (rankingType === 'presence') label += ' Presença';
        else label += ' Consistência';
        btn.innerHTML = `<i data-lucide="arrow-down-up" style="width: 16px; height: 16px;"></i> ${label}`;
    }
    currentPageRanking = 1;
    updateRanking();
};

window.handleSearchRanking = (val) => {
    rankingSearch = normalizeSearch(val);
    currentPageRanking = 1;
    updateRanking();
};

window.handleRankingRoute = (val) => {
    rankingRoute = val;
    currentPageRanking = 1;
    updateRanking();
};

window.goToPageRanking = (page) => {
    currentPageRanking = page;
    updateRanking();
};

const updateRanking = (targetGroupFromDash, _targetDaysStr) => {
    const rkSelect = document.getElementById("rankingRouteSelect");
    const targetGroup = rankingRoute; 
    const totalPolls = pollHistory.length || 1;
    const userStats = new Map();

    const normalizeJidKey = (jid) => {
        if (!jid) return jid;
        const atIdx = jid.indexOf('@');
        if (atIdx === -1) return jid;
        const domain = jid.substring(atIdx + 1);
        if (domain === 'lid') return jid;
        let digits = jid.substring(0, atIdx).replace(/\D/g, '');
        if (digits.startsWith('55') && digits.length === 12) {
            digits = digits.substring(0, 4) + '9' + digits.substring(4);
        }
        return digits;
    };

    // Preparar dados por usuário
    Object.keys(rawDB).forEach(dateStr => {
        const dayEntry = rawDB[dateStr];
        let groupsToProcess = [];

        if (dayEntry.Version2 && dayEntry.grupos) {
            if (targetGroup === "Todos") {
                Object.keys(dayEntry.grupos).forEach(gName => {
                    groupsToProcess.push({ gName, payload: dayEntry.grupos[gName] });
                });
            } else if (dayEntry.grupos[targetGroup]) {
                groupsToProcess.push({ gName: targetGroup, payload: dayEntry.grupos[targetGroup] });
            }
        } else if (!dayEntry.Version2) {
            if (targetGroup === "Todos" || targetGroup === "Grupo Geral (Legado)") {
                groupsToProcess.push({ gName: "Grupo Geral (Legado)", payload: dayEntry });
            }
        }

        const dayUniqueVoters = new Map();
        groupsToProcess.forEach(({ gName, payload }) => {
            if (!payload.votes) return;
            Object.entries(payload.votes).forEach(([jid, vData]) => {
                const key = normalizeJidKey(jid);
                if (dayUniqueVoters.has(key)) return;
                const opt = typeof vData === 'object' ? vData.option : vData;
                const ts = typeof vData === 'object' ? vData.timestamp : null;
                const voter_name = typeof vData === 'object' ? vData.voter_name : undefined;
                const photo_url = typeof vData === 'object' ? (vData.photo_url || null) : null;
                dayUniqueVoters.set(key, { opt, ts, voter_name, photo_url, gName });
            });
        });

        dayUniqueVoters.forEach((vData, key) => {
            if (!userStats.has(key)) {
                const name = vData.voter_name || null;
                if (!name) return;

                userStats.set(key, {
                    name,
                    photo_url: vData.photo_url || null,
                    group: vData.gName,
                    presenceCount: 0,
                    absenceCount: 0,
                    totalSeconds: 0,
                    voteCountForAvg: 0,
                    votesByDate: {}, // Para cálculo de streak
                    lastVoteDate: null
                });
            }

            const stats = userStats.get(key);
            if (!stats) return;

            if (vData.photo_url && !stats.photo_url) {
                stats.photo_url = vData.photo_url;
            }

            const opt = vData.opt;
            stats.votesByDate[dateStr] = opt;

            if (
                opt === "Irei, ida e volta." ||
                opt === "Irei, mas não retornarei." ||
                opt === "Não irei, apenas retornarei."
            ) {
                stats.presenceCount++;
            } else if (opt === "Não irei à faculdade hoje.") {
                stats.absenceCount++;
            }

            if (vData.ts) {
                const m = moment(vData.ts).tz("America/Sao_Paulo");
                stats.totalSeconds += m.hours() * 3600 + m.minutes() * 60 + m.seconds();
                stats.voteCountForAvg++;
            }
        });
    });

    // Cálculo de Streaks e Pontualidade
    const normalizedPollHistory = pollHistory.map(d => moment(d).format('YYYY-MM-DD'));
    const sortedPollDates = [...new Set(normalizedPollHistory)].sort((a, b) => b.localeCompare(a)); // Descendente
    
    let fullRanking = [];
    userStats.forEach((stats, key) => {
        if (stats.presenceCount === 0 && stats.absenceCount === 0) return;

        // Normalizar votos do usuário
        const userVotesNormalized = {};
        Object.keys(stats.votesByDate).forEach(d => {
            userVotesNormalized[moment(d).format('YYYY-MM-DD')] = stats.votesByDate[d];
        });

        // Cálculo da sequência (streak) - Apenas presenças contam
        let currentStreak = 0;
        let maxStreak = 0;
        for (let i = 0; i < sortedPollDates.length; i++) {
            const d = sortedPollDates[i];
            const opt = userVotesNormalized[d];
            if (opt === "Irei, ida e volta." || opt === "Irei, mas não retornarei." || opt === "Não irei, apenas retornarei.") {
                currentStreak++;
                if (currentStreak > maxStreak) maxStreak = currentStreak;
            } else {
                currentStreak = 0;
            }
        }
        
        // Latest streak (sequência atual terminando hoje ou no último dia disponível)
        let latestStreak = 0;
        for (let i = 0; i < sortedPollDates.length; i++) {
            const d = sortedPollDates[i];
            const opt = userVotesNormalized[d];
            if (opt === "Irei, ida e volta." || opt === "Irei, mas não retornarei." || opt === "Não irei, apenas retornarei.") {
                latestStreak++;
            } else {
                break;
            }
        }

        const avgSeconds = stats.voteCountForAvg > 0
            ? stats.totalSeconds / stats.voteCountForAvg
            : Infinity;
        
        const absenceRate = (stats.absenceCount / totalPolls) * 100;
        
        // Pontuação de consistência: peso para streak, peso para baixa ausência, peso para pontualidade
        // Quanto maior o streak, melhor. Quanto menor a ausência, melhor. Quanto menor o avgSeconds, melhor.
        // Peso massivo para streaks e penalidade para ausências no ranking de consistência
        const consistencyScore = (maxStreak * 200) + (latestStreak * 100) + (stats.presenceCount * 10) - (absenceRate * 10) - (avgSeconds / 3600);

        fullRanking.push({ 
            ...stats, 
            avgSeconds, 
            maxStreak, 
            latestStreak,
            absenceRate,
            consistencyScore,
            routeAlias: groupAliases[stats.group] || stats.group 
        });
    });

    // Ordenação
    fullRanking.sort((a, b) => {
        if (rankingType === 'presence') {
            if (rankingOrder === 'desc') {
                if (b.presenceCount !== a.presenceCount) return b.presenceCount - a.presenceCount;
                return a.avgSeconds - b.avgSeconds;
            } else {
                if (a.presenceCount !== b.presenceCount) return a.presenceCount - b.presenceCount;
                return b.avgSeconds - a.avgSeconds;
            }
        } else {
            // Consistência
            if (rankingOrder === 'desc') {
                return b.consistencyScore - a.consistencyScore;
            } else {
                return a.consistencyScore - b.consistencyScore;
            }
        }
    });

    fullRanking.forEach((user, idx) => {
        user.globalRank = idx;
    });

    let visibleRankingList = fullRanking;
    if (rankingSearch) {
        const term = normalizeSearch(rankingSearch);
        visibleRankingList = fullRanking.filter(stats => 
            normalizeSearch(stats.name).includes(term)
        );
    }

    let minAvg = Infinity, maxAvg = -Infinity;
    fullRanking.forEach(u => {
        if (u.avgSeconds !== Infinity && u.avgSeconds > 0) {
            if (u.avgSeconds < minAvg) minAvg = u.avgSeconds;
            if (u.avgSeconds > maxAvg) maxAvg = u.avgSeconds;
        }
    });

    const body = document.getElementById("rankingBody");
    const btnContainer = document.getElementById("rankingPaginationContainer");
    if (!body) return;
    body.innerHTML = "";

    const fmtTime = (secs) => {
        if (secs === Infinity || isNaN(secs)) return "--:--";
        const h = Math.floor(secs / 3600);
        const m = Math.floor((secs % 3600) / 60);
        return String(h).padStart(2, '0') + ":" + String(m).padStart(2, '0');
    };

    const renderRow = (user, globalIndex) => {
        const row = document.createElement("tr");
        row.className = "feed-row";

        let rankBadge = `<span class="rank-badge">${user.globalRank + 1}º</span>`;
        let nameClass = "";
        if (rankingOrder === 'desc') {
            if (user.globalRank === 0) {
                rankBadge = '<span class="rank-badge rank-gold"><i data-lucide="medal" style="width:14px;height:14px;margin-right:2px;"></i>1º</span>';
                nameClass = "name-gold";
            } else if (user.globalRank === 1) {
                rankBadge = '<span class="rank-badge rank-silver"><i data-lucide="medal" style="width:14px;height:14px;margin-right:2px;"></i>2º</span>';
                nameClass = "name-silver";
            } else if (user.globalRank === 2) {
                rankBadge = '<span class="rank-badge rank-bronze"><i data-lucide="medal" style="width:14px;height:14px;margin-right:2px;"></i>3º</span>';
                nameClass = "name-bronze";
            }
        }

        const displayName = formatName(user.name);
        
        // Cálculo de Badges
        let userBadgesHtml = '';
        
        // Sequência (Streak)
        if (user.latestStreak >= 5) {
            const streakTitle = user.latestStreak >= 10 ? `Super Streak de ${user.latestStreak} dias` : `Streak de ${user.latestStreak} dias`;
            const streakColor = user.latestStreak >= 10 ? '#ff5722' : '#ffc107';
            const streakIcon = user.latestStreak >= 10 ? 'flame' : 'zap';
            userBadgesHtml += `<span class="user-badge-icon" title="${streakTitle}" style="color: ${streakColor};"><i data-lucide="${streakIcon}"></i></span>`;
        }

        // Frequência Exemplar: 75% de presença
        const presenceRate = (user.presenceCount / totalPolls) * 100;
        if (presenceRate >= 75) {
            userBadgesHtml += `<span class="user-badge-icon" title="Frequência Exemplar (75%+)" style="color: #4caf50;"><i data-lucide="shield-check"></i></span>`;
        }

        // Madrugadores
        if (user.avgSeconds < 25200 && user.avgSeconds !== Infinity) { // Antes das 07:00
            const earlyTitle = user.avgSeconds < 21600 ? "Madrugador Elite (antes das 06h)" : "Madrugador (antes das 07h)";
            const earlyIcon = user.avgSeconds < 21600 ? "coffee" : "sunrise";
            userBadgesHtml += `<span class="user-badge-icon" title="${earlyTitle}" style="color: #ff9800;"><i data-lucide="${earlyIcon}"></i></span>`;
        }

        // Atrasado / Madrugador Extremo
        if (user.avgSeconds > 64800 && user.avgSeconds !== Infinity) { // Depois das 18:00
            userBadgesHtml += `<span class="user-badge-icon" title="Atrasado (vota após as 18h)" style="color: #9c27b0;"><i data-lucide="moon"></i></span>`;
        }

        // Recordes de Tempo (Mais Rápido / Mais Lento)
        if (user.avgSeconds === minAvg && user.avgSeconds !== Infinity) {
            userBadgesHtml += `<span class="user-badge-icon" title="O Mais Rápido (Recorde)" style="color: #ffeb3b;"><i data-lucide="zap"></i></span>`;
        }
        if (user.avgSeconds === maxAvg && user.avgSeconds !== -Infinity) {
            userBadgesHtml += `<span class="user-badge-icon" title="O Mais Lento" style="color: #9e9e9e;"><i data-lucide="snail"></i></span>`;
        }

        // Títulos de Veterano
        if (user.presenceCount >= 30) {
            let honorTitle = "Veterano (+30 presenças)";
            let honorColor = "#2196f3";
            let honorIcon = "award";
            
            if (user.presenceCount >= 100) {
                honorTitle = "Membro Diamante (+100 presenças)";
                honorColor = "#00bcd4";
                honorIcon = "gem";
            } else if (user.presenceCount >= 50) {
                honorTitle = "Lenda da Linha (+50 presenças)";
                honorColor = "#ffd700";
                honorIcon = "trophy";
            }
            
            userBadgesHtml += `<span class="user-badge-icon" title="${honorTitle}" style="color: ${honorColor};"><i data-lucide="${honorIcon}"></i></span>`;
        }

        // Comprometimento Total: nunca votou que não iria
        if (user.absenceCount === 0 && user.presenceCount > 0) {
            userBadgesHtml += `<span class="user-badge-icon" title="Comprometimento Total (0 faltas)" style="color: #8bc34a;"><i data-lucide="check-circle"></i></span>`;
        }

        if (rankingType === 'presence') {
            const presenceLabel = user.presenceCount === 1 ? 'presença' : 'presenças';
            row.innerHTML = `
                <td style="width:60px;text-align:center;">${rankBadge}</td>
                <td>
                    <div class="user-cell">
                        <div style="display:flex; flex-direction:column;">
                            <span class="user-name ${nameClass}">${displayName}</span>
                            <div class="user-badges-container">${userBadgesHtml}</div>
                        </div>
                    </div>
                </td>
                <td>
                    <div style="display:flex;flex-direction:column;gap:4px;">
                        <span class="tag tag-vote" style="font-size:0.7rem;">${user.presenceCount} ${presenceLabel}</span>
                        <span class="tag tag-route" style="opacity:0.7;">${user.routeAlias}</span>
                    </div>
                </td>
                <td style="text-align:right;">
                    <div style="font-size:0.75rem;color:#888;">Média horário</div>
                    <div style="font-size:0.9rem;font-weight:700;color:var(--accent);">${fmtTime(user.avgSeconds)}</div>
                </td>
            `;
        } else {
            // Layout de Consistência
            row.innerHTML = `
                <td style="width:60px;text-align:center;">${rankBadge}</td>
                <td>
                    <div class="user-cell">
                        <div style="display:flex; flex-direction:column;">
                            <span class="user-name ${nameClass}">${displayName}</span>
                            <div class="user-badges-container">${userBadgesHtml}</div>
                            <div style="font-size:0.7rem;color:#666;margin-top:2px;">${user.routeAlias}</div>
                        </div>
                    </div>
                </td>
                <td>
                    <div style="display:flex;flex-direction:column;gap:4px;">
                        <span class="tag" style="background:rgba(33,150,243,0.1);color:#2196f3;border:1px solid rgba(33,150,243,0.2);font-size:0.7rem;">
                            <i data-lucide="zap" style="width:10px;height:10px;margin-right:3px;"></i> ${user.maxStreak} dias seguidos
                        </span>
                        <span class="tag" style="background:rgba(244,67,54,0.1);color:#f44336;border:1px solid rgba(244,67,54,0.2);font-size:0.7rem;">
                            Faltas: ${user.absenceRate.toFixed(0)}%
                        </span>
                    </div>
                </td>
                <td style="text-align:right;">
                    <div style="font-size:0.75rem;color:#888;">Pontualidade</div>
                    <div style="font-size:0.9rem;font-weight:700;color:#4caf50;">${fmtTime(user.avgSeconds)}</div>
                </td>
            `;
        }

        return row;
    };

    const totalItems = visibleRankingList.length;
    const totalPages = Math.ceil(totalItems / itemsPerPageRanking);
    if (currentPageRanking > totalPages && totalPages > 0) currentPageRanking = totalPages;
    
    const startIndex = (currentPageRanking - 1) * itemsPerPageRanking;
    const visibleRanking = visibleRankingList.slice(startIndex, startIndex + itemsPerPageRanking);

    if (visibleRanking.length === 0) {
        body.innerHTML = '<tr><td colspan="4" style="text-align:center;color:#555;padding:30px;">Nenhum dado encontrado.</td></tr>';
        if (btnContainer) btnContainer.innerHTML = "";
    } else {
        visibleRanking.forEach((user, idx) => {
            body.appendChild(renderRow(user, startIndex + idx));
        });

        if (btnContainer) {
            if (totalPages <= 1) {
                btnContainer.innerHTML = '';
            } else {
                let html = '';
                html += `<button class="btn-page" onclick="goToPageRanking(${currentPageRanking - 1})" ${currentPageRanking === 1 ? 'disabled' : ''}><i data-lucide="chevron-left"></i></button>`;
                html += `<span class="pagination-info">Página ${currentPageRanking} de ${totalPages}</span>`;
                html += `<button class="btn-page" onclick="goToPageRanking(${currentPageRanking + 1})" ${currentPageRanking === totalPages ? 'disabled' : ''}><i data-lucide="chevron-right"></i></button>`;
                btnContainer.innerHTML = html;
            }
        }
    }

    if (window.lucide) window.lucide.createIcons();
};

window.updateRanking = updateRanking;

window.updateRanking = updateRanking;
