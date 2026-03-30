// Renderização dos gráficos Chart.js

const hexToRgba = (hex, alpha) => {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return "rgba(" + r + ", " + g + ", " + b + ", " + alpha + ")";
};

const renderCharts = (barLabels, barData, pieCountsMap, stackedData) => {
    const selectedType = document.getElementById("chartTypeSelect").value;
    const isLine = selectedType === 'line';

    const pieLabels = Object.keys(pieCountsMap);
    const pieData = Object.values(pieCountsMap);
    const pieColors = pieLabels.map(l => optionColors[l] || "#9e9e9e");

    Chart.defaults.color = 'rgba(255, 255, 255, 0.7)';
    Chart.defaults.borderColor = 'rgba(255, 255, 255, 0.1)';
    Chart.defaults.font.family = "'Inter', sans-serif";

    if (pieChartIns) pieChartIns.destroy();
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

    if (barChartIns) barChartIns.destroy();
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
            scales: {
                y: { beginAtZero: true, grid: { drawTicks: false }, border: { display: false } },
                x: { grid: { display: false }, border: { display: false } }
            },
            plugins: { legend: { display: false } }
        }
    });

    if (stackedChartIns) stackedChartIns.destroy();
    const stackedCtx = document.getElementById('stackedBarChart').getContext('2d');

    const makeGradient = (color) => (context) => {
        const chart = context.chart;
        const { ctx, chartArea } = chart;
        if (!chartArea) return null;
        const gradient = ctx.createLinearGradient(0, chartArea.top, 0, chartArea.bottom);
        gradient.addColorStop(0, hexToRgba(color, 0.5));
        gradient.addColorStop(1, hexToRgba(color, 0));
        return gradient;
    };

    const datasets = [
        { label: 'Só Volta', data: stackedData["Não irei, apenas retornarei."], backgroundColor: isLine ? makeGradient(optionColors["Não irei, apenas retornarei."]) : optionColors["Não irei, apenas retornarei."], borderColor: optionColors["Não irei, apenas retornarei."], fill: isLine, tension: isLine ? 0.4 : 0, pointRadius: isLine ? 2 : 0, borderWidth: isLine ? 2 : 1 },
        { label: 'Só Ida', data: stackedData["Irei, mas não retornarei."], backgroundColor: isLine ? makeGradient(optionColors["Irei, mas não retornarei."]) : optionColors["Irei, mas não retornarei."], borderColor: optionColors["Irei, mas não retornarei."], fill: isLine, tension: isLine ? 0.4 : 0, pointRadius: isLine ? 2 : 0, borderWidth: isLine ? 2 : 1 },
        { label: 'Ausente', data: stackedData["Não irei à faculdade hoje."], backgroundColor: isLine ? makeGradient(optionColors["Não irei à faculdade hoje."]) : optionColors["Não irei à faculdade hoje."], borderColor: optionColors["Não irei à faculdade hoje."], fill: isLine, tension: isLine ? 0.4 : 0, pointRadius: isLine ? 2 : 0, borderWidth: isLine ? 2 : 1 },
        { label: 'Ida e Volta', data: stackedData["Irei, ida e volta."], backgroundColor: isLine ? makeGradient(optionColors["Irei, ida e volta."]) : optionColors["Irei, ida e volta."], borderColor: optionColors["Irei, ida e volta."], fill: isLine, tension: isLine ? 0.4 : 0, pointRadius: isLine ? 2 : 0, borderWidth: isLine ? 2 : 1 }
    ];

    stackedChartIns = new Chart(stackedCtx, {
        type: isLine ? 'line' : selectedType,
        data: { labels: barLabels, datasets: datasets },
        options: {
            responsive: true, maintainAspectRatio: false,
            interaction: { mode: 'index', intersect: false },
            scales: {
                x: { display: !['radar', 'polarArea'].includes(selectedType), stacked: selectedType === 'bar' },
                y: { display: !['radar', 'polarArea'].includes(selectedType), stacked: selectedType === 'bar', beginAtZero: true, grace: '10%' },
                r: { display: ['radar', 'polarArea'].includes(selectedType), ticks: { display: false }, grid: { color: 'rgba(255, 255, 255, 0.05)' }, angleLines: { color: 'rgba(255, 255, 255, 0.1)' } }
            },
            plugins: {
                legend: { position: 'bottom', labels: { boxWidth: 10, padding: 8, font: { size: window.innerWidth < 400 ? 8 : (window.innerWidth < 600 ? 9 : 12) } } },
                tooltip: { mode: 'index', intersect: false }
            }
        }
    });
};
