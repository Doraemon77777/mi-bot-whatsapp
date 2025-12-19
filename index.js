// ============================================
// BOT DE WHATSAPP COMPLETO - SOLUCIONADO PARA RENDER
// ============================================

const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const fs = require('fs');
const path = require('path');

// IMPORTACIÓN CORREGIDA PARA RENDER
const chromium = require('@sparticuz/chromium');
const puppeteer = require('puppeteer-core');

// Configuración
const CONFIG = {
    botName: "Bot de Notificaciones",
    prefix: ".",
    maxMentions: 10,
    notificationCooldown: 30000
};

// Sistema de logs
class Logger {
    static log(message, type = 'INFO') {
        const timestamp = new Date().toLocaleString('es-MX');
        const logMessage = `[${timestamp}] [${type}] ${message}`;
        
        console.log(logMessage);
        
        // Guardar en archivo
        const logDir = path.join(__dirname, 'logs');
        if (!fs.existsSync(logDir)) {
            fs.mkdirSync(logDir, { recursive: true });
        }
        
        const logFile = path.join(logDir, `bot-${new Date().toISOString().split('T')[0]}.log`);
        fs.appendFileSync(logFile, logMessage + '\n', 'utf8');
    }

    static error(message) {
        this.log(message, 'ERROR');
    }

    static warn(message) {
        this.log(message, 'WARN');
    }

    static info(message) {
        this.log(message, 'INFO');
    }
}

// ============================================
// CONFIGURACIÓN CORREGIDA DEL CLIENTE
// ============================================

// Función para obtener configuración de Puppeteer compatible con Render
async function getPuppeteerConfig() {
    try {
        Logger.info('Configurando Puppeteer para Render...');
        
        // Configuración específica para Render
        const executablePath = await chromium.executablePath();
        
        Logger.info(`Ruta de Chromium: ${executablePath}`);
        
        return {
            executablePath: executablePath,
            args: [
                ...chromium.args,
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-accelerated-2d-canvas',
                '--no-first-run',
                '--no-zygote',
                '--disable-gpu',
                '--single-process',
                '--disable-setuid-sandbox',
                '--disable-features=VizDisplayCompositor',
                '--window-size=1920,1080'
            ],
            headless: chromium.headless,
            ignoreHTTPSErrors: true,
            timeout: 60000
        };
    } catch (error) {
        Logger.error(`Error configurando Puppeteer: ${error.message}`);
        throw error;
    }
}

// Variable global para el cliente
let client;

// Función para inicializar el cliente
async function initializeClient() {
    try {
        const puppeteerConfig = await getPuppeteerConfig();
        
        const newClient = new Client({
            authStrategy: new LocalAuth({
                clientId: "whatsapp-bot",
                dataPath: path.join(__dirname, 'sessions'),
                backupSyncIntervalMs: 300000
            }),
            puppeteer: puppeteerConfig,
            webVersionCache: {
                type: 'remote',
                remotePath: 'https://raw.githubusercontent.com/wppconnect-team/wa-version/main/html/2.2412.54.html'
            }
        });
        
        return newClient;
    } catch (error) {
        Logger.error(`Error inicializando cliente: ${error.message}`);
        throw error;
    }
}

// Cache para cooldowns
const cooldowns = new Map();

// Verificar cooldown
function checkCooldown(chatId, command) {
    const key = `${chatId}-${command}`;
    const lastUsed = cooldowns.get(key);
    
    if (lastUsed) {
        const now = Date.now();
        const cooldownTime = command === '.notify' ? CONFIG.notificationCooldown : 5000;
        const remaining = lastUsed + cooldownTime - now;
        
        if (remaining > 0) {
            return Math.ceil(remaining / 1000);
        }
    }
    
    return 0;
}

// Actualizar cooldown
function updateCooldown(chatId, command) {
    const key = `${chatId}-${command}`;
    cooldowns.set(key, Date.now());
}

// Extraer menciones del texto
function extractMentions(text) {
    const mentionRegex = /@(\d{10,15})/g;
    const matches = text.match(mentionRegex);
    
    if (!matches) return [];
    
    const limitedMatches = matches.slice(0, CONFIG.maxMentions);
    return limitedMatches.map(match => match.substring(1));
}

// Formatear número para ID de WhatsApp
function formatNumberForId(number) {
    let cleanNumber = number.replace(/\D/g, '');
    
    if (!cleanNumber.startsWith('1') && !cleanNumber.startsWith('52') && 
        !cleanNumber.startsWith('55') && !cleanNumber.startsWith('57')) {
        cleanNumber = '52' + cleanNumber;
    }
    
    return `${cleanNumber}@c.us`;
}

