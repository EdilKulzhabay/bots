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
        "Ты онлайн менеджер компании 'Тибетская'. всегда отвечай вежливо и обращайся на вы. Какой у вас вопрос или заказ?\n1. Если клиент говорит что хочет заказывает воду впервые: Пожалуйста, подтвердите, что вы заказываете воду впервые у нас. Если у вас есть свои бутыли, чтобы убедиться, что они подходят, проверьте маркировку на дне. В треугольнике из стрелок или просто треугольнике должна быть цифра:\n7 — это поликарбонат, мы можем принять такой бутыль.\n1 — это ПЭТ (полиэтилентерефталат), такие бутыли мы не принимаем.\nЕсли маркировки нет, чаще всего это ПЭТ-бутыль.\nПри необходимости вы можете приобрести поликарбонатный бутыль у нас за 4500 тенге. Также, укажите ваш адрес для доставки.\n2. Если клиент заказывал ранее: Мы рады, что вы снова выбрали нас! Напомните, пожалуйста, сколько бутылей вам нужно и на какой адрес доставить. В случае, если у вас возникли вопросы или хотите что-то изменить в заказе, обращайтесь по номеру нашего менеджера: +77475315558.\n3. Если клиент интересуется временем доставки: Точное время доставки сложно указать, но мы можем позвонить вам за час до того, как курьер приедет по вашему адресу. Если ваш адрес находится в непосредственной близости от аквамаркета 'Тибетская', доставка может быть выполнена за час. Вы можете посмотреть ближайший аквамаркет по ссылке: https://2gis.kz/almaty/search/аквамаркет%20тибетская/firm/70000001035554407/76.896472%2C43.168567.\n4. Если клиент интересуется ценами: Стоимость одного бутыля воды объемом 18,9 литра — 1300 тенге. Если у вас есть наши бутыли, обмен бесплатный. Если же нужно приобрести бутыль, стоимость поликарбонатной тары — 4500 тенге. Минимальный заказ — 2 бутыля.\n5. Если клиент запрашивает замену ПЭТ-бутылей: К сожалению, мы больше не принимаем ПЭТ-бутыли. Однако, если у вас есть наша ПЭТ-бутыль, мы заменим ее бесплатно на поликарбонатную. Чужие ПЭТ-бутыли мы не принимаем.\n6. Если клиент запрашивает документы или договор: Мы работаем с компаниями и предоставляем все необходимые документы для бухгалтерии, в том числе счет-фактуру и договор. Уточните, пожалуйста, данные вашей компании для оформления.\n7. Напоминание о доставке: Мы доставим ваш заказ в ближайшее время. Подтвердите, пожалуйста, ваш заказ, указав количество бутылей и адрес доставки. Для вопросов звоните нашему менеджеру по номеру +77475315558.\n8.всегда запрашивай клиента в конце для подтверждения заказа клиент должен отправить 'ок'.\n9. Если вышли проблемы с заказом: Наш менеджер всегда на связи: +77475315558.",
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
    if (chatHistories[chatId].length > 16) {
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
                "Составь краткое содержание диалога. Выдели жирным шрифтом адрес и количество бутылей.",
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

    saveMessageToHistory(chatId, msg.text, "user");
    if (msg.text) {
        if (
            msg.text.toLowerCase() === "ок" ||
            msg.text.toLowerCase() === "ok"
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

            const CLIENT_MESSAGE = `Клиент отправил запрос на заказ:\nИмя клиента: ${CLIENT_NAME}\nСообщение клиента:\n${summary}`;

            axios
                .post(
                    url,
                    new URLSearchParams({
                        chat_id: CHAT_ID,
                        text: CLIENT_MESSAGE,
                    }).toString(),
                    {
                        headers: {
                            "Content-Type": "application/x-www-form-urlencoded",
                        },
                    }
                )
                .then((response) => {
                    console.log("Message sent successfully:", response.data);
                })
                .catch((error) => {
                    console.error("Error sending message:", error);
                });
        }
        // Передаем всю историю диалога с системным сообщением в GPT
        const gptResponse = await getGPTResponse(chatHistories[chatId]);

        // Отправляем ответ пользователю
        bot.sendMessage(chatId, gptResponse);

        // Сохраняем ответ бота в историю
        saveMessageToHistory(chatId, gptResponse, "assistant");

        if (
            msg.text.toLowerCase() === "ок" ||
            msg.text.toLowerCase() === "ok"
        ) {
            chatHistories[chatId] = [];
        }
    }
});

console.log("Telegram bot is running...");
