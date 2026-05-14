const fs = require("fs");
const path = require("path");
const dashboard = require("./dashboard");

const CONFIG_PATH = path.join(__dirname, "../../config/config.json");

class ConfigService {
  constructor() {
    this.config = {};
    this.loadConfig();
    this.watchConfig();
  }

  loadConfig() {
    try {
      const data = fs.readFileSync(CONFIG_PATH, "utf8");
      this.config = JSON.parse(data);
      dashboard.addLog("Configuração carregada com sucesso.");
    } catch (error) {
      dashboard.addLog(
        `Erro ao carregar config.json: ${error.message}`,
      );
    }
  }

  watchConfig() {
    let watchTimeout = null;
    fs.watch(CONFIG_PATH, (eventType) => {
      if (eventType === "change") {
        if (watchTimeout) clearTimeout(watchTimeout);
        watchTimeout = setTimeout(() => {
          dashboard.addLog(
            "Alteração detectada no config.json. Recarregando...",
          );
          this.loadConfig();
        }, 500); // 500ms debounce
      }
    });
  }

  getConfig() {
    return this.config;
  }
}

module.exports = new ConfigService();
