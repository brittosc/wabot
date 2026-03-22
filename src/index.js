require("dotenv").config(); // Carrega variáveis de ambiente do .env
process.removeAllListeners("warning");

const { Client, LocalAuth } = require("whatsapp-web.js");
const qrcode = require("qrcode-terminal");
const dashboard = require("./services/dashboard");
const cronJob = require("./services/cron-job");
const statistics = require("./services/statistics");
const weatherService = require("./services/weatherService");
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
        "--disable-features=IsolateOrigins,site-per-process",
        "--js-flags='--max-old-space-size=180 --lite-mode'",
        "--disable-web-security",
        "--disk-cache-size=1",
        "--media-cache-size=1",
        "--disable-background-networking",
        "--disable-default-apps",
        "--disable-sync",
      ],
    },
    // Removido webVersionCache pois causa picos de CPU em VPS ao verificar versões
  });

  client.on("qr", async (qr) => {
    if (process.env.PAIRING_PHONE) {
      try {
        const code = await client.getPairingCode(process.env.PAIRING_PHONE);
        dashboard.setPairingCode(code);
        dashboard.setStatus("Aguardando digitação do código no celular...");
        dashboard.addLog(`Pairing Code gerado para ${process.env.PAIRING_PHONE}`);
      } catch (e) {
        dashboard.addLog(`Erro ao gerar Pairing Code: ${e.message}`);
        qrcode.generate(qr, { small: true }, function (qrcodeStr) {
          dashboard.setQrCode(qrcodeStr);
        });
      }
    } else {
      qrcode.generate(qr, { small: true }, function (qrcodeStr) {
        dashboard.setQrCode(qrcodeStr);
        dashboard.setStatus("Aguardando escaneamento do QR Code...");
      });
      dashboard.addLog("Novo QR Code gerado.");
    }
  });

  client.on("ready", async () => {
    dashboard.setStatus("Conectado ✅");
    dashboard.addLog("Bot conectado com sucesso!");
    dashboard.addLog("Iniciando serviços secundários (Web Server, Clima, Stats)...");
    dashboard.setQrCode(""); // Limpa QR

    // Inicia o Servidor Web apenas após a conexão
    startServer();

    // Inicia serviços de Clima
    try {
      await weatherService.update();
      setInterval(() => weatherService.update(), 3600000);
    } catch (e) {
      dashboard.addLog(`Erro inicial clima: ${e.message}`);
    }

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
    // Não iniciamos mais nada aqui para poupar CPU para o Chrome
    await client.initialize();
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
startBot();
