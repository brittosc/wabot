// Estado e variáveis globais (rawDB, passengers etc. injetados via bloco inline no HTML)

const getWeatherIcon = (code) => {
    if (code === 0) return 'sun';
    if ([1, 2, 3].includes(code)) return 'cloud-sun';
    if ([45, 48].includes(code)) return 'cloud-fog';
    if ([51, 53, 55, 61, 63, 65, 80, 81, 82].includes(code)) return 'cloud-rain';
    if ([95, 96, 99].includes(code)) return 'cloud-lightning';
    if ([71, 73, 75, 77, 85, 86].includes(code)) return 'snowflake';
    return 'cloud';
};

let lastNotifiedCount = {};
let notificationEnabled = false;

let currentFeedTab = 'votes';
let feedLimit = 10;
let currentTargetGroup = "Todos";

const optionColors = {
    "Irei, ida e volta.": "#4caf50",
    "Irei, mas não retornarei.": "#2196f3",
    "Não irei, apenas retornarei.": "#ff9800",
    "Não irei à faculdade hoje.": "#f44336"
};

let pieChartIns = null;
let barChartIns = null;
let stackedChartIns = null;

const normalizePhone = (p) => {
    if (!p) return "";
    let digits = p.replace(/\D/g, "");
    if (digits.length === 11 && digits.startsWith("0")) digits = digits.substring(1);
    if (digits.length <= 11) digits = "55" + digits;
    return digits;
};

const getPassengerByJid = (jid) => {
    if (!jid) return null;
    const jidDigits = jid.split('@')[0];

    let found = passengers.find(p => normalizePhone(p.phone) === jidDigits);

    if (!found && jidDigits.length === 13 && jidDigits.startsWith("55")) {
        const withoutNine = jidDigits.substring(0, 4) + jidDigits.substring(5);
        found = passengers.find(p => normalizePhone(p.phone) === withoutNine);
    }
    if (!found && jidDigits.length === 12 && jidDigits.startsWith("55")) {
        const withNine = jidDigits.substring(0, 4) + "9" + jidDigits.substring(4);
        found = passengers.find(p => normalizePhone(p.phone) === withNine);
    }

    return found;
};

const extractGroups = () => {
    const groups = new Set();
    Object.values(rawDB).forEach(dayData => {
        if (dayData.Version2 && dayData.grupos) {
            Object.keys(dayData.grupos).forEach(g => groups.add(g));
        } else {
            groups.add("Grupo Geral (Legado)");
        }
    });
    return Array.from(groups).sort();
};

const initSelects = () => {
    const gSelect = document.getElementById("groupSelect");
    extractGroups().forEach(g => {
        const opt = document.createElement("option");
        opt.value = g;
        opt.textContent = groupAliases[g] || g;
        gSelect.appendChild(opt);
    });

    gSelect.addEventListener("change", updateDash);
    document.getElementById("periodSelect").addEventListener("change", updateDash);
    document.getElementById("chartTypeSelect").addEventListener("change", updateChartsOnly);

    document.getElementById("copyrightYear").innerText = new Date().getFullYear();
};

const updateChartsOnly = () => {
    const grp = document.getElementById("groupSelect").value;
    const per = document.getElementById("periodSelect").value;
    processData(grp, per);
};

