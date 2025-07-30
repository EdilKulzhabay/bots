const { Client, LocalAuth } = require("whatsapp-web.js");
const qrcode = require("qrcode-terminal");
const { OpenAIApi, Configuration } = require("openai");
require("dotenv").config();
const path = require("path");
const { default: axios } = require("axios");
const url = `https://api.telegram.org/bot${process.env.TOKEN}/sendMessage`;
const fs = require("fs");
const FormData = require('form-data');
const mongoose = require("mongoose")
const Chat = require("./Chat")

const OPENAI_API_KEY = process.env.OPENAI_API_KEY

mongoose
    .connect("mongodb://localhost:27017/BotTibetskaya")
    .then(() => {
        console.log("Mongodb OK");
    })
    .catch((err) => {
        console.log("Mongodb Error", err);
    });

    // Инициализация OpenAI API
const configuration = new Configuration({
    apiKey: process.env.OPENAI_API_KEY,
});
const openai = new OpenAIApi(configuration);

// Убедитесь, что путь к сессии корректный
const client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: {
        headless: true, // Убедитесь, что Puppeteer работает в headless режиме
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-gpu',
            '--single-process',
            '--memory-pressure-off',
            '--disable-background-timer-throttling',
            '--disable-breakpad'
        ],
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

// Хранилище для истории сообщений
const chatHistories = {};

// Системный промпт для установки контекста диалога
const systemMessage = {
    role: "system",
    content:
        "Здравствуйте! Я бот воды «Тибетская». Чем могу помочь? Воскресенье не работаем и не доставляем!!! Заказ воды: Укажите адрес и количество бутылей (минимум 2). Мы предлагаем бутыли объёмом 18,9 л и 12,5 л. Цена бутыля 2500₸. Цены на воду: 18,9 л — 1300₸, 12,5 л — 900₸. Подтверждение заказа: Пример: «Ваш заказ: 4 бутыли 18,9 л по адресу [адрес]. Подтверждаете?» При подтверждении: «Спасибо! Курьер свяжется за час до доставки.» Дополнительные товары: Сайт: tibetskaya.kz/accessories. Чистка кулера: От 4000₸, скидка 50% при заказе воды. Мы работаем: Пн–Сб: 8:00–22:00, Вс: выходной. Контакты: Менеджер: 8 747 531 55 58",
};

const addChat = async (chatId) => {
    const chat = new Chat({
        chatId
    });

    await chat.save();
}

const removeChat = async (chatId) => {
    await Chat.deleteOne({ chatId });
}

client.on('message_create', (msg) => {
    if (msg.fromMe) {
        const chatId = msg.to;

        if (msg.body.toLocaleLowerCase().includes("отключить бота")) {
            addChat(chatId);
        }

        if (msg.body.toLocaleLowerCase().includes("включить бота")) {
            removeChat(chatId);
        }
    }
});

let uniqueUsersToday = new Set(); // Хранит уникальные ID пользователей за сегодня
let messagesToTelegramToday = 0; // Количество сообщений, отправленных в Telegram сегодня
let lastCheckDate = new Date().toLocaleDateString(); // Последняя дата для сброса
function resetCountersIfNeeded() {
    const currentDate = new Date().toLocaleDateString();
    if (lastCheckDate !== currentDate) {
        uniqueUsersToday.clear();
        messagesToTelegramToday = 0;
        lastCheckDate = currentDate;
    }
}

async function getGPTResponse(chatHistory) {
    let attempts = 0;
    const maxAttempts = 3; // Максимум 3 попытки
    const retryDelay = 3000; // 3 секунды между попытками

    // Добавляем системное сообщение перед историей
    const messages = [systemMessage, ...chatHistory];

    while (attempts < maxAttempts) {
        try {
            const response = await openai.createChatCompletion({
                model: "gpt-4",
                messages: messages, // передаем системное сообщение и всю историю диалога
                max_tokens: 500,
                temperature: 0.7,
            });
            return response.data.choices[0].message.content.trim();
        } catch (error) {
            if (error.response && error.response.status === 429) {
                console.log("Превышен лимит запросов, повторная попытка...");
                attempts++;
                await new Promise((resolve) => setTimeout(resolve, retryDelay));
            } else {
                console.error("Ошибка при обращении к OpenAI:", error);
                return "Извините, произошла ошибка при обработке вашего запроса.";
            }
        }
    }
    return "Извините, превышен лимит попыток обращения к OpenAI.";
}


