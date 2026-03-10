const logUpdate = require('log-update').default || require('log-update');
const chalk = require('chalk');
const moment = require('moment-timezone');

class Dashboard {
    constructor() {
        this.status = 'Inicializando...';
        this.qrCodeStr = '';
        this.nextPollTime = 'Calculando...';
        this.totalSent = 0;
        this.logs = [];
        this.maxLogs = 5;
        this.serverUrl = '';
        this.occupancyData = []; // Array of { name, count, cap }
    }

    setOccupancy(data) {
        this.occupancyData = data;
        this.render();
    }

    setStatus(newStatus) {
        this.status = newStatus;
        this.render();
    }

    setQrCode(qr) {
        this.qrCodeStr = qr;
        this.render();
    }

    setNextPoll(timeStr) {
        this.nextPollTime = timeStr;
        this.render();
    }

    setServerUrl(url) {
        this.serverUrl = url;
        this.render();
    }

    incrementTotalSent() {
        this.totalSent++;
        this.render();
    }

    addLog(message) {
        const time = moment().tz('America/Sao_Paulo').format('HH:mm:ss');
        this.logs.unshift(`[${time}] ${message}`);
        if (this.logs.length > this.maxLogs) {
            this.logs.pop();
        }
        this.render();
    }

    render() {
        const header = chalk.bgBlue.white.bold(' 🤖 WhatsApp Bot Enquetes - Painel de Controle ');

        let statusColor = chalk.yellow;
        if (this.status.includes('Conectado')) statusColor = chalk.green;
        if (this.status.includes('Desconectado')) statusColor = chalk.red;

        const infoSection = [
            `Status: ${statusColor(this.status)}`,
            `Próxima Enquete: ${chalk.cyan(this.nextPollTime)}`,
            `Total de Enquetes Enviadas: ${chalk.magenta(this.totalSent)}`,
            this.serverUrl ? `Painel Web: ${chalk.cyan.underline(this.serverUrl)}` : ''
        ].filter(Boolean).join('\n');

        const logsSection = [
            chalk.bold.underline('Últimos Eventos:'),
            this.logs.length > 0 ? this.logs.map(l => chalk.gray(l)).join('\n') : chalk.gray('Sem logs recentes.')
        ].join('\n');

        let occupancySection = "";
        if (this.occupancyData && this.occupancyData.length > 0) {
            occupancySection = [
                chalk.bold.underline('Ocupação de Hoje (Ida):'),
                ...this.occupancyData.map(group => {
                    const percentage = (group.count / group.cap) * 100;
                    let color = chalk.green;
                    if (percentage > 85) color = chalk.yellow;
                    if (group.count >= group.cap) color = chalk.red;

                    return `${chalk.white(group.name.padEnd(25))} ${color(group.count.toString().padStart(2) + '/' + group.cap)}`;
                })
            ].join('\n') + '\n\n';
        }

        let output = `\n${header}\n\n${infoSection}\n\n${occupancySection}${logsSection}\n`;

        if (this.qrCodeStr) {
            output += `\n${chalk.bold('Por favor, escaneie o QR Code abaixo:')}\n${this.qrCodeStr}\n`;
        } else {
            // output += `\n${chalk.green('✅ Bot pronto para uso.')}\n`;
        }

        logUpdate(output);
    }
}

module.exports = new Dashboard();
