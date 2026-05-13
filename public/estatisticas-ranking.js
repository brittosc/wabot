let rankingOrder = 'desc'; // 'desc' = Mais presença, 'asc' = Menos presença
let rankingSearch = '';

window.toggleRankingOrder = () => {
    rankingOrder = rankingOrder === 'desc' ? 'asc' : 'desc';
    const btn = document.getElementById('btnToggleRanking');
    if (btn) {
        btn.innerHTML = rankingOrder === 'desc'
            ? '<i data-lucide="arrow-down-up" style="width: 16px; height: 16px;"></i> Mais Presença'
            : '<i data-lucide="arrow-up-down" style="width: 16px; height: 16px;"></i> Menos Presença';
        if (window.lucide) window.lucide.createIcons();
    }
    updateRanking(currentTargetGroup, document.getElementById("periodSelect").value);
};

window.handleSearchRanking = (val) => {
    rankingSearch = val.toLowerCase().trim();
    updateRanking(currentTargetGroup, document.getElementById("periodSelect").value);
};

const updateRanking = (targetGroup, _targetDaysStr) => {
    // O ranking sempre usa o histórico completo, ignorando o filtro de período
    const userStats = new Map();

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

        // Deduplicação por dia: um voto por JID
        const dayUniqueVoters = new Map();
        groupsToProcess.forEach(({ gName, payload }) => {
            if (!payload.votes) return;
            Object.entries(payload.votes).forEach(([jid, vData]) => {
                if (dayUniqueVoters.has(jid)) return;
                const opt = typeof vData === 'object' ? vData.option : vData;
                const ts = typeof vData === 'object' ? vData.timestamp : null;
                // voter_name vem embutido no voto (igual ao feed)
                const voter_name = typeof vData === 'object' ? vData.voter_name : undefined;
                const photo_url = typeof vData === 'object' ? (vData.photo_url || null) : null;
                dayUniqueVoters.set(jid, { opt, ts, voter_name, photo_url, gName });
            });
        });

        dayUniqueVoters.forEach((vData, jid) => {
            if (!userStats.has(jid)) {
                // Resolve nome: voter_name > getPassengerByJid > fallback
                const pass = getPassengerByJid(jid);
                const name = vData.voter_name || (pass ? pass.name : null);
                if (!name) return;

                const group = pass ? (pass.group_name || vData.gName) : vData.gName;
                userStats.set(jid, {
                    name,
                    photo_url: vData.photo_url || (pass ? pass.photo_url : null),
                    group,
                    presenceCount: 0,
                    totalSeconds: 0,
                    voteCountForAvg: 0
                });
            }

            const stats = userStats.get(jid);
            if (!stats) return;

            // Atualiza foto se o voto atual tiver e o usuário ainda não tiver
            if (vData.photo_url && !stats.photo_url) {
                stats.photo_url = vData.photo_url;
            }

            const opt = vData.opt;
            if (
                opt === "Irei, ida e volta." ||
                opt === "Irei, mas não retornarei." ||
                opt === "Não irei, apenas retornarei."
            ) {
                stats.presenceCount++;
            }

            if (vData.ts) {
                const m = moment(vData.ts).tz("America/Sao_Paulo");
                stats.totalSeconds += m.hours() * 3600 + m.minutes() * 60 + m.seconds();
                stats.voteCountForAvg++;
            }
        });
    });

    // Monta e ordena o ranking completo
    const fullRanking = [];
    userStats.forEach(stats => {
        if (stats.presenceCount === 0) return;
        const avgSeconds = stats.voteCountForAvg > 0
            ? stats.totalSeconds / stats.voteCountForAvg
            : Infinity;
        fullRanking.push({
            ...stats,
            avgSeconds,
            routeAlias: groupAliases[stats.group] || stats.group
        });
    });

    fullRanking.sort((a, b) => {
        if (rankingOrder === 'desc') {
            if (b.presenceCount !== a.presenceCount) return b.presenceCount - a.presenceCount;
            return a.avgSeconds - b.avgSeconds; // desempate: mais cedo
        } else {
            if (a.presenceCount !== b.presenceCount) return a.presenceCount - b.presenceCount;
            return b.avgSeconds - a.avgSeconds; // desempate: mais tarde
        }
    });

    const body = document.getElementById("rankingBody");
    if (!body) return;
    body.innerHTML = "";

    const fmt = (secs) => {
        if (secs === Infinity || isNaN(secs)) return "--:--";
        const h = Math.floor(secs / 3600);
        const m = Math.floor((secs % 3600) / 60);
        return String(h).padStart(2, '0') + ":" + String(m).padStart(2, '0');
    };

    const renderRow = (user, globalIndex) => {
        const row = document.createElement("tr");
        row.className = "feed-row";

        let rankBadge = '<span class="rank-badge">' + (globalIndex + 1) + 'º</span>';
        if (rankingOrder === 'desc') {
            if (globalIndex === 0) rankBadge = '<span class="rank-badge rank-gold"><i data-lucide="medal" style="width:16px;height:16px;margin-right:2px;"></i>1º</span>';
            else if (globalIndex === 1) rankBadge = '<span class="rank-badge rank-silver"><i data-lucide="medal" style="width:16px;height:16px;margin-right:2px;"></i>2º</span>';
            else if (globalIndex === 2) rankBadge = '<span class="rank-badge rank-bronze"><i data-lucide="medal" style="width:16px;height:16px;margin-right:2px;"></i>3º</span>';
        }

        const photo = user.photo_url || "https://ui-avatars.com/api/?name=" + encodeURIComponent(user.name) + "&background=333&color=fff";
        const avgTime = fmt(user.avgSeconds);
        const avgColor = user.avgSeconds === Infinity ? '#555' : 'var(--accent)';
        const presenceLabel = user.presenceCount === 1 ? 'presença' : 'presenças';

        row.innerHTML =
            '<td style="width:60px;text-align:center;">' + rankBadge + '</td>' +
            '<td><div class="user-cell">' +
                '<img src="' + photo + '" class="user-avatar" onerror="this.src=\'https://ui-avatars.com/api/?name=?\'">' +
                '<span class="user-name">' + user.name + '</span>' +
            '</div></td>' +
            '<td><div style="display:flex;flex-direction:column;gap:4px;align-items:flex-start;">' +
                '<span class="tag tag-vote" style="font-size:0.75rem;">' + user.presenceCount + ' ' + presenceLabel + '</span>' +
                '<span class="tag tag-route" style="opacity:0.8;">' + user.routeAlias + '</span>' +
            '</div></td>' +
            '<td style="text-align:right;">' +
                '<div style="font-size:0.8rem;color:#888;">Média horário</div>' +
                '<div style="font-size:0.95rem;font-weight:700;color:' + avgColor + ';">' + avgTime + '</div>' +
            '</td>';

        return row;
    };

    if (rankingSearch) {
        // Busca no ranking completo — mostra posição real
        const results = [];
        fullRanking.forEach((user, idx) => {
            if (user.name.toLowerCase().includes(rankingSearch)) {
                results.push({ user, idx });
            }
        });
        if (results.length === 0) {
            body.innerHTML = '<tr><td colspan="4" style="text-align:center;color:#555;padding:30px;">Nenhum usuário encontrado.</td></tr>';
        } else {
            results.forEach(({ user, idx }) => body.appendChild(renderRow(user, idx)));
        }
    } else {
        // Top 10 normal
        if (fullRanking.length === 0) {
            body.innerHTML = '<tr><td colspan="4" style="text-align:center;color:#555;padding:30px;">Sem dados para o ranking.</td></tr>';
            return;
        }
        fullRanking.slice(0, 10).forEach((user, idx) => body.appendChild(renderRow(user, idx)));
    }

    if (window.lucide) window.lucide.createIcons();
};

window.updateRanking = updateRanking;
