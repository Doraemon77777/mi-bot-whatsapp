const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const fs = require('fs');
const path = require('path');

// Configuración
const CONFIG = {
    botName: "Bot de Notificaciones",
    prefix: ".",
    maxMentions: 10, // Máximo de menciones por comando
    notificationCooldown: 30000 // 30 segundos de cooldown entre notificaciones
};

// Sistema de logs mejorado
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

// Inicializar cliente
const client = new Client({
    authStrategy: new LocalAuth({
        clientId: "whatsapp-bot",
        dataPath: path.join(__dirname, 'sessions')
    }),
    puppeteer: {
        headless: true,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--no-first-run',
            '--no-zygote',
            '--single-process',
            '--disable-gpu',
            '--use-gl=egl'
        ],
        executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || null
    },
    webVersionCache: {
        type: 'remote',
        remotePath: 'https://raw.githubusercontent.com/wppconnect-team/wa-version/main/html/2.2412.54.html'
    }
});

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
            return Math.ceil(remaining / 1000); // Segundos restantes
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
    
    // Limitar el número de menciones
    const limitedMatches = matches.slice(0, CONFIG.maxMentions);
    
    // Extraer solo los números
    return limitedMatches.map(match => match.substring(1)); // Remover el @
}

// Formatear número para ID de WhatsApp
function formatNumberForId(number) {
    // Limpiar el número (solo dígitos)
    let cleanNumber = number.replace(/\D/g, '');
    
    // Si no empieza con código de país, asumir México (52)
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
        
        // Verificar cooldown
        const cooldownLeft = checkCooldown(chat.id._serialized, '.todo');
        if (cooldownLeft > 0) {
            await originalMessage.reply(`⏳ Espera ${cooldownLeft} segundos antes de usar .todo de nuevo.`);
            return;
        }
        
        // Extraer el texto después del comando
        const text = messageText.substring('.todo'.length).trim();
        
        if (!text) {
            await originalMessage.reply('❌ Formato incorrecto. Usa:\n.todo @número mensaje\n\nEjemplo:\n.todo @551234567890 Hola, revisa esto');
            return;
        }
        
        // Buscar menciones
        const numbers = extractMentions(text);
        
        if (numbers.length === 0) {
            await originalMessage.reply('❌ No encontré menciones (@). Usa:\n.todo @número mensaje');
            return;
        }
        
        Logger.info(`Encontradas ${numbers.length} menciones: ${numbers.join(', ')}`);
        
        // Obtener contactos
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
            await originalMessage.reply('❌ No se encontraron usuarios válidos para mencionar.');
            return;
        }
        
        // Crear texto del mensaje (mantener las @originales)
        let finalText = text;
        
        // Reemplazar cada @número con @[número formateado] para menciones
        for (let i = 0; i < contacts.length; i++) {
            const originalNumber = numbers[i];
            const formattedNumber = contacts[i].number;
            finalText = finalText.replace(`@${originalNumber}`, `@${formattedNumber}`);
        }
        
        // Enviar mensaje con menciones
        await chat.sendMessage(finalText, {
            mentions: contacts
        });
        
        // Actualizar cooldown
        updateCooldown(chat.id._serialized, '.todo');
        
        // Enviar confirmación si hubo números fallidos
        if (failedNumbers.length > 0) {
            await originalMessage.reply(`✅ Menciones enviadas a ${contacts.length} usuario(s).\n❌ No se encontraron: ${failedNumbers.join(', ')}`);
        } else {
            await originalMessage.reply(`✅ Menciones enviadas a ${contacts.length} usuario(s).`);
        }
        
        Logger.info(`Menciones enviadas exitosamente a ${contacts.length} usuarios`);
        
    } catch (error) {
        Logger.error(`Error en comando .todo: ${error.message}`);
        await originalMessage.reply('❌ Error al procesar el comando. Intenta de nuevo.');
    }
}

