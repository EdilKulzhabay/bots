const { Client, LocalAuth } = require("whatsapp-web.js");
const qrcode = require("qrcode-terminal");
require("dotenv").config();
const path = require("path");
const { default: axios } = require("axios");
const url = `https://api.telegram.org/bot${process.env.TOKEN}/sendMessage`;
const fs = require("fs");
const FormData = require('form-data');
const mongoose = require("mongoose")
const Chat = require("./Chat");
const { prompt, scripts, kzScripts, enScripts } = require("./prompt");
const User = require("./User");
const OPENAI_API_KEY = process.env.OPENAI_API_KEY

mongoose
    .connect("mongodb://localhost:27017/BotTibetskaya")
    .then(() => {
        console.log("Mongodb OK");
    })
    .catch((err) => {
        console.log("Mongodb Error", err);
    });

// Убедитесь, что путь к сессии корректный
const client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: {
        headless: true, // Убедитесь, что Puppeteer работает в headless режиме
    },
});

client.on("qr", (qr) => {
    qrcode.generate(qr, { small: true });
});

client.on("authenticated", (session) => {
    console.log(
        "Authenticated with session:",
        session ? JSON.stringify(session) : "undefined"
    );
});

client.on("auth_failure", (msg) => {
    console.error("Authentication failed:", msg);
});

client.on("disconnected", (reason) => {
    console.log("Client was logged out:", reason);
});

client.on("ready", () => {
    console.log("Client is ready!");
});

const addChat = async (chatId) => {
    const chat = new Chat({
        chatId
    });

    await chat.save();
}

const removeChat = async (chatId) => {
    await Chat.deleteOne({ chatId });
}

client.on('message_create', async (msg) => {
    if (msg.fromMe) {
        const chatId = msg.to;

        if (msg.body.toLocaleLowerCase().includes("отключить бота")) {
            await addChat(chatId);
        }

        if (msg.body.toLocaleLowerCase().includes("включить бота")) {
            await removeChat(chatId);
        }
    }
});

