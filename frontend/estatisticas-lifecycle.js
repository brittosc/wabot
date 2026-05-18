// Ciclo de vida: calendário, notificações, fetch, boot

const updateDash = () => {
    const grp = document.getElementById("groupSelect").value;
    const per = document.getElementById("periodSelect").value;
    processData(grp, per);
    updateNextPollsCalendar(per);
};
window.updateDash = updateDash;

const playNotificationSound = () => {
    try {
        // Som de notificação curto e suave
        const audio = new Audio("https://cdn.pixabay.com/audio/2022/03/15/audio_507663249f.mp3");
        audio.volume = 0.5;
        audio.play().catch(e => {
            console.warn("Notificação sonora bloqueada pelo navegador. Interaja com a página primeiro.");
        });
    } catch (e) {}
};
window.playNotificationSound = playNotificationSound;

const updateNextPollsCalendar = (limitDays = 7) => {
    const list = document.getElementById("nextPollsList");
    if (!list) return;
    list.innerHTML = "";

    let displayLimit = 7;
    if (typeof limitDays === 'string' && limitDays.includes('_')) {
        // Trata "this_month" ou outros períodos especiais como padrão 7
        displayLimit = 7;
    } else {
        const parsed = parseInt(limitDays, 10);
        if (!isNaN(parsed) && parsed > 7) {
            displayLimit = Math.min(30, parsed);
        }
    }
    const now = moment();
    let current = moment();
    const timeParts = pollTime.split(':');
    current.set({ hour: parseInt(timeParts[0]), minute: parseInt(timeParts[1]), second: 0 });

    if (current.isBefore(now)) { current.add(1, 'days'); }

    for (let i = 0; i < displayLimit; i++) {
        const dayOfWeek = current.day();
        const isWeekend = (dayOfWeek === 0 || dayOfWeek === 6);
        const brDate = current.format('DD/MM/YYYY');
        const currentDayMonth = current.format('DD/MM');
        const skipReason = skipDates[brDate];

        let reason = "";
        if (isWeekend) reason = "Fim de Semana";
        else if (skipReason) reason = skipReason;

        const row = document.createElement("div");
        row.className = "poll-item";

        const dateDisplay = current.format('DD MMM');
        const weekNum = current.isoWeek();

        const dayWeather = weatherForecast.find(f => f.date === currentDayMonth);
        let weatherHtml = "";
        if (dayWeather) {
            const icon = getWeatherIcon(dayWeather.condition_code);
            weatherHtml = `<div class="weather-tag"><i data-lucide="${icon}" class="weather-icon"></i><span class="temp-val">${dayWeather.max}°</span><span style="opacity: 0.5">/</span><span>${dayWeather.min}°</span></div>`;
        }

        if (reason) {
            row.innerHTML = `
                <div class="calendar-box" style="opacity: 0.5;"><i data-lucide="calendar-x" class="cal-icon"></i><div class="cal-date">${dateDisplay}</div></div>
                <div class="poll-info" style="opacity: 0.5;"><div class="poll-title">Indisponível</div><div class="poll-subtitle">${reason}</div></div>
                <div class="status-badge status-bloqueada">Offline</div>
            `;
        } else {
            const duration = moment.duration(current.diff(now));
            const d = Math.floor(duration.asDays());
            const h = duration.hours();
            const m = duration.minutes();

            row.innerHTML = `
                <div class="calendar-box"><i data-lucide="calendar" class="cal-icon"></i><div class="cal-date">${dateDisplay}</div></div>
                <div class="poll-info"><div class="poll-title">${['Domingo','Segunda-feira','Terça-feira','Quarta-feira','Quinta-feira','Sexta-feira','Sábado'][current.day()]}</div><div class="poll-subtitle">Semana ${weekNum} • ${pollTime}</div></div>
                ${weatherHtml}
                <div class="status-badge status-agendada">Agendada</div>
            `;
        }

        list.appendChild(row);
        current.add(1, 'days');
    }

    if (window.lucide) { lucide.createIcons(); }
};
window.updateNextPollsCalendar = updateNextPollsCalendar;

let lastDay = moment().format('YYYY-MM-DD');

const checkMidnightReset = () => {
    const currentDay = moment().format('YYYY-MM-DD');
    if (currentDay !== lastDay) {
        lastDay = currentDay;
        lastNotifiedCount = {};
        updateDash();
        fetchStats();
    }
};