// COMANDO .todo - Mencionar usuarios
async function handleTodoCommand(chat, messageText, sender, originalMessage) {
    try {
        Logger.info(`Comando .todo recibido de ${sender} en grupo ${chat.name}`);
        
        const cooldownLeft = checkCooldown(chat.id._serialized, '.todo');
        if (cooldownLeft > 0) {
            await originalMessage.reply(`⏳ Espera ${cooldownLeft} segundos antes de usar .todo de nuevo.`);
            return;
        }
        
        const text = messageText.substring('.todo'.length).trim();
        
        if (!text) {
            await originalMessage.reply('❌ Formato: .todo @número mensaje\nEjemplo: .todo @551234567890 Hola');
            return;
        }
        
        const numbers = extractMentions(text);
        
        if (numbers.length === 0) {
            await originalMessage.reply('❌ No encontré menciones (@). Usa: .todo @número mensaje');
            return;
        }
        
        const contacts = [];
        const failedNumbers = [];
        
        for (const number of numbers) {
            try {
                const contactId = formatNumberForId(number);
                const contact = await client.getContactById(contactId);
                
                if (contact) {
                    contacts.push(contact);
                } else {
                    failedNumbers.push(number);
                }
            } catch (error) {
                failedNumbers.push(number);
                Logger.warn(`No se pudo obtener contacto para ${number}: ${error.message}`);
            }
        }
        
        if (contacts.length === 0) {
            await originalMessage.reply('❌ No se encontraron usuarios válidos.');
            return;
        }
        
        let finalText = text;
        for (let i = 0; i < contacts.length; i++) {
            const originalNumber = numbers[i];
            const formattedNumber = contacts[i].number;
            finalText = finalText.replace(`@${originalNumber}`, `@${formattedNumber}`);
        }
        
        await chat.sendMessage(finalText, {
            mentions: contacts
        });
        
        updateCooldown(chat.id._serialized, '.todo');
        
        if (failedNumbers.length > 0) {
            await originalMessage.reply(`✅ Menciones enviadas a ${contacts.length} usuario(s).\n❌ No se encontraron: ${failedNumbers.join(', ')}`);
        } else {
            await originalMessage.reply(`✅ Menciones enviadas a ${contacts.length} usuario(s).`);
        }
        
    } catch (error) {
        Logger.error(`Error en .todo: ${error.message}`);
        await originalMessage.reply('❌ Error al procesar el comando.');
    }
}

// COMANDO .notify - Notificar a todo el grupo
async function handleNotifyCommand(chat, messageText, sender, originalMessage) {
    try {
        Logger.info(`Comando .notify recibido de ${sender} en grupo ${chat.name}`);
        
        const cooldownLeft = checkCooldown(chat.id._serialized, '.notify');
        if (cooldownLeft > 0) {
            await originalMessage.reply(`⏳ Espera ${cooldownLeft} segundos antes de usar .notify de nuevo.`);
            return;
        }
        
        const notificationText = messageText.substring('.notify'.length).trim();
        
        if (!notificationText) {
            await originalMessage.reply('❌ Escribe el mensaje. Usa: .notify tu mensaje importante');
            return;
        }
        
        await chat.fetchParticipants();
        const participants = chat.participants;
        
        if (!participants || participants.length === 0) {
            await originalMessage.reply('❌ No se pudieron obtener los miembros.');
            return;
        }
        
        const contacts = [];
        for (const participant of participants) {
            try {
                const contact = await client.getContactById(participant.id._serialized);
                if (contact) {
                    contacts.push(contact);
                }
            } catch (error) {
                Logger.warn(`Error obteniendo contacto: ${error.message}`);
            }
        }
        
        if (contacts.length === 0) {
            await originalMessage.reply('❌ No se pudieron obtener los contactos.');
            return;
        }
        
        const notificationMessage = `📢 *NOTIFICACIÓN PARA TODOS*\n\n${notificationText}\n\n_Esta notificación fue enviada a todos los miembros del grupo._`;
        
        await chat.sendMessage(notificationMessage, {
            mentions: contacts
        });
        
        updateCooldown(chat.id._serialized, '.notify');
        
        await originalMessage.reply(`✅ Notificación enviada a ${contacts.length} miembros.`);
        
    } catch (error) {
        Logger.error(`Error en .notify: ${error.message}`);
        await originalMessage.reply('❌ Error al enviar la notificación.');
    }
}

// COMANDO .help - Mostrar ayuda
async function handleHelpCommand(chat, originalMessage) {
    const helpMessage = `🤖 *BOT DE NOTIFICACIONES* 🤖

*COMANDOS:*

*.todo @número mensaje*
- Menciona usuarios
- Ejemplo: .todo @551234567890 Revisa esto

*.notify mensaje*
- Notifica a TODOS
- Ejemplo: .notify Reunión mañana

*.help*
- Muestra esta ayuda

*NOTAS:*
- Usa @ seguido del número (sin espacios)
- Máximo ${CONFIG.maxMentions} menciones por comando`;
    
    await originalMessage.reply(helpMessage);
}

