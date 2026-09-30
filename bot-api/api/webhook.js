const crypto = require("node:crypto");

const TOPICS = Object.freeze({
  general: "Загальна консультація з головного екрана сайту",
  military: "Військові справи",
  inheritance: "Спадкові правовідносини",
  civil: "Цивільні справи",
  family: "Поділ майна та сімейні спори",
  court: "Представництво в судах",
});

const MAX_REQUEST_LENGTH = 600;

function secureEqual(left, right) {
  const leftBuffer = Buffer.from(String(left || ""));
  const rightBuffer = Buffer.from(String(right || ""));
  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function html(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function displayName(user = {}) {
  return [user.first_name, user.last_name].filter(Boolean).join(" ") || "(ім’я не вказано)";
}

async function telegram(method, payload) {
  const response = await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(6500),
  });
  const result = await response.json();
  if (!response.ok || !result.ok) throw new Error(`Telegram ${method} failed`);
  return result.result;
}

function topicName(code) {
  return Object.hasOwn(TOPICS, code) ? TOPICS[code] : TOPICS.general;
}

async function sendWelcome(chatId, source) {
  const policyUrl = process.env.PRIVACY_POLICY_URL;
  const topic = topicName(source);
  const keyboard = {
    inline_keyboard: [
      [{ text: "Погоджуюся передати запит адвокатці", callback_data: `consent:${Object.hasOwn(TOPICS, source) ? source : "general"}` }],
      [{ text: "Не передавати запит", callback_data: "decline" }],
      [{ text: "Політика приватності", url: policyUrl }],
    ],
  };
  await telegram("sendMessage", {
    chat_id: chatId,
    text: `Вітаю! Я помічник адвокатки Тетяни Герасимишиної.\n\nОбраний напрям: ${topic}.\n\nЯкщо натиснете «Погоджуюся», Тетяна отримає назву напряму та дані вашого Telegram-профілю. Ваше повідомлення буде передано їй лише після того, як ви надішлете його командою /send і текстом в одному повідомленні. Після успішної передачі бот видалить це повідомлення з чату з ботом. Не надсилайте документи чи чутливі відомості.\n\nБот не надає індивідуальної юридичної консультації.`,
    reply_markup: keyboard,
    link_preview_options: { is_disabled: true },
  });
}

async function answerCallback(callbackId, text) {
  await telegram("answerCallbackQuery", { callback_query_id: callbackId, text, show_alert: false });
}

async function tellLawyer(user, topic, updateId, body) {
  const username = user.username ? `@${html(user.username)}` : "(username не вказано)";
  const parts = [
    "<b>Нове звернення до бота Тетяни</b>",
    `<b>Напрям:</b> ${html(topic)}`,
    `<b>Ім’я:</b> ${html(displayName(user))}`,
    `<b>Telegram:</b> ${username}`,
    `<b>Telegram ID:</b> <code>${html(user.id)}</code>`,
    `<b>Номер запиту:</b> <code>${html(updateId)}</code>`,
  ];
  if (body) parts.push("", "<b>Повідомлення:</b>", html(body));
  await telegram("sendMessage", {
    chat_id: process.env.TATIANA_CHAT_ID,
    text: parts.join("\n"),
    parse_mode: "HTML",
    link_preview_options: { is_disabled: true },
  });
}