// COMANDO .notify - Notificar a todo el grupo
async function handleNotifyCommand(chat, messageText, sender, originalMessage) {
    try {
        Logger.info(`Comando .notify recibido de ${sender} en grupo ${chat.name}`);
        
        // Verificar cooldown
        const cooldownLeft = checkCooldown(chat.id._serialized, '.notify');
        if (cooldownLeft > 0) {
            await originalMessage.reply(`⏳ Espera ${cooldownLeft} segundos antes de usar .notify de nuevo.`);
            return;
        }
        
        // Extraer el mensaje de notificación
        const notificationText = messageText.substring('.notify'.length).trim();
        
        if (!notificationText) {
            await originalMessage.reply('❌ Escribe el mensaje de notificación. Usa:\n.notify tu mensaje importante\n\nEjemplo:\n.notify Reunión mañana a las 10 AM');
            return;
        }
        
        // Obtener todos los participantes del grupo
        await chat.fetchParticipants();
        const participants = chat.participants;
        
        if (!participants || participants.length === 0) {
            await originalMessage.reply('❌ No se pudieron obtener los miembros del grupo.');
            return;
        }
        
        Logger.info(`Grupo ${chat.name} tiene ${participants.length} participantes`);
        
        // Obtener contactos de los participantes
        const contacts = [];
        for (const participant of participants) {
            try {
                const contact = await client.getContactById(participant.id._serialized);
                if (contact) {
                    contacts.push(contact);
                }
            } catch (error) {
                Logger.warn(`Error obteniendo contacto ${participant.id._serialized}: ${error.message}`);
            }
        }
        
        if (contacts.length === 0) {
            await originalMessage.reply('❌ No se pudieron obtener los contactos del grupo.');
            return;
        }
        
        // Crear mensaje de notificación
        const notificationMessage = `📢 *NOTIFICACIÓN PARA TODOS*\n\n${notificationText}\n\n_Esta notificación fue enviada a todos los miembros del grupo._`;
        
        // Enviar notificación
        await chat.sendMessage(notificationMessage, {
            mentions: contacts
        });
        
        // Actualizar cooldown
        updateCooldown(chat.id._serialized, '.notify');
        
        // Confirmar envío
        await originalMessage.reply(`✅ Notificación enviada a ${contacts.length} miembros del grupo.`);
        
        Logger.info(`Notificación enviada a ${contacts.length} miembros en grupo ${chat.name}`);
        
    } catch (error) {
        Logger.error(`Error en comando .notify: ${error.message}`);
        await originalMessage.reply('❌ Error al enviar la notificación. Intenta de nuevo.');
    }
}

// COMANDO .help - Mostrar ayuda
async function handleHelpCommand(chat, originalMessage) {
    const helpMessage = `🤖 *BOT DE NOTIFICACIONES* 🤖

*COMANDOS DISPONIBLES:*

*.todo @número mensaje*
- Menciona a usuarios específicos
- Puedes mencionar varios usuarios: .todo @551234567890 @551234567891 Hola a ambos
- Máximo ${CONFIG.maxMentions} menciones por comando

*.notify mensaje*
- Notifica a TODOS los miembros del grupo
- Incluye una mención a cada miembro
- Cooldown: ${CONFIG.notificationCooldown / 1000} segundos

*.help*
- Muestra este mensaje de ayuda

*EJEMPLOS:*
\`\`\`
.todo @551234567890 Por favor revisa el documento
.todo @551234567890 @551234567891 Reunión hoy
.notify Recordatorio: Pago mensual hoy
.notify Reunión importante mañana a las 10 AM
\`\`\`

*NOTAS:*
- Usa @ seguido del número (ej: @551234567890)
- Sin espacios entre @ y el número
- El bot funciona solo en grupos`;
    
    await originalMessage.reply(helpMessage);
}

// ============================================
// EVENTOS DEL CLIENTE
// ============================================

// QR Code
client.on('qr', (qr) => {
    Logger.info('QR Code generado');
    console.log('\n' + '='.repeat(60));
    console.log('🚀 ESCANEA ESTE CÓDIGO QR CON WHATSAPP:');
    console.log('='.repeat(60));
    qrcode.generate(qr, { small: true });
    console.log('='.repeat(60));
    console.log('1. Abre WhatsApp en tu teléfono');
    console.log('2. Toca los 3 puntos → Dispositivos vinculados');
    console.log('3. Escanea el código QR');
    console.log('='.repeat(60) + '\n');
});

