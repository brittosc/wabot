const http = require('http');
const fs = require('fs');
const dashboard = require('./dashboard');

const startServer = () => {
    const port = process.env.PORT || 3000;
    const server = http.createServer((req, res) => {
        if (req.url === '/' || req.url === '/estatisticas' || req.url === '/estatisticas.html') {
            fs.readFile('./estatisticas.html', 'utf8', (err, data) => {
                if (err) {
                    res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
                    res.end('Erro ao carregar a página de estatísticas.');
                    return;
                }
                res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
                res.end(data);
            });
        } else {
            res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
            res.end('Página não encontrada.');
        }
    });

    server.listen(port, () => {
        dashboard.addLog(`Servidor Web iniciado na porta ${port}`);
        dashboard.setServerUrl(`http://localhost:${port}`);
    });
};

module.exports = { startServer };
