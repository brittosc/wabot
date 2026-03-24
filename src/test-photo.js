const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');

const client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: {
        args: ['--no-sandbox']
    }
});

client.on('qr', (qr) => {
    qrcode.generate(qr, { small: true });
});

client.on('ready', async () => {
    console.log('Client is ready!');
    const testId = '211432750739655@lid'; // ID fornecido pelo usuário
    
    try {
        console.log(`Testando ID: ${testId}`);
        
        // Método 1: Direto
        const url1 = await client.getProfilePicUrl(testId);
        console.log(`Método 1 (Direct): ${url1 ? 'Sucesso' : 'Falhou (undefined)'}`);
        
        // Método 2: Via Contact
        const contact = await client.getContactById(testId);
        console.log(`Nome do contato: ${contact.pushname || contact.name}`);
        console.log('ID Full object:', JSON.stringify(contact.id, null, 2));
        
        const url2 = await contact.getProfilePicUrl();
        console.log(`Método 2 (Contact): ${url2 ? 'Sucesso' : 'Falhou (undefined)'}`);
        
        // Tentativa de tradução
        if (contact.id.user && !contact.id.user.includes('@')) {
           // Às vezes o user ID muda entre LID e JID
        }
        
    } catch (err) {
        console.error('Erro no teste:', err);
    } finally {
        // Mantenha aberto por uns segundos se necessário ou encerre
        process.exit();
    }
});

client.initialize();
