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

    Chart.defaults.color = 'rgba(255, 255, 255, 0.85)';
    Chart.defaults.borderColor = 'rgba(255, 255, 255, 0.12)';
    Chart.defaults.font.family = "'Inter', sans-serif";

    if (chartTimer) clearTimeout(chartTimer);

    // Timeout agrupa render para evitar picos de UI blocking
    chartTimer = setTimeout(() => {
        // Pie Chart
        if (pieChartIns) {
            const dataArr = pieChartIns.data.datasets[0].data;
            for (let i = 0; i < pieData.length; i++) dataArr[i] = pieData[i];
            dataArr.length = pieData.length;
            pieChartIns.reset(); // Força a animação de entrada novamente
            pieChartIns.update();
        } else {
            const ctxPie = document.getElementById('pieChart').getContext('2d');
            pieChartIns = new Chart(ctxPie, {
                type: 'pie',
                data: {
                    labels: pieLabels,
                    datasets: [{ data: pieData, backgroundColor: pieColors, borderWidth: 0, hoverOffset: 15 }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    animation: { animateRotate: true, animateScale: true, ...CHART_ANIMATION },
                    plugins: {
                        legend: { position: 'bottom', labels: { boxWidth: 12, usePointStyle: true, padding: 20, font: { size: 11, weight: 600 } } },
                        datalabels: { display: false }
                    }
                }
            });
        }

        // Calculando valores dinâmicos reutilizáveis para os gráficos
        const avgValue = barData.length > 0 ? Math.round(barData.reduce((a, b) => a + b, 0) / barData.length) : 0;
        const avgArray = Array(barLabels.length).fill(avgValue);
        
        let capValue = 0;
        const targetGroup = window.currentTargetGroup || "Todos";
        if (window.capacities) {
            if (targetGroup === "Todos") {
                capValue = Object.values(window.capacities).reduce((a, b) => a + b, 0);
            } else {
                capValue = window.capacities[targetGroup] || 0;
            }
        }
        const capArray = Array(barLabels.length).fill(capValue);

        // Bar Chart
        if (barChartIns) {
            barChartIns.data.labels = barLabels;
            
            // Atualiza datasets
            barChartIns.data.datasets[0].data = barData;
            
            if (barChartIns.data.datasets[1]) {
                barChartIns.data.datasets[1].data = avgArray;
                barChartIns.data.datasets[1].label = `Média (${avgValue} votos)`;
            }
            if (barChartIns.data.datasets[2]) {
                barChartIns.data.datasets[2].data = capArray;
                barChartIns.data.datasets[2].label = `Capacidade (${capValue} vagas)`;
            }
            
            barChartIns.reset(); // Força a animação de entrada novamente
            barChartIns.update();
        } else {
            const ctxBar = document.getElementById('barChart').getContext('2d');
            barChartIns = new Chart(ctxBar, {
                type: 'line',
                data: {
                    labels: barLabels,
                    datasets: [
                        {
                            label: 'Votos Realizados', data: barData, borderColor: '#2196f3',
                            backgroundColor: (context) => {
                                const { ctx, chartArea } = context.chart;
                                if (!chartArea) return null;
                                const g = ctx.createLinearGradient(0, chartArea.top, 0, chartArea.bottom);
                                g.addColorStop(0, 'rgba(33, 150, 243, 0.25)');
                                g.addColorStop(1, 'rgba(33, 150, 243, 0)');
                                return g;
                            },
                            borderWidth: 3, fill: true, tension: 0.4,
                            pointRadius: 4, pointBackgroundColor: '#2196f3', pointBorderColor: '#fff', pointBorderWidth: 2
                        },
                        {
                            label: `Média (${avgValue} votos)`,
                            data: avgArray,
                            borderColor: 'rgba(255, 193, 7, 0.75)',
                            borderWidth: 2,
                            borderDash: [5, 5],
                            fill: false,
                            pointRadius: 0,
                            pointHitRadius: 0,
                            hoverRadius: 0
                        },
                        {
                            label: `Capacidade (${capValue} vagas)`,
                            data: capArray,
                            borderColor: 'rgba(244, 67, 54, 0.75)',
                            borderWidth: 2,
                            borderDash: [3, 3],
                            fill: false,
                            pointRadius: 0,
                            pointHitRadius: 0,
                            hoverRadius: 0
                        }
                    ]
                },
                options: {
                    responsive: true, maintainAspectRatio: false,
                    animation: { ...CHART_ANIMATION },
                    scales: {
                        y: { beginAtZero: true, grid: { drawTicks: false }, border: { display: false } },
                        x: { grid: { display: false }, border: { display: false } }
                    },
                    plugins: { 
                        legend: { 
                            display: true,
                            position: 'top',
                            labels: {
                                boxWidth: 12,
                                padding: 15,
                                usePointStyle: true,
                                font: { size: 10, weight: 600 }
                            }
                        },
                        datalabels: { display: false }
                    }
                }
            });
        }

        // Stacked Chart
        if (stackedChartIns) {
            stackedChartIns.data.labels = barLabels;
            
            // Se por algum motivo só tiver os 4 datasets originais, adicionamos os novos de forma dinâmica
            if (stackedChartIns.data.datasets.length === 4) {
                stackedChartIns.data.datasets.push({
                    label: `Média (${avgValue} votos)`,
                    data: avgArray,
                    borderColor: 'rgba(255, 193, 7, 0.75)',
                    borderWidth: 2,
                    borderDash: [5, 5],
                    fill: false,
                    pointRadius: 0,
                    pointHitRadius: 0,
                    hoverRadius: 0
                });
                stackedChartIns.data.datasets.push({
                    label: `Capacidade (${capValue} vagas)`,
                    data: capArray,
                    borderColor: 'rgba(244, 67, 54, 0.75)',
                    borderWidth: 2,
                    borderDash: [3, 3],
                    fill: false,
                    pointRadius: 0,
                    pointHitRadius: 0,
                    hoverRadius: 0
                });
            }

            stackedChartIns.data.datasets.forEach((ds, i) => {
                if (i < 4) {
                    const srcData = stackedData[stackedKeys[i]];
                    const dsData = ds.data;
                    for (let j = 0; j < srcData.length; j++) dsData[j] = srcData[j];
                    dsData.length = srcData.length;
                } else if (i === 4) {
                    ds.data = avgArray;
                    ds.label = `Média (${avgValue} votos)`;
                } else if (i === 5) {
                    ds.data = capArray;
                    ds.label = `Capacidade (${capValue} vagas)`;
                }
            });
            stackedChartIns.reset(); // Força a animação de entrada novamente
            stackedChartIns.update();
        } else {
            const datasets = stackedKeys.map((key, i) => ({
                label: stackedLabels[i],
                data: stackedData[key],
                backgroundColor: makeGradient(optionColors[key]),
                borderColor: optionColors[key],
                fill: true, tension: 0.4, pointRadius: 2, borderWidth: 2
            }));

            // Adiciona Média
            datasets.push({
                label: `Média (${avgValue} votos)`,
                data: avgArray,
                borderColor: 'rgba(255, 193, 7, 0.75)',
                borderWidth: 2,
                borderDash: [5, 5],
                fill: false,
                pointRadius: 0,
                pointHitRadius: 0,
                hoverRadius: 0
            });

            // Adiciona Capacidade
            datasets.push({
                label: `Capacidade (${capValue} vagas)`,
                data: capArray,
                borderColor: 'rgba(244, 67, 54, 0.75)',
                borderWidth: 2,
                borderDash: [3, 3],
                fill: false,
                pointRadius: 0,
                pointHitRadius: 0,
                hoverRadius: 0
            });

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
