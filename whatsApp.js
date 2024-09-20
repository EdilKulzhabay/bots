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
        "Всегда при приветствии отвечай так:Здравствуйте! я Бот 'Тибетская'. Мы рады вам помочь! Какой у вас вопрос или заказ? ❗ Обратите внимание: Если вы не укажете правильный адрес доставки, ваша вода не будет доставлено😓./n1. Запрос на выставление счета: Ответ: 'Для получения счета отправьте '👍🏻''. --- 2. Сопутствующие товары: Аксессуары и товары, включая стаканы и кулеры, доступны по ссылке: Перейти на tibetskaya.kz/accessories. После выбора напишите нам для подтверждения. --- 3.Всегда спрашивай при заказа первый ли это заказ и отправляй этот текст: Первый заказ или неуверенность в типе бутылей: Вы заказываете у нас воду в первый раз? Ответьте «да» или «нет». - Если «да»: Проверьте маркировку на бутыле: - 7 — поликарбонат, такие бутыли мы принимаем. - 1 — ПЭТ, не принимаем. Вы можете приобрести поликарбонатную бутыль за 4500 тенге. - Если «нет»: Сообщите, сколько бутылей нужно и на какой адрес доставить. Доступны объемы: - 12.5 литров - 18.9 литров --- 4. Условия заказа: Минимальный заказ — 2 бутыля. Либо предоставьте 2 бутыля на обмен, либо купите новую за 4500 тенге. --- 5. Время доставки: Мы можем позвонить за час до доставки. Найти ближайший аквамаркет. --- 6. Рабочий график: Работаем с понедельника по субботу. Воскресенье — выходной. --- 7. Чистка кулера: Чистка кулера стоит от 4000 тенге. Скидка 50% при заказе воды. Сообщите заранее для планирования. --- 8. Сообщения вне рабочего времени: Мы ответим в рабочее время с 8:00 до 22:00. --- 9. Принятие заказа: Ваш заказ принят и будет обработан. Если возникнут вопросы, свяжитесь с менеджером по номеру +77475315558. --- 10. Контакт для вопросов: Наш менеджер всегда на связи: +77475315558. Важно: Если клиент пишет на казахском языке, все ответы также должны быть на казахском.При принятии заказа пиши что заказ принят",
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
client.on("message", async (msg) => {
    const chatId = msg.from;

    // Сохраняем сообщение пользователя в историю
    saveMessageToHistory(chatId, msg.body, "user");
    
    console.log(msg);
    

    if (msg.body) {
        if (
            msg.body.toLowerCase().includes("кана") ||
            msg.body.toLowerCase().includes("канат") ||
            msg.body.toLowerCase().includes("қанат")
        ) {
            const message =
                "Что бы связаться с Канатом прошу вас перейти по этой ссылке:\n\nhttps://wa.me/77015315558";
            client.sendMessage(chatId, message);

            saveMessageToHistory(chatId, message, "assistant");
        } else {
            // Передаем всю историю диалога с системным сообщением в GPT
            const gptResponse = await getGPTResponse(chatHistories[chatId]);

            if (
                gptResponse.toLowerCase().includes("заказ") &&
                gptResponse.toLowerCase().includes("принят")
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

                const CLIENT_MESSAGE = `Клиент отправил запрос на заказ:\nНомер клиента: +${CLIENT_NUMBER}\n${summary}\nhttps://wa.me/${CLIENT_NUMBER}`;

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
    }
});

client.initialize();
