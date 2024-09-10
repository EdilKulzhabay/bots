const { Client, LocalAuth } = require("whatsapp-web.js");
const qrcode = require("qrcode-terminal");
const { OpenAIApi, Configuration } = require("openai");
require("dotenv").config();
const path = require("path");
const { default: axios } = require("axios");
const url = `https://api.telegram.org/bot${process.env.TOKEN}/sendMessage`;

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
        "Приветствие: Здравствуйте! Вы обратились в компанию ‘Тибетская’. Мы рады вам помочь! Какой у вас вопрос или заказ?\n1. Если бот не знает, первый ли это заказ клиента: Вы заказываете у нас воду в первый раз? Ответьте «да» или «нет».\nЕсли клиент ответит «да»: Пожалуйста, проверьте маркировку на дне ваших бутылей. В треугольнике должна быть цифра:\n7 — это поликарбонат, мы можем принять такой бутыль.\n1 — это ПЭТ (полиэтилентерефталат), такие бутыли мы не принимаем.\nЕсли маркировки нет, это чаще всего ПЭТ-бутыль. Если у вас нет подходящих бутылей, вы можете приобрести поликарбонатную бутыль за 4500 тенге.\nЕсли клиент ответит «нет»: Отлично! Напомните, пожалуйста, сколько бутылей вам нужно и на какой адрес доставить.\n2. Если клиент интересуется временем доставки: Мы можем позвонить вам за час до того, как курьер приедет. Если ваш адрес находится в непосредственной близости от аквамаркета ‘Тибетская’, доставка может быть выполнена за час. Ближайший аквамаркет вы можете найти по ссылке: https://2gis.kz/almaty/search/аквамаркет%20тибетская/firm/70000001035554407/76.896472%2C43.168567.\n3. Если клиент интересуется ценами: Стоимость одного бутыля воды объемом 18,9 литра — 1300 тенге. Если у вас есть наши бутыли, обмен бесплатный. Если же нужно приобрести бутыль, стоимость поликарбонатной тары — 4500 тенге. Минимальный заказ — 2 бутыля.\n4. Если клиент запрашивает замену ПЭТ-бутылей: К сожалению, мы больше не принимаем ПЭТ-бутыли. Однако, если у вас есть наша ПЭТ-бутыль, мы можем заменить её бесплатно на поликарбонатную. Чужие ПЭТ-бутыли мы не принимаем.\n5. Если клиент запрашивает документы или договор: Мы работаем с компаниями и предоставляем все необходимые документы для бухгалтерии, включая счет-фактуру и договор. Уточните, пожалуйста, данные вашей компании для оформления.\n6. Напоминание о доставке: Мы доставим ваш заказ в ближайшее время. Подтвердите, пожалуйста, количество бутылей и адрес доставки.\n7. Напоминание о доставке: Мы доставим ваш заказ в ближайшее время. Подтвердите, пожалуйста, ваш заказ, указав количество бутылей и адрес доставки. Для вопросов звоните нашему менеджеру по номеру +77475315558.\n8.всегда запрашивай клиента в конце для подтверждения заказа клиент должен отправить 'ок'.\n9. Если вышли проблемы с заказом: Наш менеджер всегда на связи: +77475315558.",
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
                "Составь краткое содержание диалога. Сначала укажи количество бутылей в формате: 'Количество бутылей: [цифра]', затем укажи адрес в формате: 'Адрес: [адрес]', а после этого продолжай краткое содержание.",
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
    const chatId = msg.from;

    // Сохраняем сообщение пользователя в историю
    saveMessageToHistory(chatId, msg.body, "user");

    if (msg.body) {
        if (
            msg.body.toLowerCase() === "ок" ||
            msg.body.toLowerCase() === "ok"
        ) {
            const CHAT_ID = "-1002433505684";
            const CLIENT_NUMBER = chatId.slice(0, 11);

            let dialog = "\n";

            chatHistories[chatId].forEach((message) => {
                if (message.role === "user") {
                    dialog += `клиент: ${message.content}\n`;
                } else if (message.role === "assistant") {
                    dialog += `бот: ${message.content}\n`;
                }
            });

            const summary = await getSummary(dialog);

            const CLIENT_MESSAGE = `Клиент отправил запрос на заказ:\nНомер клиента: +${CLIENT_NUMBER}\n${summary}`;

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
        client.sendMessage(chatId, gptResponse);

        // Сохраняем ответ бота в историю
        saveMessageToHistory(chatId, gptResponse, "assistant");
        if (
            msg.body.toLowerCase() === "ок" ||
            msg.body.toLowerCase() === "ok"
        ) {
            chatHistories[chatId] = [];
        }
    }
});

client.initialize();
