const { Client, LocalAuth } = require("whatsapp-web.js");
const qrcode = require("qrcode-terminal");
const { OpenAIApi, Configuration } = require("openai");
require("dotenv").config();
const path = require("path");
const { default: axios } = require("axios");
const url = `https://api.telegram.org/bot${process.env.TOKEN}/sendMessage`;
const fs = require("fs");
const FormData = require('form-data');

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
        "Приветствие: Здравствуйте! Я бот «Тибетская». Чем могу помочь? Заказ воды: Пожалуйста, укажите ваш точный адрес и количество бутылей. Примечание для бота: Если клиент не указывает тип бутыли, по умолчанию считать 18,9 л Поликарбонат. Подтверждение заказа: Повторите детали заказа для подтверждения. Например: 'Ваш заказ: 4 бутыли воды «Тибетская» объёмом 18,9 л по адресу [адрес]. Подтверждаете?' Если клиент подтверждает, ответьте: 'Спасибо, ваш заказ принят! Рахмет, заказыңыз қабылданды. Наш курьер свяжется с вами за час до доставки.' Дополнительные товары: Стаканы и кулеры: tibetskaya.kz/accessories.Чистка кулера: От 4000 тенге. При заказе воды — скидка 50%.График работы: Пн–Сб, 8:00–22:00. Вс — выходной. Контакты: Вопросы? Менеджер: +7 747 531 55 58.",
};

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

async function getSummary(dialog) {
    let attempts = 0;
    const maxAttempts = 3; // Максимум 3 попытки
    const retryDelay = 3000; // 3 секунды между попытками

    // Добавляем системное сообщение перед историей
    const messages = [
        {
            role: "system",
            content:
                "Составь краткое содержание диалога. Сначала укажи количество бутылей в формате: 'Количество больших: [цифра]'\n 'Количество маленьких: [цифра]', затем укажи адрес в формате: 'Адрес: [адрес]', затем укажи в первый ли раз заказывает клиент в формате: 'Первый: [да/нет]', затем укажи в есть ли бутыли у клиента в формате: 'Бутыли: [имеются/не имеются]'",
        },
        {
            role: "user",
            content: dialog,
        },
    ];

    while (attempts < maxAttempts) {
        try {
            const response = await openai.createChatCompletion({
                model: "gpt-4",
                messages: messages,
                max_tokens: 300,
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

// Обработка входящих сообщений
client.on("message", async (msg) => {
    resetCountersIfNeeded(); // Проверяем, нужно ли сбрасывать счетчики
    const chatId = msg.from;

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

                if (day === 0 || (day === 6 && hour >= 18)) {
                    client.sendMessage(chatId, "Спасибо! Ваш заказ принят на понедельник. Наш курьер свяжется с вами за час до доставки. Если у вас есть дополнительные вопросы или запросы, обязательно дайте мне знать!");
                    saveMessageToHistory(chatId, "Спасибо! Ваш заказ принят на понедельник. Наш курьер свяжется с вами за час до доставки. Если у вас есть дополнительные вопросы или запросы, обязательно дайте мне знать!", "assistant");
                } else if (hour >= 18) {
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