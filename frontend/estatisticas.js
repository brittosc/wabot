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

const getTempTheme = (temp) => {
    if (temp <= 12) return { bg: 'rgba(0, 150, 255, 0.1)', text: '#74c0fc', border: 'rgba(0, 150, 255, 0.2)', icon: '#74c0fc' }; // Gelado
    if (temp <= 19) return { bg: 'rgba(33, 150, 243, 0.1)', text: '#64b5f6', border: 'rgba(33, 150, 243, 0.2)', icon: '#64b5f6' }; // Frio
    if (temp <= 26) return { bg: 'rgba(76, 175, 80, 0.1)', text: '#81c784', border: 'rgba(76, 175, 80, 0.2)', icon: '#81c784' }; // Agradável
    if (temp <= 32) return { bg: 'rgba(255, 152, 0, 0.1)', text: '#ffb74d', border: 'rgba(255, 152, 0, 0.2)', icon: '#ffb74d' }; // Quente
    return { bg: 'rgba(244, 67, 54, 0.1)', text: '#e57373', border: 'rgba(244, 67, 54, 0.2)', icon: '#e57373' }; // Muito Quente
};
window.getTempTheme = getTempTheme;

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

const formatName = (name) => {
    if (!name) return name;
    const prepositions = ['de', 'da', 'do', 'das', 'dos', 'e'];
    return name.toLowerCase().trim().split(/\s+/).map((word, index) => {
        if (prepositions.includes(word) && index > 0) {
            return word;
        }
        return word.charAt(0).toUpperCase() + word.slice(1);
    }).join(' ');
};
window.formatName = formatName;

const normalizeSearch = (str) => {
    if (!str) return "";
    return str.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
};
window.normalizeSearch = normalizeSearch;

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

const populateGroupSelect = () => {
    const gSelect = document.getElementById("groupSelect");
    const rSelect = document.getElementById("filterRouteSelect");
    const rkSelect = document.getElementById("rankingRouteSelect");
    const currentVal = gSelect ? gSelect.value : "Todos";
    const currentRouteVal = rSelect ? rSelect.value : "";
    const currentRankingRouteVal = rkSelect ? rkSelect.value : "Todos";
    
    if (gSelect) gSelect.innerHTML = '<option value="Todos">Todos os Grupos</option>';
    if (rSelect) rSelect.innerHTML = '<option value="">Todas as Rotas</option>';
    if (rkSelect) rkSelect.innerHTML = '<option value="Todos">Todas as Rotas</option>';
    
    extractGroups().forEach(g => {
        if (gSelect) {
            const opt = document.createElement("option");
            opt.value = g;
            opt.textContent = groupAliases[g] || g;
            gSelect.appendChild(opt);
        }
        
        if (rSelect) {
            const optR = document.createElement("option");
            optR.value = g;
            optR.textContent = groupAliases[g] || g;
            rSelect.appendChild(optR);
        }

        if (rkSelect) {
            const optRk = document.createElement("option");
            optRk.value = g;
            optRk.textContent = groupAliases[g] || g;
            rkSelect.appendChild(optRk);
        }
    });
    
    if (gSelect && gSelect.querySelector(`option[value="${currentVal}"]`)) {
        gSelect.value = currentVal;
    }
    if (rSelect && rSelect.querySelector(`option[value="${currentRouteVal}"]`)) {
        rSelect.value = currentRouteVal;
    }
    if (rkSelect && rkSelect.querySelector(`option[value="${currentRankingRouteVal}"]`)) {
        rkSelect.value = currentRankingRouteVal;
    }
};

const initSelects = () => {
    populateGroupSelect();
    const gSelect = document.getElementById("groupSelect");
    gSelect.addEventListener("change", updateDash);
    document.getElementById("periodSelect").addEventListener("change", updateDash);

    document.getElementById("copyrightYear").innerText = new Date().getFullYear();
};
window.initSelects = initSelects;
window.populateGroupSelect = populateGroupSelect;

window.handlePeriodChange = (val) => {
    const customContainer = document.getElementById("customRangeContainer");
    if (customContainer) {
        customContainer.style.display = val === "custom" ? "flex" : "none";
    }
    updateDash();
};

