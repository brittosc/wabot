const fs = require('fs');
const moment = require('moment-timezone');
const { generateHtmlDashboard } = require('./statistics');

const statsFile = './statistics.json';

const readStats = () => {
    try {
        if (!fs.existsSync(statsFile)) return {};
        const data = fs.readFileSync(statsFile, 'utf8');
        return JSON.parse(data);
    } catch (e) {
        return {};
    }
};

const saveStats = (data) => {
    fs.writeFileSync(statsFile, JSON.stringify(data, null, 2));
};

const config = JSON.parse(fs.readFileSync('./config.json', 'utf8'));
const targetGroups = config.targetGroups || [];

const generateData = () => {
    // Resetando o JSON para evitar acumular dados a cada execução do script
    const stats = {};

    const today = moment().tz('America/Sao_Paulo');
    const options = [
        "Irei, ida e volta.",
        "Irei, mas não retornarei.",
        "Não irei, apenas retornarei.",
        "Não irei à faculdade hoje."
    ];

    // Gerar dados para os últimos 30 dias
    for (let i = 29; i >= 0; i--) {
        const day = today.clone().subtract(i, 'days');
        const dateStr = day.format('YYYY-MM-DD');

        if (!stats[dateStr]) {
            stats[dateStr] = {
                Version2: true,
                grupos: {}
            };
        }

        // Usar grupos reais da configuração
        targetGroups.forEach(groupName => {
            if (!stats[dateStr].grupos[groupName]) {
                stats[dateStr].grupos[groupName] = {
                    pollName: `Enquete do dia ${dateStr}`,
                    votes: {}
                };
            }

            // Gerar centenas de votos para cada dia (ex: 40 a 60 para ficar próximo das capacidades)
            const numVotes = Math.floor(Math.random() * 20) + 40;

            // Variar radicalmente as probabilidades a cada dia para que os picos não caiam na mesma data
            const isRainyDay = Math.random() < 0.15; // Dias com muita falta (15% chance)
            const isFridayLike = Math.random() < 0.20; // Dias com muita gente indo e não voltando (20%)
            const isReturnHeavy = Math.random() < 0.15; // Pessoas só voltando (15%)

            for (let v = 0; v < numVotes; v++) {
                const voterId = `fake_user_${v}_${Math.floor(Math.random() * 10000)}@c.us`;

                const rand = Math.random();
                let selectedOption;

                if (isRainyDay) {
                    if (rand < 0.6) selectedOption = options[3]; // 60% ausentes
                    else if (rand < 0.8) selectedOption = options[0]; // 20% ida e volta
                    else if (rand < 0.9) selectedOption = options[1];
                    else selectedOption = options[2];
                } else if (isFridayLike) {
                    if (rand < 0.5) selectedOption = options[1]; // 50% só ida
                    else if (rand < 0.8) selectedOption = options[0]; // 30% ida e volta
                    else if (rand < 0.9) selectedOption = options[3];
                    else selectedOption = options[2];
                } else if (isReturnHeavy) {
                    if (rand < 0.4) selectedOption = options[2]; // 40% só volta
                    else if (rand < 0.7) selectedOption = options[0]; // 30% ida e volta
                    else if (rand < 0.9) selectedOption = options[3];
                    else selectedOption = options[1];
                } else {
                    // Dia normal
                    if (rand < 0.6) selectedOption = options[0]; // 60% ida e volta
                    else if (rand < 0.75) selectedOption = options[1];
                    else if (rand < 0.9) selectedOption = options[2];
                    else selectedOption = options[3];
                }

                stats[dateStr].grupos[groupName].votes[voterId] = selectedOption;
            }
        });
    }

    saveStats(stats);
    console.log("Estatísticas falsas geradas (30 dias) e salvas em statistics.json.");

    generateHtmlDashboard(stats);
    console.log("estatisticas.html atualizado com os novos dados.");
};

generateData();