// ============================================
// EVENTOS DEL CLIENTE
// ============================================

// Función para configurar eventos
function setupClientEvents(clientInstance) {
    // QR Code
   // QR Code - VERSIÓN MEJORADA PARA RENDER
clientInstance.on('qr', (qr) => {
    Logger.info('QR Code generado');
    
    // SOLUCIÓN: Generar enlace para escanear desde el teléfono
    const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=400x400&data=${encodeURIComponent(qr)}`;
    const qrTextUrl = `https://qrcode-monkey.com/qr-code-text/?text=${encodeURIComponent(qr)}`;
    
    console.log('\n' + '='.repeat(70));
    console.log('🚀 WHATSAPP BOT - VINCULAR DISPOSITIVO');
    console.log('='.repeat(70));
    
    console.log('\n📱 MÉTODO 1 (RECOMENDADO - MÁS FÁCIL):');
    console.log('1. Abre ESTE ENLACE en tu teléfono:');
    console.log(`🔗 ${qrUrl}`);
    console.log('2. Verás una imagen del código QR');
    console.log('3. Escanéala con WhatsApp');
    console.log('   (WhatsApp → Menú → Dispositivos vinculados)');
    
    console.log('\n📱 MÉTODO 2 (ALTERNATIVO):');
    console.log('1. Abre este enlace en tu teléfono:');
    console.log(`🔗 ${qrTextUrl}`);
    console.log('2. La página generará automáticamente el QR');
    console.log('3. Escanea la imagen generada');
    
    console.log('\n📱 MÉTODO 3 (TERMINAL - si quieres intentar):');
    console.log('Intenta escanear este código directamente:');
    console.log('-'.repeat(50));
    
    // Intentar mostrar QR en terminal (pero con mejor formato)
    try {
        // Generar QR más limpio
        const cleanQR = qr.replace(/\s+/g, ' ');
        const lines = cleanQR.split('\n');
        
        // Mostrar cada línea sin espacios extra
        lines.forEach(line => {
            console.log(line.trim());
        });
    } catch (error) {
        console.log('(Usa los métodos 1 o 2 para mejor resultado)');
    }
    
    console.log('-'.repeat(50));
    console.log('\n⏰ Este QR es válido por 2 minutos');
    console.log('💡 Guarda estos enlaces si necesitas tiempo');
    console.log('='.repeat(70) + '\n');
    
    // Guardar el enlace en un archivo por si se pierde
    try {
        const fs = require('fs');
        const qrInfo = `
🕐 Generado: ${new Date().toLocaleString()}
🔗 Enlace directo: ${qrUrl}
🔗 Generador: ${qrTextUrl}
📱 Instrucciones:
1. Abre el enlace en tu teléfono
2. Verás el código QR
3. WhatsApp → Menú → Dispositivos vinculados
4. Escanea el código
        `.trim();
        
        fs.writeFileSync('qr-info.txt', qrInfo);
        Logger.info('Información del QR guardada en qr-info.txt');
    } catch (error) {
        // Ignorar si falla
    }
});

    // Cliente listo
    clientInstance.on('ready', () => {
        Logger.info('Cliente de WhatsApp listo y autenticado');
        console.log('\n' + '='.repeat(60));
        console.log('✅ BOT INICIADO CORRECTAMENTE');
        console.log('='.repeat(60));
        console.log(`Nombre: ${clientInstance.info.pushname}`);
        console.log(`Número: ${clientInstance.info.wid.user}`);
        console.log(`Prefijo: ${CONFIG.prefix}`);
        console.log('='.repeat(60));
        console.log('📋 COMANDOS DISPONIBLES:');
        console.log('='.repeat(60));
        console.log(`${CONFIG.prefix}todo @número mensaje`);
        console.log(`${CONFIG.prefix}notify mensaje`);
        console.log(`${CONFIG.prefix}help`);
        console.log('='.repeat(60));
        console.log('💡 Agrega este bot a tus grupos');
        console.log('='.repeat(60) + '\n');
    });

    // Manejar mensajes
    clientInstance.on('message', async (message) => {
        try {
            if (message.fromMe) return;
            
            const chat = await message.getChat();
            const messageText = message.body.trim();
            const sender = message.author || message.from;
            
            Logger.info(`Mensaje en grupo: ${messageText.substring(0, 50)}...`);
            
            if (!chat.isGroup) {
                if (messageText.toLowerCase() === '.help') {
                    await handleHelpCommand(chat, message);
                }
                return;
            }
            
            if (messageText.toLowerCase().startsWith('.todo ')) {
                await handleTodoCommand(chat, messageText, sender, message);
            } 
            else if (messageText.toLowerCase().startsWith('.notify ')) {
                await handleNotifyCommand(chat, messageText, sender, message);
            }
            else if (messageText.toLowerCase() === '.help') {
                await handleHelpCommand(chat, message);
            }
            
        } catch (error) {
            Logger.error(`Error procesando mensaje: ${error.message}`);
        }
    });

    // Manejar errores
    clientInstance.on('auth_failure', (msg) => {
        Logger.error(`Fallo de autenticación: ${msg}`);
        console.log('❌ ERROR DE AUTENTICACIÓN');
        console.log('Reinicia el bot y escanea el QR nuevamente.');
    });

    clientInstance.on('disconnected', (reason) => {
        Logger.warn(`Cliente desconectado: ${reason}`);
        console.log('⚠️ Bot desconectado. Reconectando en 10 segundos...');
        
        setTimeout(async () => {
            try {
                await startBot();
            } catch (error) {
                Logger.error(`Error al reconectar: ${error.message}`);
            }
        }, 10000);
    });

    return clientInstance;
}

