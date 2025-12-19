const express = require('express');
const app = express();
const PORT = process.env.PORT || 3000;

// Ruta para health check de Render
app.get('/health', (req, res) => {
    res.status(200).json({
        status: 'online',
        timestamp: new Date().toISOString(),
        service: 'whatsapp-bot'
    });
});

// Ruta principal
app.get('/', (req, res) => {
    res.sendFile(__dirname + '/index.html');
});

app.listen(PORT, () => {
    console.log(`Server de health check corriendo en puerto ${PORT}`);
});