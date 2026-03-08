const http = require('http');
const fs = require('fs');
const dashboard = require('./dashboard');

const startServer = () => {
    const port = process.env.PORT || 3000;
    const server = http.createServer((req, res) => {
        if (req.url === '/' || req.url === '/estatisticas' || req.url === '/estatisticas.html') {
            fs.readFile('./estatisticas.html', 'utf8', (err, data) => {
                if (err) {
                    if (err.code === 'ENOENT') {
                        // Arquivo não existe ainda
                        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
                        res.end(`
<!DOCTYPE html>
<html lang="pt-BR">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="refresh" content="60">
    <title>Aguardando Dados - WABot</title>
    <style>
        :root {
            --bg-color: #f4f7f6;
            --card-bg: #ffffff;
            --text-color: #333;
            --accent: #2196f3;
        }
        body {
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            background-color: var(--bg-color);
            color: var(--text-color);
            margin: 0;
            height: 100vh;
            display: flex;
            justify-content: center;
            align-items: center;
        }
        .container {
            background: var(--card-bg);
            padding: 50px;
            border-radius: 20px;
            box-shadow: 0 10px 40px rgba(0,0,0,0.08);
            text-align: center;
            max-width: 450px;
            width: 90%;
            animation: fadeIn 0.8s cubic-bezier(0.25, 0.46, 0.45, 0.94);
        }
        h1 {
            color: #2c3e50;
            font-size: 1.8rem;
            margin-bottom: 15px;
            font-weight: 600;
        }
        p {
            color: #7f8c8d;
            font-size: 1.05rem;
            line-height: 1.6;
            margin-bottom: 30px;
        }
        .loader {
            width: 50px;
            height: 50px;
            border: 4px solid #f0f0f0;
            border-top: 4px solid var(--accent);
            border-radius: 50%;
            animation: spin 1s linear infinite;
            margin: 0 auto 25px auto;
        }
        .illustration {
            font-size: 4rem;
            margin-bottom: 20px;
            display: inline-block;
            animation: float 3s ease-in-out infinite;
        }
        @keyframes spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
        }
        @keyframes fadeIn {
            from { opacity: 0; transform: translateY(30px); }
            to { opacity: 1; transform: translateY(0); }
        }
        @keyframes float {
            0% { transform: translateY(0px); }
            50% { transform: translateY(-10px); }
            100% { transform: translateY(0px); }
        }
        .waiting-text {
            display: inline-block;
            color: var(--accent);
            font-weight: 500;
            animation: pulse 2s infinite;
        }
        @keyframes pulse {
            0% { opacity: 0.6; }
            50% { opacity: 1; }
            100% { opacity: 0.6; }
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="illustration">📊</div>
        <div class="loader"></div>
        <h1>Sem dados disponíveis</h1>
        <p>As estatísticas das enquetes ainda não foram geradas.</p>
        <div class="waiting-text">Aguardando interações...</div>
    </div>
</body>
</html>
                        `);
                    } else {
                        res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
                        res.end('Erro ao carregar a página de estatísticas.');
                    }
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
