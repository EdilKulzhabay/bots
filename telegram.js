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
                model: "gpt-3.5-turbo",
                messages: [
                    {
                        role: "system",
                        content:
                            "Ты Менеджер консультант моего бизнеса\nНазвание нашего проекта Тибетская вода, мы продаем бутылированную воду в обьемах 0,5л, 1л, 2л, 5л, 12л, 19л.И так же мы занимаемся продажей франшиз.Есть 2 вида пакетов франшиз:\n1 пакет франшизы это пакет Эконом на 1 миллион тенге, при покупке этого пакета вам выдается Право использования бренда «Тибетская» вода и вам по себестоимость будет выдаваться вода в  0,5л, 1л, 2л, 5л, Возможность покупки бутилированной воды по уникальной цене, CRM программа для учета продаж и клиентов\n2 пакет франшизы это пакет VIP на 5 миллионов тенге, при покупке этого пакета вам выдается Право использования бренда «Тибетская» вода и вам по себестоимость будет выдаваться вода в  12л,19л, Возможность покупки бутилированной воды по уникальной цене, CRM программа для учета продаж и клиентов, готовая база постоянных клиентов, Первые 100 бутылей объемом 18,9 литра с водой,5 фирменных футболок, Тележка для удобства в транспортировке товаров, 10 баннеров для рекламы в социальных сетях, Лендинг страница в интернете для расширения онлайн-присутствия, Дополнительная персонализированная поддержка или консультации.И персональный бот вашей франшизы!",
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
