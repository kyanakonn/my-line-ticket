const express = require("express");
const axios = require("axios");
const path = require("path");

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static("public")); // ← public フォルダを公開

// 整理券番号管理
let currentTicket = 1;

// LINE設定
const LINE_ACCESS_TOKEN = process.env.CHANNEL_ACCESS_TOKEN;
const LINE_API_URL = "https://api.line.me/v2/bot/message/reply";

// LINE Webhook（ユーザーがメッセージ送ったらリンク返す）
app.post("/webhook", async (req, res) => {
  const events = req.body.events;
  if (!events || events.length === 0) return res.status(200).send("No events");

  const event = events[0];
  const replyToken = event.replyToken;

  try {
    await axios.post(
      LINE_API_URL,
      {
        replyToken: replyToken,
        messages: [
          {
            type: "text",
            text: `整理券はこちらから発行できます：\nhttps://my-line-ticket.onrender.com/ticket.html`,
          },
        ],
      },
      {
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${LINE_ACCESS_TOKEN}`,
        },
      }
    );
    res.status(200).send("OK");
  } catch (error) {
    console.error("Error sending message:", error.response?.data || error.message);
    res.status(500).send("Error");
  }
});

// 整理券番号を返すAPI（HTMLのfetchで呼び出し）
app.post("/api/ticket", (req, res) => {
  const ticketNumber = currentTicket++;
  res.json({ number: ticketNumber });
});

app.get("/", (req, res) => {
  res.redirect("/ticket.html");
});

// サーバー起動（Render用）
const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