const fetchStats = async () => {
    checkMidnightReset();
    try {
        const baseUrl = (window.BACKEND_URL || '').replace(/\/$/, '');
        const res = await fetch(`${baseUrl}/api/stats?t=${Date.now()}`);
        if (res.ok) {
            const text = await res.text();
            let data;
            try {
                data = JSON.parse(text);
            } catch (jsonErr) {
                console.warn("Auto-Refresh: Resposta do servidor não pôde ser interpretada como JSON (provavelmente fallback HTML ou bloqueio local). Ignorando atualização.");
                console.debug("Conteúdo recebido do servidor (primeiros 200 caracteres):", text.substring(0, 200));
                return;
            }
            
            // Sincroniza rankingHighlights e highlightNames da API com fallbacks locais estáticos ricos
            window.rankingHighlights = data.rankingHighlights || {
                "Mauricio de Britto": {
                    "badge": "Dev",
                    "color": "linear-gradient(135deg, #00f7ff, #0088ff)",
                    "animation": "glow",
                    "customCss": "background: rgba(12, 12, 12, 0.03) !important; border-left: 2px solid #00f7ff !important;"
                },
                "Duda Martins": {
                    "badge": "Friend",
                    "color": "linear-gradient(175deg, #00f7ff, #0088ff)",
                    "animation": "glow",
                    "customCss": "background: rgba(12, 12, 12, 0.03) !important; border-left: 2px solid #00f7ff !important;"
                },
                "Marcos Santos": {
                    "badge": "Friend",
                    "color": "linear-gradient(190deg, #00f7ff, #0088ff)",
                    "animation": "glow",
                    "customCss": "background: rgba(12, 12, 12, 0.03) !important; border-left: 2px solid #00f7ff !important;"
                }
            };
            window.highlightNames = data.highlightNames || ["Mauricio de Britto", "Duda Martins", "Marcos Santos"];

            if (JSON.stringify(rawDB) !== JSON.stringify(data.votes) || isPollSentToday !== data.isPollSentToday || JSON.stringify(weatherForecast) !== JSON.stringify(data.weather) || JSON.stringify(passengers) !== JSON.stringify(data.passengers)) {
                
                // Detecta se houve novos votos para tocar o som
                const oldVoteCount = countTotalVotes(rawDB);
                const newVoteCount = countTotalVotes(data.votes || {});
                
                window.rawDB = data.votes || {};
                window.passengers = data.passengers || [];
                window.isPollSentToday = !!data.isPollSentToday;
                window.capacities = data.capacities || {};
                window.groupAliases = data.aliases || {};
                window.skipDates = data.skipDates || {};
                window.weatherForecast = data.weather || [];
                window.pollTime = data.pollTime || '05:30';

                rawDB = window.rawDB;
                passengers = window.passengers;
                isPollSentToday = window.isPollSentToday;
                capacities = window.capacities;
                groupAliases = window.groupAliases;
                skipDates = window.skipDates;
                rankingHighlights = window.rankingHighlights;
                highlightNames = window.highlightNames;
                weatherForecast = window.weatherForecast;
                pollTime = window.pollTime;
                
                if (window.populateGroupSelect) {
                    window.populateGroupSelect();
                }

                updateDash();

                if (newVoteCount > oldVoteCount && oldVoteCount > 0) {
                    playNotificationSound();
                }

                const now = new Date();
                const weatherUpdateStr = data.weatherLastUpdate ? ' | Clima: ' + new Date(data.weatherLastUpdate).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '';
                document.getElementById('lblLastUpdate').innerText = now.toLocaleDateString('pt-BR') + ' ' + now.toLocaleTimeString('pt-BR') + weatherUpdateStr;
            }
        }
    } catch (err) {
        console.error('Erro no Auto-Refresh:', err);
    }
};

const countTotalVotes = (db) => {
    let count = 0;
    Object.values(db).forEach(day => {
        if (day.grupos) {
            Object.values(day.grupos).forEach(g => {
                if (g.votes) count += Object.keys(g.votes).length;
            });
        }
    });
    return count;
};

// Boot
// initNotification foi removido pois usaremos apenas som por enquanto para simplificar
// initSelects();
window.addEventListener('load', () => {
    if (window.initSelects) window.initSelects();
    updateDash();
    fetchStats();
});

setInterval(fetchStats, 10000);
