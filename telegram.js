const TelegramBot = require("node-telegram-bot-api");
const { OpenAIApi, Configuration } = require("openai");
require("dotenv").config();
const { default: axios } = require("axios");
const url = `https://api.telegram.org/bot${process.env.TOKEN}/sendMessage`;

// Инициализация OpenAI API
const configuration = new Configuration({
    apiKey: process.env.OPENAI_API_KEY,
});
const openai = new OpenAIApi(configuration);

// Инициализация Telegram бота
const bot = new TelegramBot(process.env.TELEGRAM_API_KEY, { polling: true });

// Хранилище для истории сообщений
const chatHistories = {};

// Системный промпт для установки контекста диалога
const systemMessage = {
    role: "system",
    content:
        "Приветствие: Здравствуйте! Я Бот 'Тибетская'. Чем можем помочь?Укажите точный адрес для доставки воды.1.Товары: Стаканы и кулеры — tibetskaya.kz/accessories. Напишите для подтверждения.2.Первый заказ: Это первый заказ? Ответьте «да» или «нет».Если «да»: Поликарбонат (7) принимаем, ПЭТ (1) не принимаем. Бутыль стоит 4500 тенге.Если «нет»: Укажите количество бутылей и адрес.3.Минимальный заказ: 2 бутыля. Либо обмен, либо покупка новой за 4500 тенге.4.Доставка: Звоним за час до доставки.5.График работы: Пн–Сб, Вс — выходной.6.Чистка кулера: От 4000 тенге, скидка 50% при заказе воды.7.Вне рабочего времени: Ответим с 8:00 до 22:00.8.Принятие заказа: Заказ принят, свяжитесь с менеджером по +77475315558.10.Контакт: Менеджер: +77475315558.11.Цена за 12.5л.(маленьких) 900 тенге, за 18.9л.(больших) 1300 тенге.",
};

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
bot.on("message", async (msg) => {
    const chatId = msg.from.id;

    
    if (msg.text) {
        saveMessageToHistory(chatId, msg.text, "user");
        if (
            msg.text.toLowerCase().includes("кана") ||
            msg.text.toLowerCase().includes("канат") ||
            msg.text.toLowerCase().includes("қанат")
        ) {
            const message =
                "Что бы связаться с Канатом прошу вас перейти по этой ссылке:\n\nhttps://wa.me/77015315558";
            bot.sendMessage(chatId, message);

            saveMessageToHistory(chatId, message, "assistant");
        } else if (msg.body.toLowerCase().includes("счет") || msg.body.toLowerCase().includes("счёт")) {
            const CHAT_ID = "-1002433505684";
            const CLIENT_NAME = msg.from.username;
            const CLIENT_MESSAGE = `Клиент отправил запрос на счет на оплату:\nИмя клиента: +${CLIENT_NAME}\nhttps://t.me/${CLIENT_NAME}`;

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

                bot.sendMessage(chatId, "В ближайшее время с вами свяжется менеджер для выставления счета.");

                // Сохраняем ответ бота в историю
                saveMessageToHistory(chatId, "В ближайшее время с вами свяжется менеджер для выставления счета.", "assistant");
        } else {
            // Передаем всю историю диалога с системным сообщением в GPT
            const gptResponse = await getGPTResponse(chatHistories[chatId]);

            if (
                gptResponse.toLowerCase().includes("заказ") &&
                gptResponse.toLowerCase().includes("принят")
            ) {
                const CHAT_ID = "-1002433505684";
                const CLIENT_NAME = msg.from.username;

                let dialog = "\n";

                chatHistories[chatId].forEach((message) => {
                    if (message.role === "user") {
                        dialog += `клиент: ${message.content}\n`;
                    } else if (message.role === "assistant") {
                        dialog += `бот: ${message.content}\n`;
                    }
                });

                const summary = await getSummary(dialog);

                const CLIENT_MESSAGE = `Клиент отправил запрос на заказ:\nИмя клиента: ${CLIENT_NAME}\n${summary}\nhttps://t.me/${CLIENT_NAME}`;

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
                bot.sendMessage(chatId, gptResponse);

                // Сохраняем ответ бота в историю
                saveMessageToHistory(chatId, gptResponse, "assistant");
            }
        }
    }
});

console.log("Telegram bot is running...");
