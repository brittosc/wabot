const chalk = require("chalk");
const moment = require("moment-timezone");

class Dashboard {
  constructor() {
    this.status = "Inicializando...";
    this.qrCodeStr = "";
    this.nextPollTime = "Calculando...";
    this.totalSent = 0;
    this.serverUrl = "";
    this.occupancyData = [];
    this.renderTimeout = null;
    this.initialized = false;
  }

  // Calcula quantas linhas o dashboard ocupa com base nos dados atuais
  getDashHeight() {
    let h = 3; // header + linha separadora + linha em branco
    h += this.serverUrl ? 4 : 3; // Status, Próxima, Total, [API]
    if (this.occupancyData && this.occupancyData.length > 0) {
      h += 1 + this.occupancyData.length; // Título + linhas de grupo
    }
    return h + 1; // +1 de margem
  }

  setupScrollRegion() {
    const h = this.getDashHeight();
    // Esconde o cursor permanentemente e restaura no encerramento do processo
    process.stdout.write("\x1b[?25l");
    const restoreCursor = () => process.stdout.write("\x1b[?25h");
    process.on("exit", restoreCursor);
    process.on("SIGINT", () => {
      restoreCursor();
      process.exit();
    });
    process.on("SIGTERM", () => {
      restoreCursor();
      process.exit();
    });

    // Zona de scroll: linha (h+1) até o fim da tela
    process.stdout.write(`\x1b[${h + 1};r`);
    // Posiciona cursor na zona de logs
    process.stdout.write(`\x1b[${h + 1};1H`);
    this.initialized = true;
  }

  setOccupancy(data) {
    this.occupancyData = data;
    // Re-inicializa a região de scroll pois o tamanho mudou
    this.initialized = false;
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
    if (!this.initialized) {
      this.setupScrollRegion();
    }
    // \x1b[2K: Limpa a linha atual
    // \x1b[G: Move o cursor para o começo da linha (0)
    process.stdout.write(
      `\x1b[2K\x1b[G  ${chalk.gray(`[${time}] ${message}`)}\n`,
    );
    this.requestRender();
  }

  requestRender() {
    if (this.renderTimeout) clearTimeout(this.renderTimeout);
    this.renderTimeout = setTimeout(() => this.render(), 50);
  }

  render() {
    if (!this.initialized) {
      this.setupScrollRegion();
    }

    const padding = "  ";
    const formatLine = (str) => "\x1b[2K" + padding + str;

    const header = chalk.white.bold(
      "🤖 WhatsApp Bot Enquetes - Painel de Controle",
    );
    let statusColor = chalk.yellow;
    if (this.status.includes("Conectado")) statusColor = chalk.green;
    if (this.status.includes("Desconectado")) statusColor = chalk.red;

    const infoLines = [
      formatLine(`Status: ${statusColor(this.status)}`),
      formatLine(`Próxima Enquete: ${chalk.cyan(this.nextPollTime)}`),
      formatLine(
        `Total de Enquetes Enviadas: ${chalk.magenta(this.totalSent)}`,
      ),
      this.serverUrl
        ? formatLine(`API Backend: ${chalk.cyan.underline(this.serverUrl)}`)
        : "",
    ].filter(Boolean);

    let occupancyLines = [];
    if (this.occupancyData && this.occupancyData.length > 0) {
      occupancyLines.push("");
      occupancyLines.push(
        formatLine(chalk.bold.underline("Ocupação de Hoje (Ida):")),
      );
      for (const group of this.occupancyData) {
        const percentage = (group.count / group.cap) * 100;
        let color = chalk.green;
        if (percentage > 85) color = chalk.yellow;
        if (group.count >= group.cap) color = chalk.red;
        const namePart = group.name.substring(0, 24).padEnd(25);
        const statusPart = group.status.padStart(7);
        occupancyLines.push(
          formatLine(`${chalk.white(namePart)} ${color(statusPart)}`),
        );
      }
    }

    // Salva cursor, vai para o topo e reescreve o painel
    const allLines = [
      "\x1b[2K",
      formatLine(header),
      ...infoLines,
      ...occupancyLines,
    ];
    const dashOutput =
      "\x1b[s" + // Salva posição do cursor
      "\x1b[1;1H" + // Move para Home (topo)
      "\x1b[?6l" + // Desabilita origin mode para não ficar preso na scroll region
      allLines.map((line) => `\x1b[2K${line}`).join("\n") +
      "\n" +
      "\n" +
      "\n" +
      "\x1b[?6h" + // Reabilita origin mode
      "\x1b[u"; // Restaura posição do cursor

    process.stdout.write(dashOutput);
  }
}

module.exports = new Dashboard();
