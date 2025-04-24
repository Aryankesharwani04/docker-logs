require('dotenv').config();
const express    = require('express');
const bodyParser = require('body-parser');
const { MongoClient } = require('mongodb');

const app  = express();
const cors = require('cors');
app.use(cors());

const PORT = process.env.PORT || 3000;
const {
  API_TOKEN,
  MONGO_URI,
  MONGO_DB_NAME    = 'logs',
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

// ── 1) parse real JSON bodies (only application/json) up to 5mb
app.use(bodyParser.json({
  type: 'application/json',
  limit: '5mb'
}));

// ── 2) parse text/plain (NDJSON) up to 5mb
app.use(bodyParser.text({
  type: 'text/plain',
  limit: '5mb'
}));

// ── Auth middleware
app.use('/logs', (req, res, next) => {
  const tokenFromQuery  = req.query.token;
  const tokenFromHeader = (req.headers.authorization || '').split(' ')[1];
  const token           = tokenFromQuery || tokenFromHeader;
  if (token !== API_TOKEN) {
    return res
      .status(token ? 403 : 401)
      .json({ error: token ? 'Forbidden' : 'Unauthorized' });
  }
  next();
});

// ── Ingest endpoint
app.post('/logs', async (req, res) => {
  let records;
  try {
    if (typeof req.body === 'string') {
      // NDJSON: split lines, parse each JSON object
      records = req.body
        .trim()
        .split('\n')
        .filter(line => line.length > 0)
        .map(line => JSON.parse(line));
    } else {
      // real JSON
      records = Array.isArray(req.body) ? req.body : [ req.body ];
    }
  } catch (parseErr) {
    console.error('❌ JSON parse error:', parseErr);
    return res.status(400).json({ error: 'Invalid JSON in log payload' });
  }

  console.log(`📥 Received batch of ${records.length} records`);
  try {
    await collection.insertMany(records);
    return res.sendStatus(204);
  } catch (err) {
    console.error('❌ DB insert error:', err);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
});

// ── Debug: fetch latest 100 logs
app.get('/logs', async (req, res) => {
  try {
    const logs = await collection
      .find()
      .sort({ _id: -1 })
      .limit(100)
      .toArray();
    res.json(logs);
  } catch (err) {
    console.error('❌ DB fetch error:', err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// ── Global error‐handler to ensure we never return HTML
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(err.status || 500).json({ error: err.message || 'Server Error' });
});

app.listen(PORT, () => {
  console.log(`🚀 Log‐ingest API listening on port ${PORT}`);
});
