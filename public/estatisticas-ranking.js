let rankingOrder = 'desc'; // 'desc' = Mais presença, 'asc' = Menos presença

window.toggleRankingOrder = () => {
    rankingOrder = rankingOrder === 'desc' ? 'asc' : 'desc';
    const btn = document.getElementById('btnToggleRanking');
    if (btn) {
        btn.innerHTML = rankingOrder === 'desc' ? 
            '<i data-lucide="arrow-down-up" style="width: 16px; height: 16px;"></i> Mais Presença' : 
            '<i data-lucide="arrow-up-down" style="width: 16px; height: 16px;"></i> Menos Presença';
        if (window.lucide) window.lucide.createIcons();
    }
    updateRanking(currentTargetGroup, document.getElementById("periodSelect").value);
};

const updateRanking = (targetGroup, targetDaysStr) => {
    const targetDays = parseInt(targetDaysStr, 10);
    const todayMoment = moment().startOf('day');

    const userStats = new Map();

    // Inicia com todos os passageiros
    passengers.forEach(p => {
        if (targetGroup !== "Todos" && p.group_name !== targetGroup) return;
        userStats.set(p.jid, {
            jid: p.jid,
            name: p.name,
            group: p.group_name,
            photo_url: p.photo_url,
            presenceCount: 0,
            totalSeconds: 0,
            voteCountForAvg: 0
        });
    });

    for (let i = targetDays - 1; i >= 0; i--) {
        const day = todayMoment.clone().subtract(i, 'days');
        const dateStr = day.format('YYYY-MM-DD');

        if (rawDB[dateStr]) {
            const dayEntry = rawDB[dateStr];
            let groupsToProcess = [];
            
            if (dayEntry.Version2 && dayEntry.grupos) {
                if (targetGroup === "Todos") groupsToProcess = Object.values(dayEntry.grupos);
                else if (dayEntry.grupos[targetGroup]) groupsToProcess = [dayEntry.grupos[targetGroup]];
            } else if (!dayEntry.Version2) {
                if (targetGroup === "Todos" || targetGroup === "Grupo Geral (Legado)") groupsToProcess = [dayEntry];
            }

            const dayUniqueVoters = new Map();
            groupsToProcess.forEach(groupPayload => {
                if (!groupPayload.votes) return;
                Object.entries(groupPayload.votes).forEach(([jid, vData]) => {
                    const opt = typeof vData === 'object' ? vData.option : vData;
                    const ts = typeof vData === 'object' ? vData.timestamp : null;
                    if (!dayUniqueVoters.has(jid)) {
                        dayUniqueVoters.set(jid, { opt, ts, group: groupPayload.name || targetGroup });
                    }
                });
            });

            dayUniqueVoters.forEach((vData, jid) => {
                // Ensure voter exists in map (if an external voter voted)
                if (!userStats.has(jid)) {
                    if (targetGroup !== "Todos" && vData.group !== targetGroup && vData.group !== "Grupo Geral (Legado)") return;
                    
                    const pass = getPassengerByJid(jid);
                    userStats.set(jid, {
                        jid: jid,
                        name: pass ? pass.name : "Ext (" + jid.split('@')[0].slice(-4) + ")",
                        group: vData.group || "Grupo Geral (Legado)",
                        photo_url: pass ? pass.photo_url : null,
                        presenceCount: 0,
                        totalSeconds: 0,
                        voteCountForAvg: 0
                    });
                }

                const opt = vData.opt;
                const stats = userStats.get(jid);

                if (opt === "Irei, ida e volta." || opt === "Irei, mas não retornarei." || opt === "Não irei, apenas retornarei.") {
                    stats.presenceCount++;
                }

                if (vData.ts) {
                    const m = moment(vData.ts).tz("America/Sao_Paulo");
                    const secondsSinceMidnight = m.hours() * 3600 + m.minutes() * 60 + m.seconds();
                    stats.totalSeconds += secondsSinceMidnight;
                    stats.voteCountForAvg++;
                }
            });
        }
    }

    const rankingArray = Array.from(userStats.values()).map(stats => {
        const avgSeconds = stats.voteCountForAvg > 0 ? (stats.totalSeconds / stats.voteCountForAvg) : Infinity;
        return {
            ...stats,
            avgSeconds,
            routeAlias: groupAliases[stats.group] || stats.group
        };
    });

    rankingArray.sort((a, b) => {
        if (rankingOrder === 'desc') {
            if (b.presenceCount !== a.presenceCount) return b.presenceCount - a.presenceCount; // Most presence first
            return a.avgSeconds - b.avgSeconds; // Then earliest avg vote time
        } else {
            if (a.presenceCount !== b.presenceCount) return a.presenceCount - b.presenceCount; // Least presence first
            return a.avgSeconds - b.avgSeconds; // Then earliest avg vote time
        }
    });

    const body = document.getElementById("rankingBody");
    if (!body) return;
    body.innerHTML = "";

    const formatSecondsToTime = (secs) => {
        if (secs === Infinity || isNaN(secs)) return "--:--";
        const h = Math.floor(secs / 3600);
        const m = Math.floor((secs % 3600) / 60);
        return String(h).padStart(2, '0') + ":" + String(m).padStart(2, '0');
    };

    const topItems = rankingArray.slice(0, 10); // Show top 10

    if (topItems.length === 0) {
        body.innerHTML = '<tr><td colspan="4" style="text-align: center; color: #555; padding: 30px;">Sem dados para o ranking.</td></tr>';
        return;
    }

    topItems.forEach((user, index) => {
        const row = document.createElement("tr");
        row.className = "feed-row";
        
        let rankBadge = \`<span class="rank-badge">\${index + 1}º</span>\`;
        if (rankingOrder === 'desc') {
            if (index === 0) rankBadge = \`<span class="rank-badge rank-gold"><i data-lucide="medal" style="width:16px;height:16px;margin-right:2px;"></i>1º</span>\`;
            else if (index === 1) rankBadge = \`<span class="rank-badge rank-silver"><i data-lucide="medal" style="width:16px;height:16px;margin-right:2px;"></i>2º</span>\`;
            else if (index === 2) rankBadge = \`<span class="rank-badge rank-bronze"><i data-lucide="medal" style="width:16px;height:16px;margin-right:2px;"></i>3º</span>\`;
        }

        const photo = user.photo_url || "https://ui-avatars.com/api/?name=" + encodeURIComponent(user.name) + "&background=333&color=fff";
        const avgTimeFormatted = formatSecondsToTime(user.avgSeconds);
        
        row.innerHTML = \`
            <td style="width: 60px; text-align: center;">\${rankBadge}</td>
            <td>
                <div class="user-cell">
                    <img src="\${photo}" class="user-avatar" onerror="this.src='https://ui-avatars.com/api/?name=?'">
                    <span class="user-name">\${user.name}</span>
                </div>
            </td>
            <td>
                <div style="display:flex; flex-direction:column; gap:4px; align-items:flex-start;">
                    <span class="tag tag-vote" style="font-size: 0.75rem;">\${user.presenceCount} \${user.presenceCount === 1 ? 'presença' : 'presenças'}</span>
                    <span class="tag tag-route" style="opacity: 0.8;">\${user.routeAlias}</span>
                </div>
            </td>
            <td style="text-align: right;">
                <div style="font-size: 0.8rem; color: #888;">Média horário</div>
                <div style="font-size: 0.95rem; font-weight: 700; color: \${user.avgSeconds === Infinity ? '#555' : 'var(--accent)'};">\${avgTimeFormatted}</div>
            </td>
        \`;
        body.appendChild(row);
    });

    if (window.lucide) window.lucide.createIcons();
};

window.updateRanking = updateRanking;
