let rankingOrder = 'desc'; // 'desc' = Mais presença, 'asc' = Menos presença
let rankingSearch = '';
let rankingRoute = 'Todos';
let currentPageRanking = 1;
const itemsPerPageRanking = 10;

window.toggleRankingOrder = () => {
    rankingOrder = rankingOrder === 'desc' ? 'asc' : 'desc';
    const btn = document.getElementById('btnToggleRanking');
    if (btn) {
        btn.innerHTML = rankingOrder === 'desc'
            ? '<i data-lucide="arrow-down-up" style="width: 16px; height: 16px;"></i> Mais Presença'
            : '<i data-lucide="arrow-up-down" style="width: 16px; height: 16px;"></i> Menos Presença';
        if (window.lucide) window.lucide.createIcons();
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
    // Se vier do dash principal (mudança no topo), opcionalmente ignoramos ou sincronizamos.
    // Para seguir a solicitação de "seletor de rota no ranking", usaremos o valor do rankingRouteSelect.
    const rkSelect = document.getElementById("rankingRouteSelect");
    if (rkSelect && targetGroupFromDash && targetGroupFromDash !== "ignore") {
        // Se o dash principal mudar, podemos sincronizar o seletor do ranking se desejado,
        // ou manter independente. Vamos sincronizar para evitar confusão.
        if (rkSelect.value !== targetGroupFromDash && targetGroupFromDash !== "Todos") {
             // rkSelect.value = targetGroupFromDash;
             // rankingRoute = targetGroupFromDash;
        }
    }
    
    const targetGroup = rankingRoute; 
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
                    totalSeconds: 0,
                    voteCountForAvg: 0
                });
            }

            const stats = userStats.get(key);
            if (!stats) return;

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

    let fullRanking = [];
    userStats.forEach(stats => {
        if (stats.presenceCount === 0) return;
        const avgSeconds = stats.voteCountForAvg > 0
            ? stats.totalSeconds / stats.voteCountForAvg
            : Infinity;
        
        fullRanking.push({ ...stats, avgSeconds, routeAlias: groupAliases[stats.group] || stats.group });
    });

    // Ordena o ranking completo para determinar as posições globais
    fullRanking.sort((a, b) => {
        if (rankingOrder === 'desc') {
            if (b.presenceCount !== a.presenceCount) return b.presenceCount - a.presenceCount;
            return a.avgSeconds - b.avgSeconds;
        } else {
            if (a.presenceCount !== b.presenceCount) return a.presenceCount - b.presenceCount;
            return b.avgSeconds - a.avgSeconds;
        }
    });

    // Atribui a posição global a cada usuário
    fullRanking.forEach((user, idx) => {
        user.globalRank = idx;
    });

    // Agora aplica o filtro de pesquisa, mas mantendo a posição global original
    let visibleRankingList = fullRanking;
    if (rankingSearch) {
        const term = normalizeSearch(rankingSearch);
        visibleRankingList = fullRanking.filter(stats => 
            normalizeSearch(stats.name).includes(term)
        );
    }

    const body = document.getElementById("rankingBody");
    const btnContainer = document.getElementById("rankingPaginationContainer");
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

        let rankBadge = '<span class="rank-badge">' + (user.globalRank + 1) + 'º</span>';
        if (rankingOrder === 'desc') {
            if (user.globalRank === 0) rankBadge = '<span class="rank-badge rank-gold"><i data-lucide="medal" style="width:16px;height:16px;margin-right:2px;"></i>1º</span>';
            else if (user.globalRank === 1) rankBadge = '<span class="rank-badge rank-silver"><i data-lucide="medal" style="width:16px;height:16px;margin-right:2px;"></i>2º</span>';
            else if (user.globalRank === 2) rankBadge = '<span class="rank-badge rank-bronze"><i data-lucide="medal" style="width:16px;height:16px;margin-right:2px;"></i>3º</span>';
        }

        const avgTime = fmt(user.avgSeconds);
        const avgColor = user.avgSeconds === Infinity ? '#555' : 'var(--accent)';
        const presenceLabel = user.presenceCount === 1 ? 'presença' : 'presenças';
        const displayName = formatName(user.name);

        row.innerHTML =
            '<td style="width:60px;text-align:center;">' + rankBadge + '</td>' +
            '<td><div class="user-cell">' +
                '<span class="user-name">' + displayName + '</span>' +
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

        // Adiciona linhas vazias para manter altura (opcional, igual ao feed)
        const emptyRows = itemsPerPageRanking - visibleRanking.length;
        if (emptyRows > 0 && totalPages > 1) {
            for (let i = 0; i < emptyRows; i++) {
                const row = document.createElement("tr");
                row.className = "feed-row";
                row.style.opacity = "0";
                row.style.pointerEvents = "none";
                row.innerHTML = `<td colspan="4">&nbsp;</td>`;
                body.appendChild(row);
            }
        }

        if (btnContainer) {
            if (totalPages <= 1) {
                btnContainer.innerHTML = '';
            } else {
                let html = '';
                html += `<button class="btn-page" onclick="goToPageRanking(${currentPageRanking - 1})" ${currentPageRanking === 1 ? 'disabled' : ''}><i data-lucide="chevron-left"></i></button>`;
                html += `<span class="pagination-info">Página ${currentPageRanking} de ${totalPages}</span>`;
                html += `<button class="btn-page" onclick="goToPageRanking(${currentPageRanking + 1})" ${currentPageRanking === totalPages ? 'disabled' : ''}><i data-lucide="chevron-right"></i></button>`;
                btnContainer.innerHTML = html;
                if (window.lucide) window.lucide.createIcons();
            }
        }
    }

    if (window.lucide) window.lucide.createIcons();
};

window.updateRanking = updateRanking;