async function handleMessage(message, updateId) {
  if (!message?.from || message.from.is_bot || !message.chat?.id) return;
  const chatId = message.chat.id;
  const text = typeof message.text === "string" ? message.text.trim() : "";
  const command = text.match(/^\/(start|general|help|contact|send|myid)(?:@[A-Za-z0-9_]+)?(?:\s+([\s\S]*))?$/i);
  const name = command?.[1]?.toLowerCase();
  const argument = (command?.[2] || "").trim();
  if (name === "myid") {
    await telegram("sendMessage", {
      chat_id: chatId,
      text: `Ваш Telegram ID: ${message.from.id}\nПовідомте це число власнику проєкту приватним каналом для початкового налаштування бота.`,
    });
    return;
  }

  if (!process.env.PRIVACY_POLICY_URL) {
    await telegram("sendMessage", { chat_id: chatId, text: "Бот ще налаштовується. Спробуйте пізніше." });
    return;
  }

  if (name === "start" || name === "general") {
    const source = name === "general" ? "general" : (argument.split(/\s+/)[0] || "general").toLowerCase();
    await sendWelcome(chatId, source);
    return;
  }

  if (name === "help") {
    await telegram("sendMessage", {
      chat_id: chatId,
      text: "Щоб передати звернення, надішліть його одним повідомленням у форматі:\n/send Коротко опишіть питання і, за бажанням, вкажіть телефон. До 600 символів.\n\nНе додавайте документи, медичні дані, паролі чи коди підтвердження. Для загальних контактів: /contact.",
    });
    return;
  }

  if (name === "contact") {
    await telegram("sendMessage", {
      chat_id: chatId,
      text: "Адвокатка Тетяна Герасимишина\nТелефон: +38 (067) 731-69-46\nEmail: gerasimishinat@gmail.com\nСайт: https://www.advokat-herasymyshyna.com.ua",
      link_preview_options: { is_disabled: true },
    });
    return;
  }

  if (name === "send") {
    if (!argument) {
      await telegram("sendMessage", {
        chat_id: chatId,
        text: "Щоб передати запит, надішліть команду й текст одним повідомленням, наприклад:\n/send Потрібна консультація щодо спадщини.\n\nНе надсилайте документи або чутливі відомості.",
      });
      return;
    }
    if (argument.length > MAX_REQUEST_LENGTH) {
      await telegram("sendMessage", { chat_id: chatId, text: "Повідомлення задовге. Скоротіть його до 600 символів і надішліть знову командою /send." });
      return;
    }
    if (!process.env.TATIANA_CHAT_ID) {
      await telegram("sendMessage", { chat_id: chatId, text: "Бот ще налаштовується. Запит поки не передано; спробуйте пізніше." });
      return;
    }
    await tellLawyer(message.from, "Напрям не вказаний у цьому повідомленні; див. попереднє сповіщення, якщо воно є", updateId, argument);
    try {
      await telegram("deleteMessage", { chat_id: chatId, message_id: message.message_id });
      await telegram("sendMessage", { chat_id: chatId, text: "Запит передано Тетяні. Ваше повідомлення видалено з чату з ботом після передачі." });
    } catch {
      await telegram("sendMessage", { chat_id: chatId, text: "Запит передано Тетяні. Якщо ваше повідомлення залишилося в чаті, видаліть його вручну." });
    }
    return;
  }

  if (text.startsWith("/")) {
    await telegram("sendMessage", { chat_id: chatId, text: "Не знаю такої команди. Доступні: /start, /general, /help, /contact, /send." });
    return;
  }

  await telegram("sendMessage", {
    chat_id: chatId,
    text: "Я не передаю звичайні повідомлення автоматично. Якщо погоджуєтеся передати запит Тетяні, надішліть його командою /send і текстом в одному повідомленні. Наприклад: /send Потрібна консультація щодо поділу майна.",
  });
}

async function handleCallback(callback, updateId) {
  if (!callback?.id || !callback.from) return;
  const data = String(callback.data || "");
  if (!process.env.PRIVACY_POLICY_URL) {
    await answerCallback(callback.id, "Бот ще налаштовується; дані не передано.");
    return;
  }
  if (data === "decline") {
    await answerCallback(callback.id, "Запит не передавався.");
    if (callback.message?.chat?.id) {
      await telegram("sendMessage", { chat_id: callback.message.chat.id, text: "Зрозуміло. Дані про обраний напрям не передано Тетяні. Ви можете зв’язатися напряму: /contact." });
    }
    return;
  }

  const [, source] = data.split(":");
  if (!data.startsWith("consent:") || !Object.hasOwn(TOPICS, source)) {
    await answerCallback(callback.id, "Кнопка застаріла. Надішліть /start, щоб почати знову.");
    return;
  }

  if (!process.env.TATIANA_CHAT_ID) {
    await answerCallback(callback.id, "Бот ще налаштовується; дані не передано.");
    return;
  }

  await tellLawyer(callback.from, TOPICS[source], updateId);
  await answerCallback(callback.id, "Тетяна отримала вибраний напрям.");
  if (callback.message?.chat?.id) {
    await telegram("sendMessage", {
      chat_id: callback.message.chat.id,
      text: "Дякую. Тетяна отримала вибраний напрям і дані вашого Telegram-профілю. Щоб передати сам запит, надішліть одним повідомленням /send і короткий текст. Не надсилайте документи чи чутливі відомості.",
    });
  }
}

module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");

  if (req.method !== "POST") return res.status(405).json({ ok: false });

  const required = ["TELEGRAM_BOT_TOKEN", "TELEGRAM_WEBHOOK_SECRET"];
  if (required.some((key) => !process.env[key])) return res.status(503).json({ ok: false });

  const suppliedSecret = req.headers["x-telegram-bot-api-secret-token"];
  if (!secureEqual(suppliedSecret, process.env.TELEGRAM_WEBHOOK_SECRET)) return res.status(401).json({ ok: false });

  const update = req.body;
  if (!update || typeof update !== "object" || !Number.isInteger(update.update_id)) return res.status(400).json({ ok: false });

  try {
    if (update.message) await handleMessage(update.message, update.update_id);
    else if (update.callback_query) await handleCallback(update.callback_query, update.update_id);
    return res.status(200).json({ ok: true });
  } catch {
    // Do not log the update or user content. A 5xx response lets Telegram retry delivery.
    return res.status(500).json({ ok: false });
  }
};