const updateChartsOnly = () => {
    const grp = document.getElementById("groupSelect").value;
    const per = document.getElementById("periodSelect").value;
    processData(grp, per);
};

// Helper para atualizar badge de tendência
const updateTrendBadge = (id, current, baseline, inverse = false) => {
    const el = document.getElementById(id);
    if (!el) return;
    if (!baseline || baseline === 0) { el.innerHTML = ""; return; }
    const diff = ((current - baseline) / baseline) * 100;
    const absDiff = Math.abs(diff).toFixed(0);
    let trend = diff > 1 ? "up" : diff < -1 ? "down" : "neutral";
    
    let colorClass = "trend-neutral";
    let icon = "minus";

    if (trend === "up") {
        colorClass = inverse ? "trend-down" : "trend-up";
        icon = "arrow-up";
    } else if (trend === "down") {
        colorClass = inverse ? "trend-up" : "trend-down";
        icon = "arrow-down";
    }

    el.className = `trend-badge ${colorClass}`;
    el.innerHTML = `<i data-lucide="${icon}" style="width: 12px; height: 12px;"></i> ${absDiff}%`;
};

const processData = (targetGroup, targetPeriod) => {
    const today = moment().tz("America/Sao_Paulo").startOf('day');
    let startMoment, endMoment;

    if (targetPeriod === "today") {
        startMoment = today.clone();
        endMoment = today.clone();
    } else if (targetPeriod === "yesterday") {
        startMoment = today.clone().subtract(1, 'day');
        endMoment = today.clone().subtract(1, 'day');
    } else if (targetPeriod === "this_month") {
        startMoment = today.clone().startOf('month');
        endMoment = today.clone();
    } else if (targetPeriod === "custom") {
        const s = document.getElementById("customStartDate").value;
        const e = document.getElementById("customEndDate").value;
        startMoment = s ? moment(s).startOf('day') : today.clone();
        endMoment = e ? moment(e).startOf('day') : today.clone();
    } else {
        const days = parseInt(targetPeriod, 10) || 7;
        startMoment = today.clone().subtract(days - 1, 'days');
        endMoment = today.clone();
    }

    const totalDaysCount = endMoment.diff(startMoment, 'days') + 1;
    const labelPeriod = targetPeriod === "custom" ? `${startMoment.format('DD/MM')} - ${endMoment.format('DD/MM')}` : targetPeriod;

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

    let totalPresenceVotes = 0;
    let daysWithData = 0;

    // Cálculo da base (últimos 7 dias) para contexto
    let baseStats = {
        totalVotes: 0,
        presence: 0,
        soIda: 0,
        soVolta: 0,
        ausencia: 0,
        idaVolta: 0,
        voteTimestamps: []
    };
    const baseDays = 7;

    for (let day = startMoment.clone(); day.isSameOrBefore(endMoment); day.add(1, 'day')) {
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

            const dayUniqueVoters = new Map();
            groupsToProcess.forEach(groupPayload => {
                if (!groupPayload.votes) return;
                Object.entries(groupPayload.votes).forEach(([jid, vData]) => {
                    const opt = typeof vData === 'object' ? vData.option : vData;
                    const ts = typeof vData === 'object' ? vData.timestamp : null;
                    if (!dayUniqueVoters.has(jid)) {
                        dayUniqueVoters.set(jid, { opt, ts });
                    }
                });
            });

            let dailyPresence = 0;
            dayUniqueVoters.forEach((vData) => {
                const opt = vData.opt;
                dayTotal++;
                if (globalOptionCounts[opt] !== undefined) globalOptionCounts[opt]++;
                if (dayCounts[opt] !== undefined) dayCounts[opt]++;
                if (vData.ts) voteTimestamps.push(moment(vData.ts));

                if (opt === "Irei, ida e volta." || opt === "Irei, mas não retornarei." || opt === "Não irei, apenas retornarei.") {
                    dailyPresence++;
                }

                // Dados para o baseline de 7 dias (contexto para tendências)
                const daysFromEnd = endMoment.diff(day, 'days');
                if (daysFromEnd < baseDays) {
                    baseStats.totalVotes++;
                    if (opt === "Irei, ida e volta." || opt === "Irei, mas não retornarei." || opt === "Não irei, apenas retornarei.") {
                        baseStats.presence++;
                    }
                    if (opt === "Irei, mas não retornarei.") baseStats.soIda++;
                    if (opt === "Não irei, apenas retornarei.") baseStats.soVolta++;
                    if (opt === "Não irei à faculdade hoje.") baseStats.ausencia++;
                    if (opt === "Irei, ida e volta.") baseStats.idaVolta++;
                    if (vData.ts) baseStats.voteTimestamps.push(moment(vData.ts));
                }
            });

            if (dailyPresence > 0) {
                totalPresenceVotes += dailyPresence;
                daysWithData++;
                const dow = day.day();
                weekdayPresence[dow].presence += dailyPresence;
                weekdayPresence[dow].days++;
            }
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
    }

    const avgPresence = daysWithData > 0 ? totalPresenceVotes / daysWithData : 0;
    document.getElementById("lblAverage").innerText = avgPresence.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

    const baselineDivisor = baseDays;
    const bAvgPresence = baseStats.presence / baselineDivisor;
    const bAvgTotalVotes = baseStats.totalVotes / baselineDivisor;
    const bAvgSoIda = baseStats.soIda / baselineDivisor;
    const bAvgSoVolta = baseStats.soVolta / baselineDivisor;
    const bAvgAusencia = baseStats.ausencia / baselineDivisor;
    const bAvgIdaVolta = baseStats.idaVolta / baselineDivisor;

    updateTrendBadge("lblAverageTrend", avgPresence, bAvgPresence);
    updateTrendBadge("lblTotalVotesTrend", accumTotalVotes / totalDaysCount, bAvgTotalVotes);

    updateTrendBadge("hlLotacaoTrend", peakLotacao.val, bAvgIdaVolta);
    updateTrendBadge("hlLotacaoMinTrend", valleyLotacao.val, bAvgIdaVolta);
    updateTrendBadge("hlAusenciaTrend", peakAusencia.val, bAvgAusencia, true);
    updateTrendBadge("hlAusenciaMinTrend", valleyAusencia.val, bAvgAusencia, true);
    updateTrendBadge("hlSoIdaTrend", peakSoIda.val, bAvgSoIda);
    updateTrendBadge("hlSoIdaMinTrend", valleySoIda.val, bAvgSoIda);
    updateTrendBadge("hlSoVoltaTrend", peakSoVolta.val, bAvgSoVolta);
    updateTrendBadge("hlSoVoltaMinTrend", valleySoVolta.val, bAvgSoVolta);

    // Destaques de dias da semana
    let peakWeekday = { val: -1, day: "" }, valleyWeekday = { val: Infinity, day: "" };
    Object.keys(weekdayPresence).forEach(d => {
        const wp = weekdayPresence[d];
        if (wp.days > 0) {
            const avg = wp.presence / wp.days;
            if (avg > peakWeekday.val) { peakWeekday.val = avg; peakWeekday.day = daysOfWeekBR[d]; }
            if (avg < valleyWeekday.val) { valleyWeekday.val = avg; valleyWeekday.day = daysOfWeekBR[d]; }
        }
    });

    const setWkHighlight = (valId, dateId, obj) => {
        const vEl = document.getElementById(valId);
        const dEl = document.getElementById(dateId);
        if (vEl && dEl) {
            if (obj.val !== -1 && obj.val !== Infinity) {
                vEl.innerText = obj.day;
                dEl.innerText = "Média: " + obj.val.toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + " presenças";
            } else {
                vEl.innerText = "-";
                dEl.innerText = "Sem dados";
            }
        }
    };
    setWkHighlight("hlWeekdayPeakVal", "hlWeekdayPeakDate", peakWeekday);
    setWkHighlight("hlWeekdayValleyVal", "hlWeekdayValleyDate", valleyWeekday);

    document.getElementById("lblTotalVotes").innerText = accumTotalVotes.toLocaleString('pt-BR');
    const totalTitle = document.getElementById("lblTotalVotesTitle");
    if (totalTitle) totalTitle.innerText = "Total Votos (" + labelPeriod + ")";
    
    const currentAvgTime = calculateAverageInterval(voteTimestamps);
    const baselineAvgTime = calculateAverageInterval(baseStats.voteTimestamps);
    updateTrendBadge("lblAvgVoteTimeTrend", currentAvgTime, baselineAvgTime, true);

    const timeLabel = document.getElementById("lblAvgVoteTime");
    if (timeLabel) {
        if (currentAvgTime > 0) {
            timeLabel.innerText = currentAvgTime < 60 ? Math.round(currentAvgTime) + "s" : Math.round(currentAvgTime / 60) + "m " + Math.round(currentAvgTime % 60) + "s";
        } else {
            timeLabel.innerText = "--";
        }
    }

    updateHourHighlights(voteTimestamps);
    if (typeof lucide !== 'undefined') lucide.createIcons();

    const setTitle = (id, txt) => { const el = document.getElementById(id); if (el) el.innerText = txt; };
    setTitle("titlePieChart", "Consolidado Geral (" + labelPeriod + ")");
    setTitle("titleBarChart", "Votos por Dia (" + labelPeriod + ")");
    setTitle("titleStackedBarChart", "Proporção Diária (" + labelPeriod + ")");

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

    const diffPercent = bAvgPresence > 0 ? ((avgPresence - bAvgPresence) / bAvgPresence) * 100 : 0;
    
    // Expor dados para outros scripts (insights, etc)
    window.lastProcessedStats = {
        avgPresence,
        bAvgPresence,
        diffPercent,
        peakWeekday,
        valleyWeekday,
        peakHour: document.getElementById("hlPeakHour")?.innerText || "--",
        accumTotalVotes,
        totalDaysCount
    };

    updateCapacityCard(targetGroup);
    updateNextPollsCalendar();
    updateVoteFeed(targetGroup);
    if (typeof renderHeatmap === "function") renderHeatmap(targetGroup);
    if (typeof renderPrediction === "function") renderPrediction(targetGroup);
    if (typeof updateGroupMilestones === "function") updateGroupMilestones(targetGroup);
    if (typeof renderInsights === "function") renderInsights(targetGroup);
    if (typeof updateRanking === "function") updateRanking(targetGroup, targetPeriod);
    renderCharts(barLabels, barData, globalOptionCounts, stackedData);
};
window.processData = processData;

