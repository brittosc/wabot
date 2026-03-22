const dashboard = require("./dashboard");

class WeatherService {
  constructor() {
    this.weatherData = null;
    this.lastUpdate = null;
    this.lat = -28.6775;
    this.lon = -49.3703;
    this.apiUrl = `https://api.open-meteo.com/v1/forecast?latitude=${this.lat}&longitude=${this.lon}&current=temperature_2m,relative_humidity_2m,is_day,weather_code&daily=weather_code,temperature_2m_max,temperature_2m_min&timezone=America%2FSao_Paulo`;
  }

  async update() {
    try {
      const response = await fetch(this.apiUrl);
      if (!response.ok) throw new Error("Falha ao buscar dados de clima");
      
      const data = await response.json();
      this.weatherData = {
        current: {
          temp: data.current.temperature_2m,
          humidity: data.current.relative_humidity_2m,
          isDay: !!data.current.is_day,
          code: data.current.weather_code,
          description: this.getWeatherDescription(data.current.weather_code),
        },
        daily: data.daily,
      };
      this.lastUpdate = new Date();
      dashboard.addLog(`[Weather] Clima atualizado: ${this.weatherData.current.temp}°C, ${this.weatherData.current.description}`);
      return this.weatherData;
    } catch (error) {
      dashboard.addLog(`[Weather] Erro ao atualizar clima: ${error.message}`);
      return null;
    }
  }

  getWeather() {
    return this.weatherData;
  }

  getWeatherDescription(code) {
    const codes = {
      0: "Céu limpo",
      1: "Principalmente limpo",
      2: "Parcialmente nublado",
      3: "Encoberto",
      45: "Nevoeiro",
      48: "Nevoeiro com geada",
      51: "Drizzle leve",
      53: "Drizzle moderado",
      55: "Drizzle denso",
      61: "Chuva leve",
      63: "Chuva moderada",
      65: "Chuva forte",
      71: "Neve leve",
      73: "Neve moderada",
      75: "Neve forte",
      80: "Pancadas de chuva leve",
      81: "Pancadas de chuva moderadas",
      82: "Pancadas de chuva violentas",
      95: "Trovoada leve ou moderada",
      96: "Trovoada com granizo leve",
      99: "Trovoada com granizo forte"
    };
    return codes[code] || "Desconhecido";
  }
}

module.exports = new WeatherService();