const processData = (targetGroup, targetDaysStr) => {
    const targetDays = parseInt(targetDaysStr, 10);
    const todayMoment = moment().startOf('day');

    let barLabels = [];
    let barData = [];
    let stackedData = {
        "Irei, ida e volta.": [],
        "Irei, mas não retornarei.": [],
        "Não irei, apenas retornarei.": [],
        "Não irei à faculdade hoje.": []
    };
    let globalOptionCounts = {
        "Irei, ida e volta.": 0,
        "Irei, mas não retornarei.": 0,
        "Não irei, apenas retornarei.": 0,
        "Não irei à faculdade hoje.": 0
    };
    let accumTotalVotes = 0;
    let weekdayPresence = {
        0: { presence: 0, absence: 0, days: 0 }, 1: { presence: 0, absence: 0, days: 0 },
        2: { presence: 0, absence: 0, days: 0 }, 3: { presence: 0, absence: 0, days: 0 },
        4: { presence: 0, absence: 0, days: 0 }, 5: { presence: 0, absence: 0, days: 0 },
        6: { presence: 0, absence: 0, days: 0 }
    };
    let peakLotacao = { val: -1, date: "" }, valleyLotacao = { val: Infinity, date: "" };
    let peakAusencia = { val: -1, date: "" }, valleyAusencia = { val: Infinity, date: "" };
    let peakSoIda = { val: -1, date: "" }, valleySoIda = { val: Infinity, date: "" };
    let peakSoVolta = { val: -1, date: "" }, valleySoVolta = { val: Infinity, date: "" };
    const daysOfWeekBR = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];
    let voteTimestamps = [];

    for (let i = targetDays - 1; i >= 0; i--) {
        const day = todayMoment.clone().subtract(i, 'days');
        const dateStr = day.format('YYYY-MM-DD');
        const displayDate = day.format('DD/MM');
        barLabels.push(displayDate);
        let dayTotal = 0;
        let dayCounts = {
            "Irei, ida e volta.": 0, "Irei, mas não retornarei.": 0,
            "Não irei, apenas retornarei.": 0, "Não irei à faculdade hoje.": 0
        };

        if (rawDB[dateStr]) {
            const dayEntry = rawDB[dateStr];
            let groupsToProcess = [];
            if (dayEntry.Version2 && dayEntry.grupos) {
                if (targetGroup === "Todos") groupsToProcess = Object.values(dayEntry.grupos);
                else if (dayEntry.grupos[targetGroup]) groupsToProcess = [dayEntry.grupos[targetGroup]];
            } else if (!dayEntry.Version2) {
                if (targetGroup === "Todos" || targetGroup === "Grupo Geral (Legado)") groupsToProcess = [dayEntry];
            }

            groupsToProcess.forEach(groupPayload => {
                if (!groupPayload.votes) return;
                const voters = Object.keys(groupPayload.votes);
                dayTotal += voters.length;
                voters.forEach(v => {
                    const vData = groupPayload.votes[v];
                    const opt = typeof vData === 'object' ? vData.option : vData;
                    if (globalOptionCounts[opt] !== undefined) globalOptionCounts[opt]++;
                    else globalOptionCounts[opt] = 1;
                    if (dayCounts[opt] !== undefined) dayCounts[opt]++;
                    if (typeof vData === 'object' && vData.timestamp) voteTimestamps.push(moment(vData.timestamp));
                });
            });
        }

        const updatePeak = (val, peak, valley, date, total) => {
            if (val > peak.val) { peak.val = val; peak.date = date; }
            if (val < valley.val && total > 0) { valley.val = val; valley.date = date; }
        };
        updatePeak(dayCounts["Irei, ida e volta."], peakLotacao, valleyLotacao, displayDate, dayTotal);
        updatePeak(dayCounts["Não irei à faculdade hoje."], peakAusencia, valleyAusencia, displayDate, dayTotal);
        updatePeak(dayCounts["Irei, mas não retornarei."], peakSoIda, valleySoIda, displayDate, dayTotal);
        updatePeak(dayCounts["Não irei, apenas retornarei."], peakSoVolta, valleySoVolta, displayDate, dayTotal);

        Object.keys(stackedData).forEach(k => stackedData[k].push(dayCounts[k]));
        barData.push(dayTotal);
        accumTotalVotes += dayTotal;

        if (dayTotal > 0) {
            const dow = day.day();
            weekdayPresence[dow].presence += dayCounts["Irei, ida e volta."] + dayCounts["Irei, mas não retornarei."] + dayCounts["Não irei, apenas retornarei."];
            weekdayPresence[dow].absence += dayCounts["Não irei à faculdade hoje."];
            weekdayPresence[dow].days += 1;
        }
    }

    let bestDay = { dow: -1, avg: -1 }, worstDay = { dow: -1, avg: -1 };
    for (let d = 1; d <= 5; d++) {
        if (weekdayPresence[d].days > 0) {
            const avgPresence = weekdayPresence[d].presence / weekdayPresence[d].days;
            const avgAbsence = weekdayPresence[d].absence / weekdayPresence[d].days;
            if (avgPresence > bestDay.avg) bestDay = { dow: d, avg: avgPresence };
            if (avgAbsence > worstDay.avg) worstDay = { dow: d, avg: avgAbsence };
        }
    }

    if (bestDay.dow !== -1) { document.getElementById("hlWeekdayPeakVal").innerText = daysOfWeekBR[bestDay.dow]; document.getElementById("hlWeekdayPeakDate").innerText = ""; }
    if (worstDay.dow !== -1) { document.getElementById("hlWeekdayValleyVal").innerText = daysOfWeekBR[worstDay.dow]; document.getElementById("hlWeekdayValleyDate").innerText = ""; }

    document.getElementById("lblTotalVotes").innerText = accumTotalVotes.toLocaleString('pt-BR');
    const totalTitle = document.getElementById("lblTotalVotesTitle");
    if (totalTitle) totalTitle.innerText = "Total Votos (" + targetDaysStr + " dias)";
    calculateAverageInterval(voteTimestamps);
    updateHourHighlights(voteTimestamps);

    const setTitle = (id, txt) => { const el = document.getElementById(id); if (el) el.innerText = txt; };
    setTitle("titlePieChart", "Consolidado Geral (" + targetDaysStr + " dias)");
    setTitle("titleBarChart", "Votos por Dia (" + targetDaysStr + " dias)");
    setTitle("titleStackedBarChart", "Proporção Diária (" + targetDaysStr + " dias)");

    const setHighlight = (valId, dateId, peakObj) => {
        const valEl = document.getElementById(valId);
        const dateEl = document.getElementById(dateId);
        if (peakObj.val !== -1 && peakObj.val !== Infinity) {
            valEl.innerText = peakObj.val.toLocaleString('pt-BR');
            dateEl.innerText = peakObj.date;
        } else { valEl.innerText = "0"; dateEl.innerText = "Sem dados"; }
    };
    setHighlight("hlLotacaoVal", "hlLotacaoDate", peakLotacao);
    setHighlight("hlLotacaoMinVal", "hlLotacaoMinDate", valleyLotacao);
    setHighlight("hlAusenciaVal", "hlAusenciaDate", peakAusencia);
    setHighlight("hlAusenciaMinVal", "hlAusenciaMinDate", valleyAusencia);
    setHighlight("hlSoIdaVal", "hlSoIdaDate", peakSoIda);
    setHighlight("hlSoIdaMinVal", "hlSoIdaMinDate", valleySoIda);
    setHighlight("hlSoVoltaVal", "hlSoVoltaDate", peakSoVolta);
    setHighlight("hlSoVoltaMinVal", "hlSoVoltaMinDate", valleySoVolta);
    document.getElementById("lblAverage").innerText = (accumTotalVotes / targetDays).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

    updateCapacityCard(targetGroup);
    updateNextPollsCalendar();
    updateVoteFeed(targetGroup);
    renderCharts(barLabels, barData, globalOptionCounts, stackedData);
};

