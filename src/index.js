require("dotenv").config(); // Carrega variáveis de ambiente do .env
process.removeAllListeners("warning");

const { Client, LocalAuth } = require("whatsapp-web.js");
const qrcode = require("qrcode-terminal");
const dashboard = require("./services/dashboard");
const cronJob = require("./services/cron-job");
const statistics = require("./services/statistics");
const { startServer } = require("./server");

async function startBot() {
  dashboard.setStatus("Processando inicialização...");
  dashboard.addLog(`Ambiente: ${process.env.PAIRING_PHONE ? "Pairing Code Ativo" : "Modo QR Code"}`);
  if (process.env.PAIRING_PHONE) dashboard.addLog(`Número: ${process.env.PAIRING_PHONE}`);

  const client = new Client({
    authStrategy: new LocalAuth({ dataPath: "./auth_info" }),
    authTimeoutMs: 300000, // Dá 5 minutos para autenticar (ideal para VPS muito lenta)
    qrMaxRetries: 20, // Tenta mais vezes antes de falhar
    takeoverOnConflict: true, // Tenta assumir a sessão se houver conflito
    takeoverTimeoutMs: 60000,
    puppeteer: {
      headless: true,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-accelerated-2d-canvas",
        "--no-first-run",
        "--disable-gpu",
        "--disable-extensions",
        "--disable-software-rasterizer",
        "--mute-audio",
        "--no-default-browser-check",
        "--js-flags='--max-old-space-size=512'",
        "--disable-web-security",
        "--disable-background-networking",
        "--disable-default-apps",
        "--disable-sync",
        "--disable-canvas-aa",
        "--disable-2d-canvas-clip-aa",
        "--disable-gl-drawing-for-tests",
        "--no-first-run",
      ],
      dumpio: true,
      protocolTimeout: 300000, // Timeout de 5 minutos
    },
    // Ativa vinculação por telefone se o número estiver no .env
    ...(process.env.PAIRING_PHONE ? {
      pairWithPhoneNumber: {
        phoneNumber: process.env.PAIRING_PHONE,
        showNotification: true
      }
    } : {})
  });

  client.on("qr", (qr) => {
    // Se não estivermos em modo Pairing, mostra o QR
    if (!process.env.PAIRING_PHONE) {
      qrcode.generate(qr, { small: true }, function (qrcodeStr) {
        dashboard.setQrCode(qrcodeStr);
        dashboard.setStatus("Aguardando escaneamento do QR Code...");
      });
      dashboard.addLog("Novo QR Code gerado.");
    }
  });

  client.on("pairing_code", (code) => {
    dashboard.setPairingCode(code);
    dashboard.setStatus("Código gerado! Digite no celular 📱");
    dashboard.addLog(`Código de vinculação: ${code}`);
  });

  client.on("loading_screen", (percent, message) => {
    dashboard.setStatus(`Carregando WhatsApp: ${percent}%`);
    dashboard.addLog(`Loading: ${percent}% - ${message}`);
  });

  client.on("ready", async () => {
    dashboard.setStatus("Conectado ✅");
    dashboard.addLog("Bot conectado com sucesso!");
    // Inicia o cronJob com a instância do client
    cronJob.scheduleJob(client);

    // Atualiza ocupação inicial no terminal e gera HTML inicial
    const currentStats = await statistics.readStats();
    await statistics.updateTerminalOccupancy(currentStats);
    // Gera o Dashboard inicial
    statistics.generateHtmlDashboard().catch(e => dashboard.addLog(`Erro Dash: ${e.message}`));
    
    // Calcula próxima enquete
    updateNextPollTime();

    if (process.argv.includes("--now")) {
      dashboard.addLog("Parâmetro --now detectado. Forçando envio imediato 🎉");
      cronJob.sendPolls(client);
    }
  });

  client.on("vote_update", async (vote) => {
    try {
      // Tenta obter o nome do contato para auto-registro
      let voterName = null;
      try {
        const contact = await client.getContactById(vote.voter);
        voterName = contact.pushname || contact.name;
      } catch (e) {
        dashboard.addLog(`Aviso: Não foi possível obter nome de ${vote.voter}`);
      }

      await statistics.registerVote(vote, voterName);
      dashboard.addLog(`Voto computado de ${voterName || vote.voter}`);
    } catch (error) {
      dashboard.addLog(`Erro ao computar voto: ${error.message}`);
    }
  });

  client.on("authenticated", () => {
    dashboard.addLog("Autenticação preservada. Sessão já aberta!");
  });

  client.on("auth_failure", (msg) => {
    dashboard.setStatus("Erro Autenticação");
    dashboard.addLog(
      `Falha na autenticação. Limpe o diretório auth_info. Motivo: ${msg}`,
    );
  });

  client.on("disconnected", (reason) => {
    dashboard.setStatus("Desconectado");
    dashboard.addLog(`Cliente foi desconectado. Motivo: ${reason}`);
    // Tenta reinicializar o cliente após 5s
    setTimeout(() => {
      dashboard.addLog("Tentando reconexão...");
      client
        .initialize()
        .catch((e) => dashboard.addLog(`Erro ao reconectar: ${e}`));
    }, 5000);
  });

  try {
    dashboard.addLog("Iniciando Client.initialize()...");
    await client.initialize();
    dashboard.addLog("Client.initialize() concluído.");
  } catch (e) {
    dashboard.addLog(`Erro fatal no puppeteer: ${e.message}`);
  }
}

function updateNextPollTime() {
  const configService = require("./services/configService");
  const config = configService.getConfig();
  const pollTimeStr = config.pollTime || "05:30";
  const skipDates = config.skipDates || {};
  const [hour, minute] = pollTimeStr.split(":").map(Number);
  const moment = require("moment-timezone");
  
  let next = moment().tz("America/Sao_Paulo").set({ hour, minute, second: 0, millisecond: 0 });
  if (next.isBefore(moment())) next.add(1, "day");
  
  while (next.day() === 0 || next.day() === 6 || skipDates[next.format("YYYY-MM-DD")]) {
    next.add(1, "day");
  }
  
  const diff = next.diff(moment());
  const duration = moment.duration(diff);
  const days = Math.floor(duration.asDays());
  const hours = duration.hours();
  const mins = duration.minutes();
  
  const display = next.format("DD/MM/YYYY HH:mm") + ` (em ${days}d ${hours}h ${mins}m)`;
  dashboard.setNextPoll(display);
}

// Inicia o processo do Bot (Modo Sobrevivência)
dashboard.render();
startServer();
startBot();
