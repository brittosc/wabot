// Ciclo de vida: calendário, notificações, fetch, boot

const updateDash = () => {
    const grp = document.getElementById("groupSelect").value;
    const per = document.getElementById("periodSelect").value;
    processData(grp, per);
    updateNextPollsCalendar(per);
};

const initNotification = () => {
    if (!("Notification" in window)) return;
    if (Notification.permission === "default") {
        Notification.requestPermission().then(permission => {
            if (permission === "granted") {
                notificationEnabled = true;
                new Notification("Dashboard", { body: "Notificações ativadas com sucesso!" });
            }
        });
    } else if (Notification.permission === "granted") {
        notificationEnabled = true;
    }
};

const updateNextPollsCalendar = (limitDays = 7) => {
    const list = document.getElementById("nextPollsList");
    if (!list) return;
    list.innerHTML = "";

    const displayLimit = Math.min(30, parseInt(limitDays, 10));
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
            const icon = getWeatherIcon(dayWeather.condition);
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
                <div class="poll-info"><div class="poll-title">Enquete de Frequência</div><div class="poll-subtitle">Semana ${weekNum} • ${pollTime}</div></div>
                ${weatherHtml}
                <div class="status-badge status-agendada">Agendada</div>
            `;
        }

        list.appendChild(row);
        current.add(1, 'days');
    }

    if (window.lucide) { lucide.createIcons(); }
};

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
            if (JSON.stringify(rawDB) !== JSON.stringify(data.votes) || isPollSentToday !== data.isPollSentToday || JSON.stringify(weatherForecast) !== JSON.stringify(data.weather)) {
                rawDB = data.votes || {};
                isPollSentToday = !!data.isPollSentToday;
                capacities = data.capacities || {};
                groupAliases = data.aliases || {};
                skipDates = data.skipDates || {};
                weatherForecast = data.weather || [];
                updateDash();

                const now = new Date();
                const weatherUpdateStr = data.weatherLastUpdate ? ' | Clima: ' + new Date(data.weatherLastUpdate).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '';
                document.getElementById('lblLastUpdate').innerText = now.toLocaleDateString('pt-BR') + ' ' + now.toLocaleTimeString('pt-BR') + weatherUpdateStr;
            }
        }
    } catch (err) {
        console.error('Erro no Auto-Refresh:', err);
    }
};

// Boot
initSelects();
initNotification();

window.addEventListener('load', () => {
    updateDash();
    fetchStats();
});

if (document.readyState === 'complete') {
    updateDash();
    fetchStats();
}

setInterval(fetchStats, 10000);