const calculateAverageInterval = (timestamps) => {
    const label = document.getElementById("lblAvgVoteTime");
    if (!timestamps || timestamps.length < 2) { label.innerText = "--"; return; }
    timestamps.sort((a, b) => a.valueOf() - b.valueOf());
    let totalDiff = 0, count = 0;
    for (let i = 1; i < timestamps.length; i++) {
        const diff = timestamps[i].diff(timestamps[i - 1], 'seconds');
        if (diff > 0 && diff < 7200) { totalDiff += diff; count++; }
    }
    if (count === 0) { label.innerText = "--"; return; }
    const avgSeconds = totalDiff / count;
    label.innerText = avgSeconds < 60 ? Math.round(avgSeconds) + "s" : Math.round(avgSeconds / 60) + "m " + Math.round(avgSeconds % 60) + "s";
};

const updateHourHighlights = (timestamps) => {
    const peakEl = document.getElementById("hlPeakHour");
    const peakCountEl = document.getElementById("hlPeakHourCount");
    const calmEl = document.getElementById("hlCalmHour");
    const calmCountEl = document.getElementById("hlCalmHourCount");
    if (!peakEl || !calmEl) return;
    if (!timestamps || timestamps.length === 0) { peakEl.innerText = "--"; calmEl.innerText = "--"; return; }

    const hourCounts = {};
    timestamps.forEach(ts => {
        const h = moment(ts).tz("America/Sao_Paulo").hour();
        hourCounts[h] = (hourCounts[h] || 0) + 1;
    });

    const hours = Object.entries(hourCounts).sort((a, b) => b[1] - a[1]);
    if (hours.length === 0) return;

    const fmt = (h) => {
        const hInt = parseInt(h);
        const nextH = (hInt + 1) % 24;
        return String(hInt).padStart(2, '0') + ":00 a " + String(nextH).padStart(2, '0') + ":00";
    };
    peakEl.innerText = fmt(hours[0][0]);
    if (peakCountEl) peakCountEl.innerText = hours[0][1] + " votos";
    calmEl.innerText = fmt(hours[hours.length - 1][0]);
    if (calmCountEl) calmCountEl.innerText = hours[hours.length - 1][1] + " votos";
};


