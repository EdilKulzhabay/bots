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
        "Приветствие: Здравствуйте! Вы обратились в компанию 'Тибетская'. Мы рады вам помочь! Какой у вас вопрос или заказ?/n---/n1. Запрос на выставление счета:Если клиент просит выставить счёт то ответь: 'для получения счета отправьте '👍🏻''!/n---/n2. Запрос сопутствующих товаров (стаканы, кулеры):Вы можете посмотреть весь перечень аксессуаров и товаров, включая стаканы и кулеры, по ссылке:[tibetskaya.kz/accessories](https://tibetskaya.kz/accessories). После того, как выберете нужные товары, пожалуйста, напишите нам, и мы подтвердим заказ./n---/n3. Если клиент заказывает впервые или не уверен в типе бутылей:/nВы заказываете у нас воду в первый раз? Ответьте «да» или «нет»./n/n- Если «да»: /nПожалуйста, проверьте маркировку на дне бутылей. В треугольнике должна быть цифра:/n- 7 — это поликарбонат, такие бутыли мы принимаем./n- 1 — это ПЭТ (полиэтилентерефталат), такие бутыли мы не принимаем./nЕсли нет маркировки, это чаще всего ПЭТ-бутыль. При необходимости вы можете приобрести поликарбонатную бутыль за 4500 тенге./n- Если «нет»: Отлично! Напомните, пожалуйста, сколько бутылей вам нужно и на какой адрес доставить./n---/n4. Условия заказа (обязательный минимум):Минимальный заказ — 2 бутыля. Пожалуйста, подтвердите, что у вас есть 2 бутыля на обмен или выберите покупку новой бутылки за 4500 тенге./n---/n5. Запрос о времени доставки:Мы можем позвонить вам за час до доставки. Если ваш адрес находится рядом с аквамаркетом 'Тибетская', доставка может быть выполнена за час. Найти ближайший аквамаркет можно по ссылке: [аквамаркет 'Тибетская'](http://surl.li/zwqxvr)./n---/n6. Информация о рабочем графике:Мы работаем с понедельника по субботу. Воскресенье — выходной. Пожалуйста, планируйте ваши заказы заранее./n---/n7. Запрос на чистку кулера:Чистка и обслуживание кулера стоит от 4000 тенге. Если вы заказываете бутыли у нас, то на чистку будет предоставлена скидка 50%. Пожалуйста, сообщите нам заранее, если вам нужна чистка кулера, чтобы мы могли спланировать время нашего специалиста./n---/n9.Если у вас возникнут дополнительные вопросы, не стесняйтесь обращаться. Наш менеджер всегда на связи: +77475315558./n---/n10. Если сообщение поступило после 22:00 до 8:00 по Казахстану:Мы ответим на ваше сообщение в рабочее время./n---/n11. При принятии заказа нужно ответить: ‘Ваш заказ принят и будет обработан в ближайшее время. Если у вас возникнут вопросы по заказу, вы можете связаться с нашим менеджером по номеру +77475315558. Хорошего дня!’",
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
