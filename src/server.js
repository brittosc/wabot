const http = require("http");
const { readStats, readPassengers } = require("./services/statistics");
const configService = require("./services/configService");
const dashboard = require("./services/dashboard");
const { withRetry } = require("./services/utils");
const moment = require("moment-timezone");

// Cache de Clima (1 hora)
let weatherCache = {
  data: [],
  lastUpdate: null,
};

const startServer = () => {
  const port = process.env.PORT || 3000;
  const allowedOrigin = process.env.FRONTEND_ORIGIN || "*";

  const setCorsHeaders = (res) => {
    res.setHeader("Access-Control-Allow-Origin", allowedOrigin);
    res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  };

  const server = http.createServer(async (req, res) => {
    // Preflight CORS
    if (req.method === "OPTIONS") {
      setCorsHeaders(res);
      res.writeHead(204);
      res.end();
      return;
    }

    // Rota API de Stats para o frontend de estatísticas
    if (req.url === "/api/stats") {
      setCorsHeaders(res);

      try {
         const stats = await readStats();
         const passengers = await readPassengers();
         const config = configService.getConfig();

        // Busca clima via backend com cache de 1 hora
        const oneHour = 60 * 60 * 1000;
        const now = Date.now();
        if (!weatherCache.lastUpdate || now - weatherCache.lastUpdate > oneHour) {
          try {
            await withRetry(async () => {
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
                  weatherCache.lastUpdate = now;
                }
              } else {
                throw new Error(`HTTP ${weatherRes.status}`);
              }
            }, 5, 1000, "Clima");
          } catch (we) {
            dashboard.addLog(`Erro ao buscar clima no Open-Meteo: ${we.message}`);
          }
        }

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            votes: stats.rawDB || {},
            passengers: passengers || [],
            isPollSentToday: !!stats.isPollSentToday,
            capacities: config.groupCapacities || {},
            aliases: config.groupAliases || {},
            weather: weatherCache.data,
            weatherLastUpdate: weatherCache.lastUpdate,
            pollTime: config.pollTime || '06:00'
          }),
        );
      } catch (err) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: err.message }));
      }
      return;
    }

    // Endpoint não encontrado
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Not found.");
  });

  server.listen(port, "0.0.0.0", () => {
    dashboard.setServerUrl(`http://0.0.0.0:${port}`);
    dashboard.addLog(`[Server] API rodando na porta ${port}`);
  });
};

module.exports = { startServer };
