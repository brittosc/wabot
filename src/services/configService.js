const fs = require('fs');
const path = require('path');
const dashboard = require('./dashboard');

const CONFIG_PATH = path.join(__dirname, '../../config/config.json');

class ConfigService {
    constructor() {
        this.config = {};
        this.loadConfig();
        this.watchConfig();
    }

    loadConfig() {
        try {
            const data = fs.readFileSync(CONFIG_PATH, 'utf8');
            this.config = JSON.parse(data);
            dashboard.addLog('[ConfigService] Configuração carregada com sucesso.');
        } catch (error) {
            dashboard.addLog(`[ConfigService] Erro ao carregar config.json: ${error.message}`);
        }
    }

    watchConfig() {
        fs.watch(CONFIG_PATH, (eventType) => {
            if (eventType === 'change') {
                // Pequeno delay para garantir que o arquivo foi totalmente gravado
                setTimeout(() => {
                    dashboard.addLog('[ConfigService] Alteração detectada no config.json. Recarregando...');
                    this.loadConfig();
                }, 100);
            }
        });
    }

    getConfig() {
        return this.config;
    }
}

module.exports = new ConfigService();
