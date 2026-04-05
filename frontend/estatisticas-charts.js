// Renderização dos gráficos Chart.js

const hexToRgba = (hex, alpha) => {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return "rgba(" + r + ", " + g + ", " + b + ", " + alpha + ")";
};

const CHART_ANIMATION = { duration: 1500, easing: 'easeInOutQuart' };

const makeGradient = (color) => (context) => {
    const chart = context.chart;
    const { ctx, chartArea } = chart;
    if (!chartArea) return null;
    const gradient = ctx.createLinearGradient(0, chartArea.top, 0, chartArea.bottom);
    gradient.addColorStop(0, hexToRgba(color, 0.5));
    gradient.addColorStop(1, hexToRgba(color, 0));
    return gradient;
};

const renderCharts = (barLabels, barData, pieCountsMap, stackedData) => {
    const pieLabels = Object.keys(pieCountsMap);
    const pieData = Object.values(pieCountsMap);
    const pieColors = pieLabels.map(l => optionColors[l] || "#9e9e9e");

    Chart.defaults.color = 'rgba(255, 255, 255, 0.7)';
    Chart.defaults.borderColor = 'rgba(255, 255, 255, 0.1)';
    Chart.defaults.font.family = "'Inter', sans-serif";

    // --- Pie / Doughnut ---
    if (pieChartIns) {
        pieChartIns.data.labels = pieLabels;
        pieChartIns.data.datasets[0].data = pieData;
        pieChartIns.data.datasets[0].backgroundColor = pieColors;
        pieChartIns.update();
    } else {
        const pieCtx = document.getElementById('pieChart').getContext('2d');
        pieChartIns = new Chart(pieCtx, {
            type: 'doughnut',
            data: {
                labels: pieLabels,
                datasets: [{ data: pieData, backgroundColor: pieColors, borderWidth: 0, hoverOffset: 15 }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                animation: CHART_ANIMATION,
                cutout: '70%',
                plugins: {
                    legend: { position: 'bottom', labels: { boxWidth: 12, usePointStyle: true, padding: 20, font: { size: 11, weight: 600 } } },
                    datalabels: {
                        color: '#fff', anchor: 'center', align: 'center', offset: 0,
                        font: { weight: '800', size: 12 },
                        formatter: (value, ctx) => {
                            let sum = 0;
                            ctx.chart.data.datasets[0].data.map(data => { sum += data; });
                            let pctValue = (value * 100 / sum);
                            return pctValue >= 5 ? pctValue.toFixed(0) + "%" : "";
                        }
                    }
                }
            },
            plugins: [ChartDataLabels]
        });
    }

    // --- Bar (line) de votos por dia ---
    if (barChartIns) {
        barChartIns.data.labels = barLabels;
        barChartIns.data.datasets[0].data = barData;
        barChartIns.update();
    } else {
        const barCtx = document.getElementById('barChart').getContext('2d');
        barChartIns = new Chart(barCtx, {
            type: 'line',
            data: {
                labels: barLabels,
                datasets: [{
                    label: 'Votos', data: barData, borderColor: '#2196f3',
                    backgroundColor: (context) => {
                        const chart = context.chart;
                        const { ctx, chartArea } = chart;
                        if (!chartArea) return null;
                        const gradient = ctx.createLinearGradient(0, chartArea.top, 0, chartArea.bottom);
                        gradient.addColorStop(0, 'rgba(33, 150, 243, 0.3)');
                        gradient.addColorStop(1, 'rgba(33, 150, 243, 0)');
                        return gradient;
                    },
                    borderWidth: 3, fill: true, tension: 0.4,
                    pointRadius: 4, pointBackgroundColor: '#2196f3', pointBorderColor: '#fff', pointBorderWidth: 2
                }]
            },
            options: {
                responsive: true, maintainAspectRatio: false,
                animation: CHART_ANIMATION,
                scales: {
                    y: { beginAtZero: true, grid: { drawTicks: false }, border: { display: false } },
                    x: { grid: { display: false }, border: { display: false } }
                },
                plugins: { legend: { display: false } }
            }
        });
    }

    // --- Stacked / Proporção Diária ---
    const stackedKeys = [
        "Não irei, apenas retornarei.",
        "Irei, mas não retornarei.",
        "Não irei à faculdade hoje.",
        "Irei, ida e volta."
    ];
    const stackedLabels = ['Só Volta', 'Só Ida', 'Ausente', 'Ida e Volta'];

    if (stackedChartIns) {
        stackedChartIns.data.labels = barLabels;
        stackedKeys.forEach((key, i) => {
            stackedChartIns.data.datasets[i].data = stackedData[key];
        });
        stackedChartIns.update();
    } else {
        const stackedCtx = document.getElementById('stackedBarChart').getContext('2d');
        const datasets = stackedKeys.map((key, i) => ({
            label: stackedLabels[i],
            data: stackedData[key],
            backgroundColor: makeGradient(optionColors[key]),
            borderColor: optionColors[key],
            fill: true, tension: 0.4, pointRadius: 2, borderWidth: 2
        }));

        stackedChartIns = new Chart(stackedCtx, {
            type: 'line',
            data: { labels: barLabels, datasets: datasets },
            options: {
                responsive: true, maintainAspectRatio: false,
                animation: CHART_ANIMATION,
                interaction: { mode: 'index', intersect: false },
                scales: {
                    x: { display: true },
                    y: { display: true, beginAtZero: true, grace: '10%' }
                },
                plugins: {
                    legend: { position: 'bottom', labels: { boxWidth: 10, padding: 8, font: { size: window.innerWidth < 400 ? 8 : (window.innerWidth < 600 ? 9 : 12) } } },
                    tooltip: { mode: 'index', intersect: false }
                }
            }
        });
    }
};
