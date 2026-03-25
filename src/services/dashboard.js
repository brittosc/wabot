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
    this.lastHeight = 0;
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

  // Método para limpar a tela totalmente em caso de erro grave (opcional)
  clearScreen() {
    process.stdout.write("\x1b[2J\x1b[1;1H");
    this.initialized = false;
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
    const h = this.getDashHeight();

    if (!this.initialized) {
      this.setupScrollRegion();
    } else if (this.lastHeight && h !== this.lastHeight) {
      // Se a altura mudou, precisamos ajustar o espaço para não deixar logs presos
      if (h > this.lastHeight) {
        // Expandiu: insere linhas no topo para empurrar logs para baixo
        const diff = h - this.lastHeight;
        process.stdout.write(`\x1b[s\x1b[1;1H\x1b[${diff}L\x1b[u`);
      } else {
        // Contraiu: remove linhas do topo para puxar logs para cima
        const diff = this.lastHeight - h;
        process.stdout.write(`\x1b[s\x1b[1;1H\x1b[${diff}M\x1b[u`);
      }
      this.setupScrollRegion();
    }
    this.lastHeight = h;

    const padding = "  ";
    const formatLine = (str) => padding + str;

    const header = chalk.white.bold(
      "  🤖 WhatsApp Bot Enquetes - Painel de Controle",
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

    // Monta todas as linhas do painel
    const allLines = ["", header, ...infoLines, ...occupancyLines];

    // Salva cursor, vai para o topo e reescreve o painel
    let dashOutput =
      "\x1b[s" + // Salva posição do cursor
      "\x1b[1;1H" + // Move para Home (topo)
      "\x1b[?6l"; // Desabilita origin mode para não ficar preso na scroll region

    // Renderiza cada linha limpando-a primeiro
    for (let i = 0; i < h; i++) {
      const line = allLines[i] || "";
      dashOutput += `\x1b[2K${line}\n`;
    }

    dashOutput +=
      "\x1b[?6h" + // Reabilita origin mode
      "\x1b[u"; // Restaura posição do cursor

    process.stdout.write(dashOutput);
  }
}

module.exports = new Dashboard();
