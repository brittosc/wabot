const cron = require('node-cron');
const moment = require('moment-timezone');
const fs = require('fs');
const dashboard = require('./dashboard');

const historyFile = './history.json';
const configFile = './config.json';

const getDaysOfWeekDesc = (dayNumber) => {
    const days = [
        'domingo',
        'segunda-feira',
        'terça-feira',
        'quarta-feira',
        'quinta-feira',
        'sexta-feira',
        'sábado'
    ];
    return days[dayNumber];
};

const readJson = (file) => {
    try {
        if (!fs.existsSync(file)) return {};
        const data = fs.readFileSync(file, 'utf8');
        return JSON.parse(data);
    } catch (e) {
        return {};
    }
};

const saveJson = (file, data) => {
    fs.writeFileSync(file, JSON.stringify(data, null, 2));
};

const sendPolls = async (sock) => {
    try {
        const config = readJson(configFile);
        const history = readJson(historyFile);

        const now = moment().tz('America/Sao_Paulo');
        const todayStr = now.format('YYYY-MM-DD');
        const dayOfWeek = now.day();

        const ignoreWeekend = process.argv.includes('--fim');

        // 1-5 são segunda a sexta
        if ((dayOfWeek === 0 || dayOfWeek === 6) && !ignoreWeekend) {
            dashboard.addLog('Fim de semana. Nenhuma enquete programada para envio.');
            return;
        }

        if (history[todayStr]) {
            dashboard.addLog(`Enquete já enviada hoje (${todayStr}). Pulando...`);
            return;
        }

        dashboard.addLog('Iniciando o envio de enquetes...');

        // Pegar todos os chats
        const chats = await sock.getChats();
        const allGroups = chats.filter(c => c.isGroup);

        const targetGroupNames = config.targetGroups || [];
        let sentCount = 0;

        for (const targetName of targetGroupNames) {
            const group = allGroups.find(g => g.name === targetName);
            if (group) {
                const ptDay = getDaysOfWeekDesc(dayOfWeek);
                const dateStr = now.format('DD/MM');
                const pollName = `Bom dia, você vai hoje, ${ptDay}, ${dateStr}?`;

                try {
                    const { Poll } = require('whatsapp-web.js');
                    const poll = new Poll(pollName, [
                        "Sim!",
                        "Nao irei, apenas retornarei"
                    ], { allowMultipleAnswers: false });

                    await group.sendMessage(poll);

                    dashboard.addLog(`Enquete enviada para o grupo: ${targetName}`);
                    dashboard.incrementTotalSent();
                    sentCount++;
                } catch (sendErr) {
                    dashboard.addLog(`Erro ao enviar para o grupo ${targetName}: ${sendErr.message}`);
                }
            } else {
                dashboard.addLog(`Grupo não encontrado na lista: ${targetName}`);
            }
        }

        if (sentCount > 0) {
            history[todayStr] = true;
            saveJson(historyFile, history);
            dashboard.addLog(`Envios do dia ${todayStr} registrados com sucesso!`);
        } else {
            dashboard.addLog('Nenhuma enquete foi enviada (nenhum grupo válido encontrado).');
        }

    } catch (error) {
        dashboard.addLog(`Erro no cronJob: ${error.message}`);
    }
};

const scheduleJob = (sock) => {
    const config = readJson(configFile);
    const time = config.pollTime || "06:00"; // Default "06:00"
    const [hour, minute] = time.split(':');

    dashboard.addLog(`Agendamento configurado para ${time} (Horário de Brasília)`);

    // Run every minute and check if it matches the scheduled time
    cron.schedule('* * * * *', () => {
        const now = moment().tz('America/Sao_Paulo');

        // Calculate and update time until next poll
        // Calculate next poll info
        updateNextPollDisplay(hour, minute);

        // Check if it's the exact minute to send
        if (now.hours() === parseInt(hour) && now.minutes() === parseInt(minute)) {
            sendPolls(sock);
        }
    });

    updateNextPollDisplay(hour, minute);
};

const updateNextPollDisplay = (targetHour, targetMinute) => {
    const now = moment().tz('America/Sao_Paulo');
    let nextDate = moment().tz('America/Sao_Paulo').hours(targetHour).minutes(targetMinute).seconds(0);

    // Se o horário já passou hoje, agenda para o próximo dia útil
    if (now.isAfter(nextDate) || now.isSame(nextDate)) {
        nextDate.add(1, 'days');
    }

    const ignoreWeekend = process.argv.includes('--fim');

    if (!ignoreWeekend) {
        // Se for sábado (6), move para segunda (8 = 1 da próx sem)
        if (nextDate.day() === 6) nextDate.add(2, 'days');
        // Se for domingo (0), move para segunda
        if (nextDate.day() === 0) nextDate.add(1, 'days');
    }

    const formatDiffStr = () => {
        const duration = moment.duration(nextDate.diff(moment().tz('America/Sao_Paulo')));
        const d = Math.floor(duration.asDays());
        const h = duration.hours();
        const m = duration.minutes();
        return `${d}d ${h}h ${m}m`;
    };

    dashboard.setNextPoll(`${nextDate.format('DD/MM/YYYY HH:mm')} (em ${formatDiffStr()})`);
};

module.exports = { scheduleJob, sendPolls };
