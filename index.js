const express = require('express');
const path = require('path');
const app = express();

// 整理券番号を1からスタート
let ticketNumber = 1;

// 静的ファイル（HTML）を公開
app.use(express.static('public'));

// 整理券発行API
app.post('/api/ticket', (req, res) => {
  const ticket = ticketNumber++;
  res.json({ ticket });
});

// Render用ポート
const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});