// Переменные для хранения количества уникальных пользователей и отправок в Telegram
let uniqueUsersToday = new Set(); // Хранит уникальные ID пользователей за сегодня
let messagesToTelegramToday = 0; // Количество сообщений, отправленных в Telegram сегодня
let lastCheckDate = new Date().toLocaleDateString(); // Последняя дата для сброса
// Функция для сброса счетчиков на следующий день
function resetCountersIfNeeded() {
    const currentDate = new Date().toLocaleDateString();
    if (lastCheckDate !== currentDate) {
        // Если наступил новый день, сбрасываем счетчики
        uniqueUsersToday.clear();
        messagesToTelegramToday = 0;
        lastCheckDate = currentDate;
    }
}
// Функция для обращения к GPT и получения ответа
const gptResponse = async (text) => {
    const messages = [
        {
            role: "system",
            content: prompt,
        },
        {
            role: "user",
            content: text,
        },
    ];

    const response = await axios.post(
        "https://api.openai.com/v1/chat/completions",
        {
            model: "gpt-4o-mini",
            messages,
        },
        {
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${OPENAI_API_KEY}`,
            },
        }
    );


    const answer = response.data.choices[0].message.content;

    return answer;
};

// Обработка входящих сообщений
client.on("message", async (msg) => {
    resetCountersIfNeeded(); // Проверяем, нужно ли сбрасывать счетчики
    const chatId = msg.from;
    const message = msg.body;
    const CLIENT_NUMBER = chatId.slice(0, 11);

    const chat = await Chat.findOne({chatId})

    if (chat) {
        return
    }

    let user = await User.findOne({ chatId });

    if (!message || message.trim() === "") {
        return client.sendMessage(chatId, "Пожалуйста, отправьте сообщение.");
    }

    if (!user) {
        user = new User({ chatId });
        await user.save();
    }
    
    if (msg.body.toLowerCase() === "проверка") {
        // Если пользователь отправил "Проверка", возвращаем количество пользователей и сообщений
        const response = `Написали: ${uniqueUsersToday.size}.\nTelegram: ${messagesToTelegramToday}.`;
        client.sendMessage(chatId, response);
        return;
    }
    if (msg.hasMedia) {
        const media = await msg.downloadMedia();

        if (media.mimetype.startsWith("audio/")) {
            // Генерация уникального имени файла
            const filePath = path.join(__dirname, `/whatsAppAudio/audio_${Date.now()}.ogg`);

            // Записываем файл на диск
            fs.writeFileSync(filePath, media.data, { encoding: "base64" });

            console.log(`Аудиосообщение сохранено как ${filePath}`);
            const CLIENT_NUMBER = chatId.slice(0, 11);
            const CLIENT_MESSAGE = `Клиент отправил аудио сообщение:\nНомер клиента: +${CLIENT_NUMBER}\nhttps://wa.me/${CLIENT_NUMBER}`;

            // Отправляем аудиосообщение в Telegram
            sendAudioToTelegram(filePath, CLIENT_MESSAGE);
        } else {
            client.sendMessage(
                chatId,
                "К сожалению я не могу просматривать изображения, напишите ваш запрос или же отпарьте аудио сообщение."
            );
        }

    } else if (msg.body) {
        if (
            msg.body.toLowerCase().includes("кана") ||
            msg.body.toLowerCase().includes("канат") ||
            msg.body.toLowerCase().includes("қанат")
        ) {
            const message =
                "Что бы связаться с Канатом прошу вас перейти по этой ссылке:\n\nhttps://wa.me/77015315558";
            client.sendMessage(chatId, message);

            saveMessageToHistory(chatId, message, "assistant");
        } else if (msg.body.toLowerCase().includes("счет") || msg.body.toLowerCase().includes("счёт")) {
            const CLIENT_MESSAGE = `Клиент отправил запрос на счет на оплату:\nНомер клиента: +${CLIENT_NUMBER}\nhttps://wa.me/${CLIENT_NUMBER}`;
            await sendMessageToTelegram(CLIENT_MESSAGE)

            client.sendMessage(chatId, "В ближайшее время с вами свяжется менеджер для выставления счета.");

        } else {
            const answer = await gptResponse(msg.body);
            
            const isKZ = answer.toLocaleLowerCase().includes("kz")
            const isEN = answer.toLocaleLowerCase().includes("en")

            if (isKZ) {
                user.language = "kz"
                await user.save()
            } else if (isEN) {
                user.language = "en"
                await user.save()
            } else {
                user.language = "ru"
                await user.save()
            }

            const match = answer.match(/\d+/g);
            const scriptIndex = match ? parseInt(match[0], 10) : null;

            const isFirstMessageToday = !uniqueUsersToday.has(chatId);
    
            if (isFirstMessageToday && !scriptIndex) {
                uniqueUsersToday.add(chatId);
                const script = isKZ ? kzScripts[0] : isEN ? enScripts[0] : scripts[0]; // Получаем соответствующий скрипт из массива
                await client.sendMessage(chatId, script); // Отправляем приветственное сообщение
                return; // Завершаем обработку, так как ответ уже отправлен
            }
            
            if (scriptIndex && scriptIndex === 4) {
                const CLIENT_MESSAGE = `Клиент спршивает по поводу доставки: +${CLIENT_NUMBER}\nhttps://wa.me/${CLIENT_NUMBER}`;
                await sendMessageToTelegram(CLIENT_MESSAGE)
                const script = isKZ ? kzScripts[scriptIndex] : isEN ? enScripts[scriptIndex] : scripts[scriptIndex];
                await client.sendMessage(chatId, script);
                return
            }
            if (scriptIndex && scriptIndex === 5) {
                const CLIENT_MESSAGE = `Клиент хочет поменять дату доставки: +${CLIENT_NUMBER}\nhttps://wa.me/${CLIENT_NUMBER}`;
                await sendMessageToTelegram(CLIENT_MESSAGE)
                const script = isKZ ? kzScripts[scriptIndex] : isEN ? enScripts[scriptIndex] : scripts[scriptIndex];
                await client.sendMessage(chatId, script);
                return
            }
            if (scriptIndex) {
                const script = isKZ ? kzScripts[scriptIndex] : isEN ? enScripts[scriptIndex] : scripts[scriptIndex]; // Получаем соответствующий скрипт из массива
                if (script) {
                    await client.sendMessage(chatId, script);
                } else {
                    if (user?.language === "kz") {
                        await client.sendMessage(chatId, "Сұрақты түсінбедім, нақтылап жазсаңыз.")
                    } else if (user?.language === "en") {
                        await client.sendMessage(chatId, "I didn't understand the question, please clarify.")
                    } else {
                        await client.sendMessage(chatId, "Не понял вопроса, уточните, пожалуйста.")
                    }
                }
            } else {
                if (user?.language === "kz") {
                    await client.sendMessage(chatId, "Сұрақты түсінбедім, нақтылап жазсаңыз.")
                } else if (user?.language === "en") {
                    await client.sendMessage(chatId, "I didn't understand the question, please clarify.")
                } else {
                    await client.sendMessage(chatId, "Не понял вопроса, уточните, пожалуйста.")
                }
            }
        }
    }
});

async function sendMessageToTelegram(CLIENT_MESSAGE) {
    const CHAT_ID = "-1002433505684";
    axios
        .post(
            url,
            new URLSearchParams({
                chat_id: CHAT_ID,
                text: CLIENT_MESSAGE,
            }).toString(),
            {
                headers: {
                    "Content-Type":
                        "application/x-www-form-urlencoded",
                },
            }
        )
        .then((response) => {
            console.log(
                "Message sent successfully:",
                response.data
            );
        })
        .catch((error) => {
            console.error("Error sending message:", error);
        });
}

async function sendAudioToTelegram(filePath, CLIENT_MESSAGE) {
    const formData = new FormData();
    formData.append("chat_id", "-1002433505684"); // ID чата
    formData.append("caption", CLIENT_MESSAGE)
    formData.append("audio", fs.createReadStream(filePath)); // Передаем аудиофайл

    try {
        const response = await axios.post(
            `https://api.telegram.org/bot${process.env.TOKEN}/sendAudio`,
            formData,
            {
                headers: formData.getHeaders(),
            }
        );
        fs.unlinkSync(filePath);
        messagesToTelegramToday++;
    } catch (error) {
        console.error("Ошибка при отправке аудио в Telegram:", error);
    }
}


client.initialize();