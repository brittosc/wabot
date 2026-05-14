
const renderInsights = (targetGroup) => {
    const elList = document.getElementById("insightsList");
    if (!elList) return;

    const insights = [];
    const stats = window.lastProcessedStats; // Vou definir isso no estatisticas.js
    if (!stats) return;

    // 1. Insight de Melhor Dia da Semana
    if (stats.peakWeekday && stats.peakWeekday.val > 0) {
        insights.push({
            icon: "calendar",
            text: `A <b>${stats.peakWeekday.day}</b> apresenta a maior taxa média de presença (${stats.peakWeekday.val.toFixed(1)} alunos).`,
            color: "#4caf50"
        });
    }

    // 2. Insight de Horário de Pico
    if (stats.peakHour && stats.peakHour !== "--") {
        insights.push({
            icon: "clock",
            text: `O maior volume de respostas costuma ocorrer entre <b>${stats.peakHour}</b>.`,
            color: "#2196f3"
        });
    }

    // 3. Insight de Comparação de Rota (se em "Todos")
    if (targetGroup === "Todos") {
        let bestRoute = "";
        let maxV = -1;
        Object.keys(capacities).forEach(r => {
            // Simplificado: buscar no rawDB do último dia com dados
            // Mas vamos usar uma lógica mais robusta baseada na média
            // (Para este MVP, vamos focar nos globais)
        });
    }

    // 4. Insight de Tendência Geral
    const diffPercent = stats.diffPercent;
    if (Math.abs(diffPercent) > 5) {
        const direction = diffPercent > 0 ? "aumento" : "queda";
        const color = diffPercent > 0 ? "#4caf50" : "#f44336";
        insights.push({
            icon: diffPercent > 0 ? "trending-up" : "trending-down",
            text: `Houve um <b>${direction} de ${Math.abs(diffPercent).toFixed(0)}%</b> na participação em relação à semana anterior.`,
            color: color
        });
    }

    // 5. Insight de Consistência (Streak)
    // Pegar o top streak do ranking se disponível
    // (Pendente: integrar com o ranking global)

    // Renderizar
    elList.innerHTML = insights.map(ins => `
        <div style="display: flex; align-items: flex-start; gap: 12px; font-size: 0.9rem; color: rgba(255,255,255,0.8); line-height: 1.4;">
            <div style="color: ${ins.color}; margin-top: 2px;">
                <i data-lucide="${ins.icon}" style="width: 14px; height: 14px;"></i>
            </div>
            <div>${ins.text}</div>
        </div>
    `).join('');

    if (window.lucide) window.lucide.createIcons();
};

window.renderInsights = renderInsights;
