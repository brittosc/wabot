const http = require("http");
const fs = require("fs");
const dashboard = require("./services/dashboard");
const { readStats } = require("./services/statistics");
const configService = require("./services/configService");

const startServer = () => {
  const port = process.env.PORT || 3000;

  const server = http.createServer(async (req, res) => {
    // Rota API de rawDB para o Auto-Refresh do frontend das Estatísticas
    if (req.url === "/api/stats") {
      try {
        const stats = await readStats();
        const config = configService.getConfig();
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            votes: stats.rawDB || {},
            isPollSentToday: !!stats.isPollSentToday,
            capacities: config.groupCapacities || {},
            aliases: config.groupAliases || {},
          }),
        );
      } catch (err) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: err.message }));
      }
      return;
    }

    // Rota Raiz (Redireciona para estatísticas ou mostra index simples)
    if (req.url === "/") {
      res.writeHead(302, { Location: "/estatisticas" });
      res.end();
      return;
    }

    // Rota Estatísticas do WhatsApp
    if (req.url === "/estatisticas" || req.url === "/estatisticas.html") {
      fs.readFile("./public/estatisticas.html", "utf8", (err, data) => {
        if (err) {
          res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
          res.end("Erro ao carregar a página de estatísticas.");
          return;
        }
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(data);
      });
      return;
    }

    // Rota Manifest PWA
    if (req.url === "/manifest.json") {
      fs.readFile("./public/manifest.json", (err, data) => {
        if (err) {
          res.writeHead(404);
          res.end();
          return;
        }
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(data);
      });
      return;
    }

    // Rota Service Worker
    if (req.url === "/sw.js") {
      fs.readFile("./public/sw.js", (err, data) => {
        if (err) {
          res.writeHead(404);
          res.end();
          return;
        }
        res.writeHead(200, {
          "Content-Type": "application/javascript",
          "Cache-Control": "no-cache, no-store, must-revalidate",
        });
        res.end(data);
      });
      return;
    }

    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Página não encontrada.");
  });

  server.listen(port, "0.0.0.0", () => {
    dashboard.setServerUrl(`http://0.0.0.0:${port}`);
  });
};

module.exports = { startServer };
