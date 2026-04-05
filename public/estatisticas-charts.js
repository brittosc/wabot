// Renderização dos gráficos Chart.js

const hexToRgba = (hex, alpha) => {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return "rgba(" + r + ", " + g + ", " + b + ", " + alpha + ")";
};

const CHART_ANIMATION = { duration: 3000, easing: 'easeInOutQuart' };

const makeGradient = (color) => (context) => {
    const chart = context.chart;
    const { ctx, chartArea } = chart;
    if (!chartArea) return null;
    const gradient = ctx.createLinearGradient(0, chartArea.top, 0, chartArea.bottom);
    gradient.addColorStop(0, hexToRgba(color, 0.5));
    gradient.addColorStop(1, hexToRgba(color, 0));
    return gradient;
};

Chart.register(ChartDataLabels);

// Variável para guardar a referência do timeout
let chartTimer;

const safeDestroyCanvasChart = (id) => {
    const existingChart = Chart.getChart(id);
    if (existingChart) existingChart.destroy();
    
    const canvas = document.getElementById(id);
    if (canvas && canvas.parentNode) {
        const newCanvas = document.createElement('canvas');
        newCanvas.id = id;
        canvas.parentNode.replaceChild(newCanvas, canvas);
    }
};

const renderCharts = (barLabels, barData, pieCountsMap, stackedData) => {
    const pieLabels = Object.keys(pieCountsMap);
    const pieData = Object.values(pieCountsMap);
    const pieColors = pieLabels.map(l => optionColors[l] || "#9e9e9e");

    const stackedKeys = [
        "Não irei, apenas retornarei.",
        "Irei, mas não retornarei.",
        "Não irei à faculdade hoje.",
        "Irei, ida e volta."
    ];
    const stackedLabels = ['Só Volta', 'Só Ida', 'Ausente', 'Ida e Volta'];

    Chart.defaults.color = 'rgba(255, 255, 255, 0.7)';
    Chart.defaults.borderColor = 'rgba(255, 255, 255, 0.1)';
    Chart.defaults.font.family = "'Inter', sans-serif";

    if (chartTimer) clearTimeout(chartTimer);

    // Timeout agrupa render para evitar picos de UI blocking
    chartTimer = setTimeout(() => {
        // Pie Chart
        if (pieChartIns) {
            const dataArr = pieChartIns.data.datasets[0].data;
            for (let i = 0; i < pieData.length; i++) dataArr[i] = pieData[i];
            dataArr.length = pieData.length;
            pieChartIns.update();
        } else {
            const ctxPie = document.getElementById('pieChart').getContext('2d');
            pieChartIns = new Chart(ctxPie, {
                type: 'doughnut',
                data: {
                    labels: pieLabels,
                    datasets: [{ data: pieData, backgroundColor: pieColors, borderWidth: 0, hoverOffset: 15 }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    animation: { animateRotate: true, animateScale: true, ...CHART_ANIMATION },
                    cutout: '70%',
                    plugins: {
                        legend: { position: 'bottom', labels: { boxWidth: 12, usePointStyle: true, padding: 20, font: { size: 11, weight: 600 } } },
                        datalabels: {
                            display: true,
                            color: '#fff', anchor: 'center', align: 'center', offset: 0,
                            font: { weight: '800', size: 12 },
                            formatter: (value, ctx) => {
                                let sum = 0;
                                const dSet = ctx.chart.data.datasets[0].data;
                                if (!dSet || !dSet.length) return "";
                                dSet.forEach(d => { sum += d; });
                                const pct = sum > 0 ? (value * 100 / sum) : 0;
                                return pct >= 5 ? pct.toFixed(0) + "%" : "";
                            }
                        }
                    }
                }
            });
        }

        // Bar Chart
        if (barChartIns) {
            barChartIns.data.labels = barLabels;
            const dataArr = barChartIns.data.datasets[0].data;
            for (let i = 0; i < barData.length; i++) dataArr[i] = barData[i];
            dataArr.length = barData.length;
            barChartIns.update();
        } else {
            const ctxBar = document.getElementById('barChart').getContext('2d');
            barChartIns = new Chart(ctxBar, {
                type: 'line',
                data: {
                    labels: barLabels,
                    datasets: [{
                        label: 'Votos', data: barData, borderColor: '#2196f3',
                        backgroundColor: (context) => {
                            const { ctx, chartArea } = context.chart;
                            if (!chartArea) return null;
                            const g = ctx.createLinearGradient(0, chartArea.top, 0, chartArea.bottom);
                            g.addColorStop(0, 'rgba(33, 150, 243, 0.3)');
                            g.addColorStop(1, 'rgba(33, 150, 243, 0)');
                            return g;
                        },
                        borderWidth: 3, fill: true, tension: 0.4,
                        pointRadius: 4, pointBackgroundColor: '#2196f3', pointBorderColor: '#fff', pointBorderWidth: 2
                    }]
                },
                options: {
                    responsive: true, maintainAspectRatio: false,
                    animation: { ...CHART_ANIMATION },
                    scales: {
                        y: { beginAtZero: true, grid: { drawTicks: false }, border: { display: false } },
                        x: { grid: { display: false }, border: { display: false } }
                    },
                    plugins: { 
                        legend: { display: false },
                        datalabels: { display: false }
                    }
                }
            });
        }

        // Stacked Chart
        if (stackedChartIns) {
            stackedChartIns.data.labels = barLabels;
            stackedChartIns.data.datasets.forEach((ds, i) => {
                const srcData = stackedData[stackedKeys[i]];
                const dsData = ds.data;
                for (let j = 0; j < srcData.length; j++) dsData[j] = srcData[j];
                dsData.length = srcData.length;
            });
            stackedChartIns.update();
        } else {
            const datasets = stackedKeys.map((key, i) => ({
                label: stackedLabels[i],
                data: stackedData[key],
                backgroundColor: makeGradient(optionColors[key]),
                borderColor: optionColors[key],
                fill: true, tension: 0.4, pointRadius: 2, borderWidth: 2
            }));

            const ctxStacked = document.getElementById('stackedBarChart').getContext('2d');
            stackedChartIns = new Chart(ctxStacked, {
                type: 'line',
                data: { labels: barLabels, datasets: datasets },
                options: {
                    responsive: true, maintainAspectRatio: false,
                    animation: { ...CHART_ANIMATION },
                    interaction: { mode: 'index', intersect: false },
                    scales: {
                        x: { display: true },
                        y: { display: true, beginAtZero: true, grace: '10%' }
                    },
                    plugins: {
                        legend: { position: 'bottom', labels: { boxWidth: 10, padding: 8, font: { size: window.innerWidth < 400 ? 8 : (window.innerWidth < 600 ? 9 : 12) } } },
                        tooltip: { mode: 'index', intersect: false },
                        datalabels: { display: false }
                    }
                }
            });
        }
    }, 50);
};