const calculateAverageInterval = (timestamps) => {
    if (!timestamps || timestamps.length < 2) return 0;
    
    const tsCopy = [...timestamps].sort((a, b) => a.valueOf() - b.valueOf());
    let totalDiff = 0, count = 0;
    for (let i = 1; i < tsCopy.length; i++) {
        const diff = tsCopy[i].diff(tsCopy[i - 1], 'seconds');
        if (diff > 0 && diff < 7200) { totalDiff += diff; count++; }
    }
    if (count === 0) return 0;
    return totalDiff / count;
};

const updateHourHighlights = (timestamps) => {
    const peakEl = document.getElementById("hlPeakHour");
    const peakCountEl = document.getElementById("hlPeakHourCount");
    const calmEl = document.getElementById("hlCalmHour");
    const calmCountEl = document.getElementById("hlCalmHourCount");
    if (!peakEl || !calmEl) return;
    if (!timestamps || timestamps.length === 0) { peakEl.innerText = "--"; calmEl.innerText = "--"; return; }

    const hourCounts = {};
    const activeDaysSet = new Set();
    
    timestamps.forEach(ts => {
        const m = moment(ts).tz("America/Sao_Paulo");
        const h = m.hour();
        activeDaysSet.add(m.format("YYYY-MM-DD"));
        hourCounts[h] = (hourCounts[h] || 0) + 1;
    });

    const hours = Object.entries(hourCounts).sort((a, b) => b[1] - a[1]);
    if (hours.length === 0) return;
    
    const divisor = activeDaysSet.size > 0 ? activeDaysSet.size : 1;

    const fmt = (h) => {
        const hInt = parseInt(h);
        const nextH = (hInt + 1) % 24;
        return String(hInt).padStart(2, '0') + ":00 a " + String(nextH).padStart(2, '0') + ":00";
    };
    peakEl.innerText = fmt(hours[0][0]);
    if (peakCountEl) peakCountEl.innerText = Math.round(hours[0][1] / divisor) + " votos/dia";
    calmEl.innerText = fmt(hours[hours.length - 1][0]);
    if (calmCountEl) calmCountEl.innerText = Math.round(hours[hours.length - 1][1] / divisor) + " votos/dia";
};


