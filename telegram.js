const TelegramBot = require("node-telegram-bot-api");
const { OpenAIApi, Configuration } = require("openai");
require("dotenv").config();

// Инициализация OpenAI API
const configuration = new Configuration({
    apiKey: process.env.OPENAI_API_KEY,
});
const openai = new OpenAIApi(configuration);

// Инициализация Telegram бота
const bot = new TelegramBot(process.env.TELEGRAM_API_KEY, { polling: true });

// Функция для обращения к GPT и получения ответа
async function getGPTResponse(prompt) {
    let attempts = 0;
    const maxAttempts = 3;
    const retryDelay = 3000;

    while (attempts < maxAttempts) {
        try {
            const response = await openai.createChatCompletion({
                model: "gpt-4",
                messages: [
                    {
                        role: "system",
                        content:
                            "Ты менеджер, тебя зовут Канат. Тибетская вода продает воду (0.5L,1L,2L,5L,12L,19L) и предлагает франшизы:\n1. Эконом (1 млн KZT:бренд,вода 0.5L-5L по себестоимости, CRM.\n2.VIP (5 млн KZT):вода 12L-19L,CRM,база клиентов, 100 бутылей, футболки, тележка, баннеры,лэндинг, поддержка.\nСайт: tibetskaya.kz\nТелефон: +7(701)5315558\nInstagram: @tibetian_water\nБот: t.me/tibetskayaBot\nДоставка:1 час в городе, за городом —в течение дня.\nЦены: 12L—700тг, 19L—1100 тг.\nЕсли задержка воды — извинитесь, дайте контактный номер и сообщите, что скоро свяжутся.\nОборот франшизы:3млн KZT за 3 месяца.",
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
bot.on("message", async (msg) => {
    const chatId = msg.chat.id;

    if (msg.text) {
        if (
            msg.text.toLowerCase() === "привет" ||
            msg.text.toLowerCase() === "здравствуйте"
        ) {
            bot.sendMessage(
                chatId,
                "Здравствуйте! Я бот-консультант. Задайте мне любой вопрос."
            );
        } else {
            const gptResponse = await getGPTResponse(msg.text);
            bot.sendMessage(chatId, gptResponse);
        }
    }
});

console.log("Telegram bot is running...");