// Функция для сохранения сообщения в историю
function saveMessageToHistory(chatId, message, role) {
    if (!chatHistories[chatId]) {
        chatHistories[chatId] = [];
    }

    // Сохраняем новое сообщение в виде объекта с ролью
    chatHistories[chatId].push({
        role: role,
        content: message,
    });

    // Оставляем только последние 8 пар сообщений (16 сообщений всего)
    if (chatHistories[chatId].length > 10) {
        chatHistories[chatId].shift(); // Удаляем самое старое сообщение, если больше 16
    }
}

// Обработка входящих сообщений
client.on("message", async (msg) => {
    resetCountersIfNeeded(); // Проверяем, нужно ли сбрасывать счетчики
    const chatId = msg.from;

    const chat = await Chat.findOne({chatId})

    if (chat) {
        return
    }

    // Добавляем пользователя в список уникальных за день
    uniqueUsersToday.add(chatId);
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
        saveMessageToHistory(chatId, msg.body, "user");
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
            const CHAT_ID = "-1002433505684";
            const CLIENT_NUMBER = chatId.slice(0, 11);
            const CLIENT_MESSAGE = `Клиент отправил запрос на счет на оплату:\nНомер клиента: +${CLIENT_NUMBER}\nhttps://wa.me/${CLIENT_NUMBER}`;

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

            client.sendMessage(chatId, "В ближайшее время с вами свяжется менеджер для выставления счета.");

            // Сохраняем ответ бота в историю
            saveMessageToHistory(chatId, "В ближайшее время с вами свяжется менеджер для выставления счета.", "assistant");
        } else {
            // Передаем всю историю диалога с системным сообщением в GPT
            const gptResponse = await getGPTResponse(chatHistories[chatId]);

            if (
                (gptResponse.toLowerCase().includes("заказ") &&
                gptResponse.toLowerCase().includes("принят")) || (gptResponse.toLowerCase().includes("заказыңыз") &&
                gptResponse.toLowerCase().includes("қабылданды"))
            ) {
                const date = new Date()
                const day = date.getDay()
                const hour = date.getHours()

                if (day === 0 || (day === 6 && hour >= 12)) {
                    client.sendMessage(chatId, "Спасибо! Ваш заказ принят на понедельник. Наш курьер свяжется с вами за час до доставки. Если у вас есть дополнительные вопросы или запросы, обязательно дайте мне знать!");
                    saveMessageToHistory(chatId, "Спасибо! Ваш заказ принят на понедельник. Наш курьер свяжется с вами за час до доставки. Если у вас есть дополнительные вопросы или запросы, обязательно дайте мне знать!", "assistant");
                } else if (hour >= 12) {
                    client.sendMessage(chatId, "Спасибо! Ваш заказ принят на завтра. Наш курьер свяжется с вами за час до доставки. Если у вас есть дополнительные вопросы или запросы, обязательно дайте мне знать!");
                    saveMessageToHistory(chatId, "Спасибо! Ваш заказ принят на завтра. Наш курьер свяжется с вами за час до доставки. Если у вас есть дополнительные вопросы или запросы, обязательно дайте мне знать!", "assistant");
                } else {
                    client.sendMessage(chatId, gptResponse);
                    saveMessageToHistory(chatId, gptResponse, "assistant");
                }
            } else {
                // Отправляем ответ пользователю
                client.sendMessage(chatId, gptResponse);

                // Сохраняем ответ бота в историю
                saveMessageToHistory(chatId, gptResponse, "assistant");
            }
        }
    }
});

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