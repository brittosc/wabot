const logUpdate = require("log-update").default || require("log-update");
const chalk = require("chalk");
const moment = require("moment-timezone");

class Dashboard {
  constructor() {
    this.status = "Inicializando...";
    this.qrCodeStr = "";
    this.nextPollTime = "Calculando...";
    this.totalSent = 0;
    this.logs = [];
    this.maxLogs = 5;
    this.serverUrl = "";
    this.occupancyData = []; // Array of { name, count, cap }
    this.renderTimeout = null;
  }

  setOccupancy(data) {
    this.occupancyData = data;
    this.requestRender();
  }

  setStatus(newStatus) {
    this.status = newStatus;
    this.requestRender();
  }

  setQrCode(qr) {
    this.qrCodeStr = qr;
    this.requestRender();
  }

  setNextPoll(timeStr) {
    this.nextPollTime = timeStr;
    this.requestRender();
  }

  setServerUrl(url) {
    this.serverUrl = url;
    this.requestRender();
  }

  incrementTotalSent() {
    this.totalSent++;
    this.requestRender();
  }

  addLog(message) {
    const time = moment().tz("America/Sao_Paulo").format("HH:mm:ss");
    this.logs.unshift(`[${time}] ${message}`);
    if (this.logs.length > this.maxLogs) {
      this.logs.pop();
    }
    this.requestRender();
  }

  requestRender() {
    if (this.renderTimeout) clearTimeout(this.renderTimeout);
    this.renderTimeout = setTimeout(() => this.render(), 50);
  }

  render() {
    const width = process.stdout.columns || 80;
    
    // Helper para garantir que a linha limpe o rastro do render anterior
    const padLine = (str) => {
      const plain = str.replace(/\u001b\[\d+m/g, ""); // Remove cores para contar tamanho real
      const padding = Math.max(0, width - plain.length - 1);
      return str + " ".repeat(padding);
    };

    const header = chalk.bgBlue.white.bold(
      " 🤖 WhatsApp Bot Enquetes - Painel de Controle ",
    );

    let statusColor = chalk.yellow;
    if (this.status.includes("Conectado")) statusColor = chalk.green;
    if (this.status.includes("Desconectado")) statusColor = chalk.red;

    const infoSection = [
      padLine(`Status: ${statusColor(this.status)}`),
      padLine(`Próxima Enquete: ${chalk.cyan(this.nextPollTime)}`),
      padLine(`Total de Enquetes Enviadas: ${chalk.magenta(this.totalSent)}`),
      this.serverUrl
        ? padLine(`API Backend: ${chalk.cyan.underline(this.serverUrl)}`)
        : "",
    ]
      .filter(Boolean)
      .join("\n");

    const logsSection = [
      padLine(chalk.bold.underline("Últimos Eventos:")),
      ...(this.logs.length > 0
        ? this.logs.map((l) => padLine(chalk.gray(l)))
        : [padLine(chalk.gray("Sem logs recentes."))]),
    ].join("\n");

    let occupancySection = "";
    if (this.occupancyData && this.occupancyData.length > 0) {
      occupancySection = [
        padLine(chalk.bold.underline("Ocupação de Hoje (Ida):")),
        ...this.occupancyData.map((group) => {
          const percentage = (group.count / group.cap) * 100;
          let color = chalk.green;
          if (percentage > 85) color = chalk.yellow;
          if (group.count >= group.cap) color = chalk.red;

          const namePart = group.name.substring(0, 24).padEnd(25);
          const statusPart = group.status.padStart(7);
          return padLine(`${chalk.white(namePart)} ${color(statusPart)}`);
        }),
      ].join("\n");
    }

    // Construção final com ordem estável e espaçamentos fixos
    let output =
      padLine(header) +
      "\n\n" +
      infoSection +
      "\n\n" +
      logsSection +
      "\n\n" +
      (occupancySection ? occupancySection + "\n" : "");

    if (this.qrCodeStr) {
      output +=
        "\n" +
        padLine(chalk.bold("Por favor, escaneie o QR Code abaixo:")) +
        "\n" +
        this.qrCodeStr +
        "\n";
    }

    logUpdate(output);
  }
}

module.exports = new Dashboard();
