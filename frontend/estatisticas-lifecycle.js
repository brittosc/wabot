// Ciclo de vida: calendário, notificações, fetch, boot

const updateDash = () => {
    const grp = document.getElementById("groupSelect").value;
    const per = document.getElementById("periodSelect").value;
    processData(grp, per);
    updateNextPollsCalendar(per);
};
window.updateDash = updateDash;

let notificationAudio = null;
const playNotificationSound = () => {
    try {
        if (!notificationAudio) {
            notificationAudio = new Audio("/notifications/sound.mp3");
        }
        notificationAudio.volume = 1.0;
        notificationAudio.currentTime = 0; // Reinicia o som se já estiver tocando
        notificationAudio.play().catch(e => {
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
    const parsed = parseInt(limitDays, 10);
    if (!isNaN(parsed) && parsed > 7) {
        displayLimit = Math.min(30, parsed);
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

            let statusHtml = '<div class="status-badge status-rascunho">Agendada</div>';
            if (dayWeather) {
                const icon = getWeatherIcon(dayWeather.condition_code);
                const theme = getTempTheme(dayWeather.max);
                statusHtml = `
                    <div class="status-weather-badge" style="background: ${theme.bg}; color: ${theme.text}; border-color: ${theme.border};">
                        <span>Agendada</span>
                        <i data-lucide="${icon}" class="weather-icon" style="color: ${theme.icon};"></i>
                        <div style="display:flex; align-items:center; gap:3px;">
                            <span class="temp-max">${dayWeather.max}°</span>
                            <span class="temp-separator">/</span>
                            <span class="temp-min">${dayWeather.min}°</span>
                        </div>
                    </div>
                `;
            }

            row.innerHTML = `
                <div class="calendar-box"><i data-lucide="calendar" class="cal-icon"></i><div class="cal-date">${dateDisplay}</div></div>
                <div class="poll-info"><div class="poll-title">${['Domingo','Segunda-feira','Terça-feira','Quarta-feira','Quinta-feira','Sexta-feira','Sábado'][current.day()]}</div><div class="poll-subtitle">Semana ${weekNum} • ${pollTime}</div></div>
                ${statusHtml}
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
        const res = await fetch(BACKEND_URL + '/api/stats');
        if (res.ok) {
            const data = await res.json();
            if (JSON.stringify(rawDB) !== JSON.stringify(data.votes) || isPollSentToday !== data.isPollSentToday || JSON.stringify(weatherForecast) !== JSON.stringify(data.weather) || JSON.stringify(passengers) !== JSON.stringify(data.passengers)) {
                
                const votesChanged = JSON.stringify(rawDB) !== JSON.stringify(data.votes);
                const oldVoteCount = countTotalVotes(rawDB);
                
                rawDB = data.votes || {};
                passengers = data.passengers || [];
                pollHistory = data.pollHistory || [];
                isPollSentToday = !!data.isPollSentToday;
                capacities = data.capacities || {};
                window.groupAliases = data.aliases || {};
                groupAliases = window.groupAliases;
                skipDates = data.skipDates || {};
                weatherForecast = data.weather || [];
                
                if (window.populateGroupSelect) {
                    window.populateGroupSelect();
                }

                updateDash();

                if (votesChanged && oldVoteCount > 0) {
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
