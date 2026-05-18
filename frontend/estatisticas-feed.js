// Feed de Votos e Pendências

let currentFeedSearch = '';
let currentFeedOption = '';
let currentFeedRoute = '';
let currentPage = 1;
const itemsPerPage = 10;

window.handleSearchFeed = (val) => {
    currentFeedSearch = val.toLowerCase().trim();
    currentPage = 1;
    updateVoteFeed(currentTargetGroup);
};

window.handleFilterOption = (val) => {
    currentFeedOption = val.toLowerCase().trim();
    currentPage = 1;
    updateVoteFeed(currentTargetGroup);
};

window.handleFilterRoute = (val) => {
    currentFeedRoute = val;
    currentPage = 1;
    updateVoteFeed(currentTargetGroup);
};

window.goToPage = (page) => {
    currentPage = page;
    updateVoteFeed(currentTargetGroup);
};

const switchFeedTab = (tab) => {
    currentFeedTab = tab;
    currentPage = 1;
    document.getElementById('tabVotes').classList.toggle('active', tab === 'votes');
    document.getElementById('tabPending').classList.toggle('active', tab === 'pending');
    updateVoteFeed(currentTargetGroup);
};

const updateVoteFeed = (targetGroup) => {
    currentTargetGroup = targetGroup;
    const body = document.getElementById("voteFeedBody");
    const header = document.getElementById("feedHeader");
    const btnContainer = document.getElementById("paginationContainer");
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
                allTodayVotes.push({ voter_id: vId, group: gName, option: typeof vData === 'object' ? vData.option : vData, timestamp: typeof vData === 'object' ? (vData.timestamp || todayStr) : todayStr, voter_name: typeof vData === 'object' ? vData.voter_name : undefined, photo_url: typeof vData === 'object' ? vData.photo_url : null });
            });
        });
        allTodayVotes.sort((a, b) => moment(b.timestamp).valueOf() - moment(a.timestamp).valueOf());
        
        if (currentFeedSearch || currentFeedOption || currentFeedRoute) {
            allTodayVotes = allTodayVotes.filter(vote => {
                const pass = getPassengerByJid(vote.voter_id);
                let fullName = vote.voter_name || (pass ? pass.name : "Ext");
                const routeAlias = groupAliases[vote.group] || vote.group;
                
                let matchesSearch = true;
                if (currentFeedSearch) {
                    matchesSearch = fullName.toLowerCase().includes(currentFeedSearch) ||
                       routeAlias.toLowerCase().includes(currentFeedSearch) ||
                       vote.option.toLowerCase().includes(currentFeedSearch);
                }
                
                let matchesOption = true;
                if (currentFeedOption) {
                    matchesOption = vote.option.toLowerCase() === currentFeedOption;
                }
                
                let matchesRoute = true;
                if (currentFeedRoute) {
                    matchesRoute = vote.group === currentFeedRoute;
                }
                
                return matchesSearch && matchesOption && matchesRoute;
            });
        }

        body.innerHTML = "";
        
        const totalItems = allTodayVotes.length;
        const totalPages = Math.ceil(totalItems / itemsPerPage);
        if (currentPage > totalPages && totalPages > 0) currentPage = totalPages;
        
        const startIndex = (currentPage - 1) * itemsPerPage;
        const visibleVotes = allTodayVotes.slice(startIndex, startIndex + itemsPerPage);
        
        if (visibleVotes.length === 0) {
            body.innerHTML = '<tr><td colspan="4" style="text-align: center; color: #555; padding: 30px;">Nenhum voto registrado hoje.</td></tr>';
            if (btnContainer) btnContainer.innerHTML = "";
        } else {
            visibleVotes.forEach(vote => {
                const pass = getPassengerByJid(vote.voter_id);
                const row = document.createElement("tr");
                row.className = "feed-row vote-row";

                let fullName = "Ext";
                if (vote.voter_name) fullName = vote.voter_name;
                else if (pass && pass.name) fullName = pass.name;
                const displayName = fullName;

                // Verifica destaques customizados via config
                const highlights = window.rankingHighlights || {};
                const userHighlight = highlights[displayName];
                
                let avatarClass = "user-avatar";
                let badgesHtml = "";

                if (userHighlight) {
                    // Aplicar CSS customizado na linha
                    if (userHighlight.customCss) {
                        row.style.cssText = userHighlight.customCss;
                    } else {
                        row.className = "feed-row vote-row row-highlight-generic";
                    }
                    
                    // Estilizar o avatar
                    if (userHighlight.animation === "glow") {
                        avatarClass += " avatar-highlight-dev";
                    } else {
                        avatarClass += " avatar-highlight-generic";
                    }
                    
                    // Normalizar a lista de badges (suporta badge único ou array badges, limite de 2)
                    let rawBadges = [];
                    if (userHighlight.badges && Array.isArray(userHighlight.badges)) {
                        rawBadges = userHighlight.badges.slice(0, 2);
                    } else if (userHighlight.badge) {
                        rawBadges = [userHighlight.badge];
                    }
                    
                    let badgesContent = "";
                    rawBadges.forEach(b => {
                        let badgeText = "";
                        let bColor = userHighlight.color || 'var(--accent)';
                        let bAnim = userHighlight.animation || "";
                        
                        if (typeof b === 'object' && b !== null) {
                            badgeText = b.text || "";
                            if (b.color) bColor = b.color;
                            if (b.animation) bAnim = b.animation;
                        } else {
                            badgeText = String(b);
                        }
                        
                        if (!badgeText) return;
                        
                        let animClass = "";
                        if (bAnim === "glow") {
                            animClass = "user-badge-dev";
                        } else if (bAnim === "pulse") {
                            animClass = "user-badge-generic";
                        } else {
                            animClass = "user-badge-special";
                        }
                        
                        let iconHtml = "";
                        if (badgeText.toLowerCase().includes("dev") || badgeText.toLowerCase().includes("desenvolvedor")) {
                            iconHtml = '<i data-lucide="code-2" style="width:10px;height:10px;margin-right:2px;display:inline-block;vertical-align:middle;"></i>';
                        } else if (badgeText.toLowerCase().includes("friend") || badgeText.toLowerCase().includes("amigo")) {
                            iconHtml = '<i data-lucide="heart" style="width:10px;height:10px;margin-right:2px;display:inline-block;vertical-align:middle;"></i>';
                        }
                        
                        const badgeStyle = `background: ${bColor};`;
                        badgesContent += '<span class="user-badge-special ' + animClass + '" style="' + badgeStyle + '">' + iconHtml + badgeText + '</span>';
                    });
                    
                    if (badgesContent) {
                        badgesHtml = '<div class="user-badges">' + badgesContent + '</div>';
                    }
                }

                const timeStr = vote.timestamp ? moment(vote.timestamp).tz("America/Sao_Paulo").format("HH:mm") : "--:--";
                const maskedPhone = formatPhone(vote.voter_id.split('@')[0]);
                
                const photo = vote.photo_url || (pass && pass.photo_url) || "https://ui-avatars.com/api/?name=" + encodeURIComponent(displayName) + "&background=333&color=fff";
                const routeAlias = groupAliases[vote.group] || vote.group;
                let optClass = "tag-vote";
                if (vote.option.includes("não retornarei")) optClass = "tag-one-way";
                if (vote.option.includes("Não irei")) optClass = "tag-absence";
                if (vote.option.includes("apenas retornarei")) optClass = "tag-waiting";
                row.innerHTML = `<td class="timestamp-cell">${timeStr}</td><td><div class="user-cell"><img src="${photo}" class="${avatarClass}" onerror="this.src='https://ui-avatars.com/api/?name=?'"><div class="user-info"><span class="user-name">${displayName}</span>${badgesHtml}</div></div></td><td><span class="tag tag-route">${routeAlias}</span></td><td><span class="tag ${optClass}">${vote.option}</span></td>`;
                body.appendChild(row);
            });
            
            const emptyRows = itemsPerPage - visibleVotes.length;
            if (emptyRows > 0 && totalPages > 1) {
                for (let i = 0; i < emptyRows; i++) {
                    const row = document.createElement("tr");
                    row.className = "feed-row";
                    row.style.opacity = "0";
                    row.style.pointerEvents = "none";
                    row.innerHTML = `<td class="timestamp-cell">&nbsp;</td><td><div class="user-cell"><div class="user-avatar"></div><span class="user-name">&nbsp;</span></div></td><td><span class="tag">&nbsp;</span></td><td><span class="tag">&nbsp;</span></td>`;
                    body.appendChild(row);
                }
            }
            
            if (btnContainer) {
                if (totalPages <= 1) {
                    btnContainer.innerHTML = '';
                } else {
                    let html = '';
                    html += `<button class="btn-page" onclick="goToPage(${currentPage - 1})" ${currentPage === 1 ? 'disabled' : ''}><i data-lucide="chevron-left"></i></button>`;
                    html += `<span class="pagination-info">Página ${currentPage} de ${totalPages}</span>`;
                    html += `<button class="btn-page" onclick="goToPage(${currentPage + 1})" ${currentPage === totalPages ? 'disabled' : ''}><i data-lucide="chevron-right"></i></button>`;
                    btnContainer.innerHTML = html;
                    if (window.lucide) window.lucide.createIcons();
                }
            }
        }
    } else {
        if (btnContainer) btnContainer.innerHTML = "";
        const votersToday = [];
        Object.keys(dayEntry.grupos).forEach(gName => { Object.keys(dayEntry.grupos[gName].votes).forEach(vId => votersToday.push(vId)); });
        const tGroup = (targetGroup === "Todos") ? null : targetGroup;
        let pendingUsers = passengers.filter(p => { if (tGroup && p.group_name !== tGroup) return false; return !votersToday.includes(p.jid); });
        
        if (currentFeedSearch) {
            pendingUsers = pendingUsers.filter(p => {
                const routeAlias = groupAliases[p.group_name] || p.group_name;
                return p.name.toLowerCase().includes(currentFeedSearch) ||
                       routeAlias.toLowerCase().includes(currentFeedSearch) ||
                       "pendente".includes(currentFeedSearch);
            });
        }

        body.innerHTML = "";
        if (pendingUsers.length === 0) {
            body.innerHTML = '<tr><td colspan="3" style="text-align: center; color: #4caf50; padding: 30px;">✅ Todos os passageiros votaram hoje!</td></tr>';
        } else {
            pendingUsers.forEach(user => {
                const row = document.createElement("tr");
                row.className = "feed-row pending-row";

                const displayName = user.name;

                // Verifica destaques customizados via config
                const highlights = window.rankingHighlights || {};
                const userHighlight = highlights[displayName];
                
                let avatarClass = "user-avatar";
                let badgesHtml = "";

                if (userHighlight) {
                    // Aplicar CSS customizado na linha
                    if (userHighlight.customCss) {
                        row.style.cssText = userHighlight.customCss;
                    } else {
                        row.className = "feed-row pending-row row-highlight-generic";
                    }
                    
                    // Estilizar o avatar
                    if (userHighlight.animation === "glow") {
                        avatarClass += " avatar-highlight-dev";
                    } else {
                        avatarClass += " avatar-highlight-generic";
                    }
                    
                    // Normalizar a lista de badges (suporta badge único ou array badges, limite de 2)
                    let rawBadges = [];
                    if (userHighlight.badges && Array.isArray(userHighlight.badges)) {
                        rawBadges = userHighlight.badges.slice(0, 2);
                    } else if (userHighlight.badge) {
                        rawBadges = [userHighlight.badge];
                    }
                    
                    let badgesContent = "";
                    rawBadges.forEach(b => {
                        let badgeText = "";
                        let bColor = userHighlight.color || 'var(--accent)';
                        let bAnim = userHighlight.animation || "";
                        
                        if (typeof b === 'object' && b !== null) {
                            badgeText = b.text || "";
                            if (b.color) bColor = b.color;
                            if (b.animation) bAnim = b.animation;
                        } else {
                            badgeText = String(b);
                        }
                        
                        if (!badgeText) return;
                        
                        let animClass = "";
                        if (bAnim === "glow") {
                            animClass = "user-badge-dev";
                        } else if (bAnim === "pulse") {
                            animClass = "user-badge-generic";
                        } else {
                            animClass = "user-badge-special";
                        }
                        
                        let iconHtml = "";
                        if (badgeText.toLowerCase().includes("dev") || badgeText.toLowerCase().includes("desenvolvedor")) {
                            iconHtml = '<i data-lucide="code-2" style="width:10px;height:10px;margin-right:2px;display:inline-block;vertical-align:middle;"></i>';
                        } else if (badgeText.toLowerCase().includes("friend") || badgeText.toLowerCase().includes("amigo")) {
                            iconHtml = '<i data-lucide="heart" style="width:10px;height:10px;margin-right:2px;display:inline-block;vertical-align:middle;"></i>';
                        }
                        
                        const badgeStyle = `background: ${bColor};`;
                        badgesContent += '<span class="user-badge-special ' + animClass + '" style="' + badgeStyle + '">' + iconHtml + badgeText + '</span>';
                    });
                    
                    if (badgesContent) {
                        badgesHtml = '<div class="user-badges">' + badgesContent + '</div>';
                    }
                }

                const routeAlias = groupAliases[user.group_name] || user.group_name;
                const photo = user.photo_url || "https://ui-avatars.com/api/?name=" + encodeURIComponent(displayName) + "&background=333&color=fff";
                row.innerHTML = `<td><div class="user-cell"><img src="${photo}" class="${avatarClass}" onerror="this.src='https://ui-avatars.com/api/?name=?'"><div class="user-info"><span class="user-name">${displayName}</span>${badgesHtml}</div></div></td><td><span class="tag tag-route">${routeAlias}</span></td><td><span class="tag tag-pending">PENDENTE</span></td>`;
                body.appendChild(row);
            });
        }
    }
};
