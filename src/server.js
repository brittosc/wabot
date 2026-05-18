const http = require("http");
const { readStats, readPassengers, readPollHistory } = require("./services/statistics");
const configService = require("./services/configService");
const dashboard = require("./services/dashboard");
const { withRetry } = require("./services/utils");
const moment = require("moment-timezone");

const weatherService = require("./services/weather");

const startServer = () => {
  const port = process.env.PORT || 3001;

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
    const path = req.url.split("?")[0];
    if (path === "/api/stats") {
      setCorsHeaders(res);

      try {
        const stats = await readStats();
        const passengers = await readPassengers();
        const pollHistory = await readPollHistory();
        const config = configService.getConfig();
        const weather = weatherService.getWeatherData();

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            votes: stats.rawDB || {},
            passengers: passengers || [],
            pollHistory: pollHistory || [],
            isPollSentToday: !!stats.isPollSentToday,
            capacities: config.groupCapacities || {},
            aliases: config.groupAliases || {},
            weather: weather.data,
            weatherLastUpdate: weather.lastUpdate,
            pollTime: config.pollTime || "05:30",
            skipDates: config.skipDates || {},
            rankingHighlights: config.rankingHighlights || {},
            highlightNames: config.highlightNames || [],
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
  });
};

module.exports = { startServer };