// ============================================
// INICIALIZACIÓN
// ============================================

async function startBot() {
    try {
        Logger.info('Iniciando bot de WhatsApp...');
        
        // Crear carpetas necesarias
        const folders = ['sessions', 'logs'];
        folders.forEach(folder => {
            const folderPath = path.join(__dirname, folder);
            if (!fs.existsSync(folderPath)) {
                fs.mkdirSync(folderPath, { recursive: true });
                Logger.info(`Carpeta creada: ${folder}`);
            }
        });
        
        // Verificar si ya hay un cliente activo
        if (client) {
            try {
                await client.destroy();
                Logger.info('Cliente anterior destruido');
            } catch (error) {
                Logger.warn(`Error destruyendo cliente anterior: ${error.message}`);
            }
        }
        
        // Inicializar nuevo cliente
        Logger.info('Creando nuevo cliente...');
        client = await initializeClient();
        
        // Configurar eventos
        setupClientEvents(client);
        
        // Iniciar cliente
        Logger.info('Inicializando cliente...');
        await client.initialize();
        
        Logger.info('Bot iniciado exitosamente');
        
    } catch (error) {
        Logger.error(`Error al iniciar bot: ${error.message}`);
        console.log('\n❌ ERROR CRÍTICO AL INICIAR EL BOT');
        console.log('Detalles:', error.message);
        
        if (error.message.includes('Failed to launch the browser process')) {
            console.log('\n🔧 DIAGNÓSTICO DEL ERROR:');
            console.log('1. El navegador Chromium no se encuentra en Render');
            console.log('2. Esto se soluciona usando @sparticuz/chromium');
            console.log('3. Verifica que tu package.json tenga:');
            console.log('   - "@sparticuz/chromium": "^121.0.0"');
            console.log('   - "puppeteer-core": "^21.0.0"');
            console.log('\n🔄 REALIZANDO RECONEXIÓN EN 30 SEGUNDOS...');
            
            setTimeout(() => {
                startBot();
            }, 30000);
        } else {
            console.log('\n🔄 INTENTANDO NUEVAMENTE EN 60 SEGUNDOS...');
            setTimeout(() => {
                startBot();
            }, 60000);
        }
    }
}

// Manejar señales
process.on('SIGINT', () => {
    console.log('\n🛑 Apagando bot...');
    if (client) {
        client.destroy();
    }
    console.log('✅ Bot apagado correctamente');
    process.exit(0);
});

process.on('SIGTERM', () => {
    console.log('\n🛑 Recibida señal de terminación...');
    if (client) {
        client.destroy();
    }
    console.log('✅ Bot apagado correctamente');
    process.exit(0);
});

// Iniciar el bot
startBot();

// Heartbeat para mantener activo
setInterval(() => {
    if (Date.now() % 60000 < 1000) {
        Logger.info('🤖 Bot activo y funcionando...');
        
        // Verificar estado del cliente
        if (client && client.pupBrowser && !client.pupBrowser.isConnected()) {
            Logger.warn('Navegador desconectado, reconectando...');
            startBot();
        }
    }
}, 1000);

// Función para obtener el cliente (para uso externo si es necesario)
function getClient() {
    return client;
}

// Exportar para pruebas (opcional)
if (require.main === module) {
    // Este archivo se ejecuta directamente
    console.log('🚀 Iniciando bot WhatsApp desde línea de comandos...');
} else {
    // Este archivo se importa como módulo
    module.exports = {
        getClient,
        startBot,
        CONFIG
    };
}

const express = require('express');
const app = express();

const PORT = process.env.PORT || 3000;

app.get('/', (req, res) => {
  res.send('🤖 Bot de WhatsApp activo');
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Servidor web escuchando en el puerto ${PORT}`);
});