// Cliente listo
client.on('ready', () => {
    Logger.info('Cliente de WhatsApp listo y autenticado');
    console.log('\n' + '='.repeat(60));
    console.log('✅ BOT INICIADO CORRECTAMENTE');
    console.log('='.repeat(60));
    console.log(`Nombre: ${client.info.pushname}`);
    console.log(`Número: ${client.info.wid.user}`);
    console.log(`Prefijo: ${CONFIG.prefix}`);
    console.log('='.repeat(60));
    console.log('📋 COMANDOS DISPONIBLES:');
    console.log('='.repeat(60));
    console.log(`${CONFIG.prefix}todo @número mensaje`);
    console.log('  → Menciona usuarios específicos');
    console.log('');
    console.log(`${CONFIG.prefix}notify mensaje`);
    console.log('  → Notifica a todo el grupo');
    console.log('');
    console.log(`${CONFIG.prefix}help`);
    console.log('  → Muestra ayuda');
    console.log('='.repeat(60));
    console.log('💡 Agrega este bot a tus grupos de WhatsApp');
    console.log('='.repeat(60) + '\n');
});

// Manejar mensajes
client.on('message', async (message) => {
    try {
        // Ignorar mensajes propios del bot
        if (message.fromMe) return;
        
        // Obtener información del mensaje
        const chat = await message.getChat();
        const messageText = message.body.trim();
        const sender = message.author || message.from;
        
        // Solo procesar en grupos
        if (!chat.isGroup) {
            if (messageText.toLowerCase() === '.help') {
                await handleHelpCommand(chat, message);
            }
            return;
        }
        
        Logger.info(`Mensaje en grupo "${chat.name}": ${messageText.substring(0, 50)}...`);
        
        // Procesar comandos
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
client.on('auth_failure', (msg) => {
    Logger.error(`Fallo de autenticación: ${msg}`);
    console.log(' ERROR DE AUTENTICACIÓN');
    console.log('Reinicia el bot y escanea el QR nuevamente.');
});

client.on('disconnected', (reason) => {
    Logger.warn(`Cliente desconectado: ${reason}`);
    console.log('⚠️ Bot desconectado. Reconectando en 5 segundos...');
    
    setTimeout(() => {
        client.initialize();
    }, 5000);
});

// ============================================
// INICIALIZACIÓN PARA RENDER
// ============================================

async function startBot() {
    try {
        Logger.info('Iniciando bot de WhatsApp...');
        
        // Verificar y crear carpetas necesarias
        const folders = ['sessions', 'logs'];
        folders.forEach(folder => {
            const folderPath = path.join(__dirname, folder);
            if (!fs.existsSync(folderPath)) {
                fs.mkdirSync(folderPath, { recursive: true });
                Logger.info(`Carpeta creada: ${folder}`);
            }
        });
        
        // Iniciar cliente
        await client.initialize();
        
        Logger.info('Bot iniciado exitosamente');
        
    } catch (error) {
        Logger.error(`Error al iniciar bot: ${error.message}`);
        console.log(' ERROR CRÍTICO AL INICIAR EL BOT');
        console.log('Detalles:', error.message);
        process.exit(1);
    }
}

// Manejar señales de terminación
process.on('SIGINT', () => {
    console.log('\n Apagando bot...');
    client.destroy();
    console.log(' Bot apagado correctamente');
    process.exit(0);
});

process.on('SIGTERM', () => {
    console.log('\n Recibida señal de terminación...');
    client.destroy();
    console.log(' Bot apagado correctamente');
    process.exit(0);
});

// Iniciar el bot
startBot();

// Mantener el proceso activo para Render
setInterval(() => {
    // Heartbeat para mantener el proceso activo
    if (Date.now() % 60000 < 1000) { // Cada minuto
        Logger.info('Bot activo y funcionando...');
    }
}, 1000);