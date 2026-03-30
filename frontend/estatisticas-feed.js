// Feed de Votos e Pendências

const switchFeedTab = (tab) => {
    currentFeedTab = tab;
    feedLimit = 10;
    document.getElementById('tabVotes').classList.toggle('active', tab === 'votes');
    document.getElementById('tabPending').classList.toggle('active', tab === 'pending');
    updateVoteFeed(currentTargetGroup);
};

const loadMoreVotes = () => { feedLimit += 10; updateVoteFeed(currentTargetGroup); };

const updateVoteFeed = (targetGroup) => {
    currentTargetGroup = targetGroup;
    const body = document.getElementById("voteFeedBody");
    const header = document.getElementById("feedHeader");
    const btnContainer = document.getElementById("loadMoreContainer");
    if (!body) return;

    const formatPhone = (raw) => {
        let clean = raw.replace(/\D/g, "");
        if (clean.startsWith("55")) clean = clean.substring(2);
        if (clean.length < 10) return raw;
        const ddd = clean.substring(0, 2);
        const hasNine = clean.length === 11;
        const nine = hasNine ? clean.substring(2, 3) + "-" : "";
        const prefix = clean.substring(hasNine ? 3 : 2, hasNine ? 7 : 6);
        return "(" + ddd + ")" + nine + prefix + "-xxxx";
    };

    const todayStr = moment().tz("America/Sao_Paulo").format('YYYY-MM-DD');
    const dayEntry = rawDB[todayStr] || { grupos: {} };

    if (currentFeedTab === 'votes') {
        header.innerHTML = '<th>Horário</th><th>Estudante</th><th>Rota</th><th>Resposta</th>';
    } else {
        header.innerHTML = '<th>Estudante</th><th>Rota</th><th>Status</th>';
        if (!isPollSentToday) {
            body.innerHTML = '<tr><td colspan="3" style="text-align: center; color: #555; padding: 40px;">' +
                '<div style="margin-bottom: 10px; opacity: 0.5; font-size: 2rem;">🕒</div>' +
                'Aguardando o envio da enquete de hoje (' + moment().tz("America/Sao_Paulo").format("DD/MM") + ').</td></tr>';
            btnContainer.style.display = "none";
            return;
        }
    }

    if (currentFeedTab === 'votes') {
        let allTodayVotes = [];
        Object.keys(dayEntry.grupos).forEach(gName => {
            if (targetGroup !== "Todos" && gName !== targetGroup) return;
            const groupData = dayEntry.grupos[gName];
            Object.keys(groupData.votes).forEach(vId => {
                const vData = groupData.votes[vId];
                allTodayVotes.push({ voter_id: vId, group: gName, option: typeof vData === 'object' ? vData.option : vData, timestamp: vData.timestamp || todayStr });
            });
        });
        allTodayVotes.sort((a, b) => moment(b.timestamp).valueOf() - moment(a.timestamp).valueOf());
        body.innerHTML = "";
        const visibleVotes = allTodayVotes.slice(0, feedLimit);
        if (visibleVotes.length === 0) {
            body.innerHTML = '<tr><td colspan="4" style="text-align: center; color: #555; padding: 30px;">Nenhum voto registrado hoje.</td></tr>';
            btnContainer.style.display = "none";
        } else {
            visibleVotes.forEach(vote => {
                const pass = getPassengerByJid(vote.voter_id);
                const row = document.createElement("tr");
                row.className = "feed-row";
                const timeStr = vote.timestamp ? moment(vote.timestamp).tz("America/Sao_Paulo").format("HH:mm") : "--:--";
                const maskedPhone = formatPhone(vote.voter_id.split('@')[0]);
                const firstName = (pass ? pass.name : "Ext").split(' ')[0];
                const displayName = firstName + " - " + maskedPhone;
                const photo = (pass && pass.photo_url) ? pass.photo_url : "https://ui-avatars.com/api/?name=" + encodeURIComponent(displayName) + "&background=333&color=fff";
                const routeAlias = groupAliases[vote.group] || vote.group;
                let optClass = "tag-vote";
                if (vote.option.includes("Não irei")) optClass = "tag-absence";
                if (vote.option.includes("apenas retornarei")) optClass = "tag-waiting";
                row.innerHTML = `<td class="timestamp-cell">${timeStr}</td><td><div class="user-cell"><img src="${photo}" class="user-avatar" onerror="this.src='https://ui-avatars.com/api/?name=?'"><span class="user-name">${displayName}</span></div></td><td><span class="tag tag-route">${routeAlias}</span></td><td><span class="tag ${optClass}">${vote.option}</span></td>`;
                body.appendChild(row);
            });
            btnContainer.style.display = (allTodayVotes.length > feedLimit) ? "block" : "none";
        }
    } else {
        if (btnContainer) btnContainer.style.display = "none";
        const votersToday = [];
        Object.keys(dayEntry.grupos).forEach(gName => { Object.keys(dayEntry.grupos[gName].votes).forEach(vId => votersToday.push(vId)); });
        const tGroup = (targetGroup === "Todos") ? null : targetGroup;
        const pendingUsers = passengers.filter(p => { if (tGroup && p.group_name !== tGroup) return false; return !votersToday.includes(p.jid); });
        body.innerHTML = "";
        if (pendingUsers.length === 0) {
            body.innerHTML = '<tr><td colspan="3" style="text-align: center; color: #4caf50; padding: 30px;">✅ Todos os passageiros votaram hoje!</td></tr>';
        } else {
            pendingUsers.forEach(user => {
                const row = document.createElement("tr");
                row.className = "feed-row";
                const routeAlias = groupAliases[user.group_name] || user.group_name;
                const firstName = user.name.split(' ')[0];
                const maskedPhone = formatPhone(user.phone || user.jid.split('@')[0]);
                const displayName = firstName + " - " + maskedPhone;
                const photo = user.photo_url || "https://ui-avatars.com/api/?name=" + encodeURIComponent(displayName) + "&background=333&color=fff";
                row.innerHTML = `<td><div class="user-cell"><img src="${photo}" class="user-avatar" onerror="this.src='https://ui-avatars.com/api/?name=?'"><span class="user-name">${displayName}</span></div></td><td><span class="tag tag-route">${routeAlias}</span></td><td><span class="tag tag-pending">PENDENTE</span></td>`;
                body.appendChild(row);
            });
        }
    }
};
