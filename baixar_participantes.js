/**
 * Script Standalone para baixar informações dos participantes dos grupos do WhatsApp
 * e salvá-los no Supabase na tabela `passageiros`.
 *
 * Limpa automaticamente arquivos de locks órfãos e utiliza o serviço de sincronização unificado.
 *
 * Execução: node baixar_participantes.js
 */

require("dotenv").config({ quiet: true });
const { Client, LocalAuth } = require("whatsapp-web.js");
const qrcode = require("qrcode-terminal");
const chalk = require("chalk");
const fs = require("fs");
const path = require("path");
const { sincronizarParticipantes } = require("./src/services/passengerSync");

async function main() {
  console.log(chalk.cyan.bold("\n=== INICIALIZANDO DOWNLOADER DE PARTICIPANTES ===\n"));

  // 1. Limpeza automática e segura do lock órfão do Puppeteer no Windows
  const lockPath = path.join(__dirname, "auth_info/session/SingletonLock");
  try {
    if (fs.existsSync(lockPath)) {
      fs.unlinkSync(lockPath);
      console.log(chalk.gray("🧹 Arquivo de lock órfão (SingletonLock) removido com sucesso."));
    }
  } catch (err) {
    // Se der erro de permissão (EBUSY/EPERM), o bot já está rodando ativamente e bloqueando o arquivo
    console.log(chalk.yellow("⚠️ O bot principal parece estar ativo em outra janela e bloqueando a sessão."));
    console.log(chalk.yellow("   Para rodar o script, certifique-se de encerrar o bot principal primeiro.\n"));
    console.log(chalk.red("❌ Falha fatal ao inicializar o Puppeteer: Session locked."));
    process.exit(1);
  }

  // 2. Inicialização do cliente com User Agent Real de alta fidelidade
  const client = new Client({
    authStrategy: new LocalAuth({ dataPath: "./auth_info" }),
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
    webVersionCache: {
      type: "remote",
      remotePath: "https://raw.githubusercontent.com/wppconnect-team/wa-version/main/html/{version}.html"
    },
    puppeteer: {
      headless: true,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-accelerated-2d-canvas",
        "--no-first-run",
        "--no-zygote",
        "--disable-gpu",
      ],
    },
  });

  client.on("qr", (qr) => {
    console.log(chalk.yellow("🔑 Autenticação necessária. Escaneie o QR Code abaixo:"));
    qrcode.generate(qr, { small: true });
  });

  client.on("auth_failure", (msg) => {
    console.error(chalk.red("❌ Falha na autenticação do WhatsApp:"), msg);
    process.exit(1);
  });

  client.on("ready", async () => {
    console.log(chalk.green.bold("✅ Cliente WhatsApp conectado com sucesso!\n"));
    
    try {
      // Executa a sincronização modularizada
      await sincronizarParticipantes(client, console.log);
    } catch (error) {
      console.error(chalk.red("💥 Erro durante a sincronização:"), error);
    } finally {
      console.log(chalk.blue("🔌 Encerrando conexão com o WhatsApp..."));
      await client.destroy();
      console.log(chalk.green("👋 Processo finalizado!"));
      process.exit(0);
    }
  });

  try {
    await client.initialize();
  } catch (err) {
    console.error(chalk.red("❌ Falha fatal ao inicializar o Puppeteer:"), err);
    process.exit(1);
  }
}

main();
