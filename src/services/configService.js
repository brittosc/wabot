const fs = require('fs');
const path = require('path');

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
            console.log('[ConfigService] Configuração carregada com sucesso.');
        } catch (error) {
            console.error('[ConfigService] Erro ao carregar config.json:', error.message);
        }
    }

    watchConfig() {
        fs.watch(CONFIG_PATH, (eventType) => {
            if (eventType === 'change') {
                console.log('[ConfigService] Detectada alteração no config.json. Recarregando...');
                // Pequeno delay para garantir que o arquivo foi totalmente gravado
                setTimeout(() => this.loadConfig(), 100);
            }
        });
    }

    getConfig() {
        return this.config;
    }
}

module.exports = new ConfigService();
