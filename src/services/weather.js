const fs = require("fs");
const path = require("path");
const moment = require("moment-timezone");
const dashboard = require("./dashboard");
const { withRetry } = require("./utils");

const WEATHER_FILE = path.join(__dirname, "../../config/weather.json");

let weatherCache = {
  data: [],
  lastUpdate: null,
};

// Carrega dados iniciais do arquivo, se existir
const loadFromDisk = () => {
  try {
    if (fs.existsSync(WEATHER_FILE)) {
      const content = fs.readFileSync(WEATHER_FILE, "utf-8");
      weatherCache = JSON.parse(content);
      // dashboard.addLog("Clima carregado do disco com sucesso.");
    }
  } catch (e) {
    dashboard.addLog(`Erro ao carregar clima do disco: ${e.message}`);
  }
};

const saveToDisk = () => {
  try {
    const dir = path.dirname(WEATHER_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(WEATHER_FILE, JSON.stringify(weatherCache, null, 2));
  } catch (e) {
    dashboard.addLog(`Erro ao salvar clima no disco: ${e.message}`);
  }
};

const updateWeather = async () => {
  dashboard.addLog("Iniciando atualização agendada do clima...");
  try {
    await withRetry(
      async () => {
        const weatherRes = await fetch(
          "https://api.open-meteo.com/v1/forecast?latitude=-28.6775&longitude=-49.3703&daily=weather_code,temperature_2m_max,temperature_2m_min&timezone=America%2FSao_Paulo",
        );
        if (weatherRes.ok) {
          const d = await weatherRes.json();
          if (d && d.daily) {
            weatherCache.data = d.daily.time.map((time, i) => ({
              date: moment(time).format("DD/MM"),
              max: Math.round(d.daily.temperature_2m_max[i]),
              min: Math.round(d.daily.temperature_2m_min[i]),
              condition_code: d.daily.weather_code[i],
            }));
            weatherCache.lastUpdate = Date.now();
            saveToDisk();
            dashboard.addLog(`Clima atualizado com sucesso via API.`);
          }
        } else {
          throw new Error(`HTTP ${weatherRes.status}`);
        }
      },
      5,
      2000,
      "Clima (Agendado)",
    );
  } catch (we) {
    dashboard.addLog(`Erro ao atualizar clima (API): ${we.message}`);
  }
};

const getWeatherData = () => {
  return weatherCache;
};

// Inicialização
loadFromDisk();

// Se não houver dados, faz uma busca inicial assíncrona
if (weatherCache.data.length === 0) {
  updateWeather().catch(() => {});
}

module.exports = { updateWeather, getWeatherData };
