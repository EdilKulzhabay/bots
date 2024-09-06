const { Client, LocalAuth } = require("whatsapp-web.js");
const qrcode = require("qrcode-terminal");
const { OpenAIApi, Configuration } = require("openai");
require("dotenv").config();
const path = require("path");

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

// Функция для обращения к GPT и получения ответа
async function getGPTResponse(prompt) {
    let attempts = 0;
    const maxAttempts = 3; // Максимум 3 попытки
    const retryDelay = 3000; // 3 секунды между попытками

    while (attempts < maxAttempts) {
        try {
            const response = await openai.createChatCompletion({
                model: "gpt-4",
                messages: [
                    {
                        role: "system",
                        content:
                            "Ты Менеджер консультант моего бизнеса\nНазвание нашего проекта Тибетская вода, мы продаем бутылированную воду в обьемах 0,5л, 1л, 2л, 5л, 12л, 19л.И так же мы занимаемся продажей франшиз...",
                    },
                    { role: "user", content: prompt },
                ],
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

// Обработка входящих сообщений
client.on("message", async (msg) => {
    const chatId = msg.from;

    if (msg.body) {
        if (
            msg.body.toLowerCase() === "привет" ||
            msg.body.toLowerCase() === "здравствуйте"
        ) {
            client.sendMessage(
                chatId,
                "Здравствуйте! Я бот-консультант. Задайте мне любой вопрос!"
            );
        } else {
            const gptResponse = await getGPTResponse(msg.body);
            client.sendMessage(chatId, gptResponse);
        }
    }
});

client.initialize();
