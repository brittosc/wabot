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
    this.votesFooterData = [];
    this.renderTimeout = null;
    this.initialized = false;
    this.lastHeight = 0;
    this.isFirstRender = true;
    this.resizeListenerAdded = false;
  }

  // Altura do cabeçalho fixo (topo)
  getDashHeight() {
    let h = 3; // header + linha separadora + linha em branco
    h += this.serverUrl ? 4 : 3; // Status, Próxima, Total, [API]
    if (this.qrCodeStr) {
      h += this.qrCodeStr.split("\n").length + 1;
    }
    return h + 1; // +1 de margem
  }

  // Altura do rodapé fixo (votos)
  getFooterHeight() {
    if (!this.votesFooterData || this.votesFooterData.length === 0) return 0;
    return this.votesFooterData.length + 3; // título + grupos + total + 1 branco abaixo
  }

  setupScrollRegion() {
    const h = this.getDashHeight();
    const fh = this.getFooterHeight();
    const rows = process.stdout.rows || 30;
    const scrollBottom = fh > 0 ? rows - fh : rows;

    // Esconde cursor; restaura no encerramento
    process.stdout.write("\x1b[?25l");
    if (!this.resizeListenerAdded) {
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
      // Re-renderiza ao redimensionar o terminal
      process.stdout.on("resize", () => {
        this.initialized = false;
        this.requestRender();
      });
      this.resizeListenerAdded = true;
    }

    process.stdout.write("\x1b[s");
    // Scroll region: linha (h+1) até (rows - footerHeight)
    process.stdout.write(`\x1b[${h + 1};${scrollBottom}r`);

    if (this.isFirstRender) {
      process.stdout.write(`\x1b[${h + 1};1H`);
      this.isFirstRender = false;
    } else {
      process.stdout.write("\x1b[u");
    }

    this.initialized = true;
  }

  setOccupancy(data) {
    this.occupancyData = data;
    this.initialized = false;
    this.requestRender();
  }

  setVotesFooter(data) {
    this.votesFooterData = data || [];
    this.initialized = false;
    this.requestRender();
  }

  setStatus(newStatus) {
    this.status = newStatus;
    this.requestRender();
  }

  setQrCode(qr) {
    this.qrCodeStr = qr;
    this.initialized = false;
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

  clearScreen() {
    process.stdout.write("\x1b[2J\x1b[1;1H");
    this.initialized = false;
    this.isFirstRender = true;
    this.requestRender();
  }

  addLog(message) {
    const time = moment().tz("America/Sao_Paulo").format("HH:mm:ss");
    if (!this.initialized) {
      this.setupScrollRegion();
    }
    process.stdout.write(
      `\x1b[2K\x1b[G  ${chalk.gray(`[${time}]`)} ${message}\n`,
    );
    // Redesenha o footer fixo imediatamente após o log
    // para evitar que o rodapó de votos apareça duplicado
    this.renderVotesFooter();
    this.requestRender();
  }

  requestRender() {
    if (this.renderTimeout) clearTimeout(this.renderTimeout);
    this.renderTimeout = setTimeout(() => this.render(), 50);
  }

  // Desenha o rodapé fixo de votos fora da scroll region
  renderVotesFooter() {
    const data = this.votesFooterData;
    if (!data || data.length === 0) return;

    const rows = process.stdout.rows || 30;
    const fh = this.getFooterHeight();
    const startRow = rows - fh + 1;
    const padding = "  ";

    let totalVotes = 0;
    const groupLines = data.map((group) => {
      const namePart = chalk.white(group.name.substring(0, 22).padEnd(23));
      const vIda = chalk.green(`↑${String(group.ida).padStart(2)}`);
      const vSoIda = chalk.blue(`↑${String(group.soIda).padStart(2)}`);
      const vSoVolta = chalk.hex("#FFA500")(
        `↓${String(group.soVolta).padStart(2)}`,
      );
      const vNao = chalk.red(`✗${String(group.nao).padStart(2)}`);
      totalVotes += group.ida + group.soIda + group.soVolta + group.nao;
      return `${padding}${namePart} ${vIda} ${vSoIda} ${vSoVolta} ${vNao}`;
    });

    const totalLine = `${padding}${chalk.bold.white("Total de Votos:".padEnd(23))} ${chalk.bold.magenta(totalVotes)}`;

    // Sai da scroll region para posicionar absolutamente
    let out = "\x1b[s\x1b[?6l";
    // Título diretamente (o espaço vazio da area de log já separa)
    out += `\x1b[${startRow};1H\x1b[2K${padding}${chalk.bold.cyan("Votos de Hoje:")}`;
    groupLines.forEach((line, i) => {
      out += `\x1b[${startRow + 1 + i};1H\x1b[2K${line}`;
    });
    //out += `\x1b[${startRow + 1 + data.length};1H\x1b[2K${totalLine}`;
    // 1 linha em branco abaixo do total
    out += `\x1b[${startRow + 1 + data.length};1H\x1b[2K`;
    out += "\x1b[?6h\x1b[u";

    process.stdout.write(out);
  }

  render() {
    const h = this.getDashHeight();

    if (!this.initialized) {
      this.setupScrollRegion();
    } else if (this.lastHeight && h !== this.lastHeight) {
      if (h > this.lastHeight) {
        const diff = h - this.lastHeight;
        process.stdout.write(`\x1b[s\x1b[1;1H\x1b[${diff}L\x1b[u`);
      } else {
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
        ? formatLine(
            `API Backend: ${chalk.cyan("https://api.grupobritto.com.br/api/stats")}`,
          )
        : "",
    ].filter(Boolean);

    let qrLines = [];
    if (this.qrCodeStr) {
      qrLines.push("");
      qrLines.push(
        formatLine(chalk.bold.underline("Aguardando Leitura do QR Code:")),
      );
      const lines = this.qrCodeStr.split("\n");
      for (const line of lines) {
        qrLines.push(padding + line);
      }
    }

    const allLines = ["", header, ...infoLines, ...qrLines];

    let dashOutput = "\x1b[s" + "\x1b[1;1H" + "\x1b[?6l";

    for (let i = 0; i < h; i++) {
      const line = allLines[i] || "";
      dashOutput += `\x1b[2K${line}\n`;
    }

    dashOutput += "\x1b[?6h" + "\x1b[u";

    process.stdout.write(dashOutput);

    // Redesenha o rodapé fixo de votos
    this.renderVotesFooter();
  }
}

module.exports = new Dashboard();
