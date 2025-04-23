require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const { MongoClient } = require('mongodb');

const app = express();
const cors = require('cors');
app.use(cors());

const PORT = process.env.PORT || 3000;
const {
  API_TOKEN,
  MONGO_URI,
  MONGO_DB_NAME = 'logs',
  MONGO_COLLECTION = 'docker_logs'
} = process.env;

if (!API_TOKEN) throw new Error('Missing API_TOKEN in .env');
if (!MONGO_URI) throw new Error('Missing MONGO_URI in .env');

let collection;
(async () => {
  const client = new MongoClient(MONGO_URI);
  await client.connect();
  collection = client.db(MONGO_DB_NAME).collection(MONGO_COLLECTION);
  console.log(`✅ Connected to MongoDB: ${MONGO_DB_NAME}.${MONGO_COLLECTION}`);
})();

// parse JSON bodies
app.use(bodyParser.json());

// ←–– UPDATED AUTH MIDDLEWARE HERE ––→
app.use('/logs', (req, res, next) => {
  const tokenFromQuery = req.query.token;
  const tokenFromHeader = (req.headers.authorization || '').split(' ')[1];
  const token = tokenFromQuery || tokenFromHeader;

  if (token !== API_TOKEN) {
    return res
      .status(token ? 403 : 401)
      .json({ error: token ? 'Forbidden' : 'Unauthorized' });
  }
  next();
});

// ingest logs
app.post('/logs', async (req, res) => {
  console.log('Headers:', req.headers);
  console.log('Query:', req.query);
  console.log('Body:', req.body);

  const records = Array.isArray(req.body) ? req.body : [req.body];
  console.log('📥 Received batch of', records.length, 'records');

  try {
    await collection.insertMany(records);
    res.sendStatus(204);
  } catch (err) {
    console.error('DB insert error:', err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// debug: fetch latest
app.get('/logs', async (req, res) => {
  try {
    const logs = await collection
      .find()
      .sort({ _id: -1 })
      .limit(100)
      .toArray();
    res.json(logs);
  } catch (err) {
    console.error('DB fetch error:', err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

app.listen(PORT, () => {
  console.log(`🚀 Log‐ingest API listening on port ${PORT}`);
});
