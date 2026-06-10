require('dotenv').config();
require('express-async-errors');

const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const connectDB = require('./config/db');

const app = express();

// Ensure uploads directory exists
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

// DB
connectDB();

// Middleware
const allowedOrigins = [
  (process.env.CLIENT_URL || 'http://localhost:3000').replace(/\/$/, ''),
  'http://localhost:3000',
  'http://localhost:3001',
  'https://getcrunz.com',
  'https://www.getcrunz.com',
];
app.use(cors({
  origin: (origin, cb) => {
    // allow server-to-server requests (no origin) and listed origins
    if (!origin || allowedOrigins.includes(origin)) return cb(null, true);
    cb(new Error(`CORS: origin ${origin} not allowed`));
  },
  credentials: true
}));
// Stripe webhook needs raw body BEFORE express.json()
app.use('/api/payment/webhook', express.raw({ type: 'application/json' }));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Serve uploaded files (images + videos)
app.use('/uploads', express.static(uploadsDir));
// Ensure videos sub-directory exists
const videosDir = path.join(uploadsDir, 'videos');
if (!fs.existsSync(videosDir)) fs.mkdirSync(videosDir, { recursive: true });

// Public content endpoint (no auth required)
const SiteContent = require('./models/SiteContent');
app.get('/api/content', async (req, res) => {
  const content = await SiteContent.find();
  const obj = {};
  content.forEach(c => (obj[c.key] = c.value));
  res.json(obj);
});

// Routes
app.use('/api/auth', require('./routes/auth'));
app.use('/api/products', require('./routes/products'));
app.use('/api/orders', require('./routes/orders'));
app.use('/api/admin', require('./routes/admin'));
app.use('/api/payment',   require('./routes/payment'));
app.use('/api/upload',    require('./routes/upload'));
app.use('/api/analytics', require('./routes/analytics'));
app.use('/api/coupons',   require('./routes/coupons'));

// Health check
app.get('/api/health', (req, res) => res.json({ status: 'ok', timestamp: new Date() }));

// ── Auto-expire stale pending payments every 30 minutes ──────────────
const Order = require('./models/Order');
const mongoose = require('mongoose');
const EXPIRE_AFTER_MS = 2 * 60 * 60 * 1000; // 2 hours

async function expireStalePendingOrders() {
  try {
    const cutoff = new Date(Date.now() - EXPIRE_AFTER_MS);
    const result = await Order.updateMany(
      { paymentStatus: 'pending', createdAt: { $lt: cutoff } },
      { paymentStatus: 'failed', status: 'cancelled' }
    );
    if (result.modifiedCount > 0) {
      console.log(`[Auto-expire] Cancelled ${result.modifiedCount} stale pending order(s)`);
    }
  } catch (err) {
    console.error('[Auto-expire] Error:', err.message);
  }
}

// Wait for DB connection before running the first expire check
mongoose.connection.once('connected', () => {
  expireStalePendingOrders();
  setInterval(expireStalePendingOrders, 30 * 60 * 1000);
});

// Global error handler
app.use((err, req, res, next) => {
  console.error('[ERROR]', err.message);
  res.status(err.status || 500).json({ message: err.message || 'Internal server error' });
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`\n🍌 Crunz Backend running on http://localhost:${PORT}`);
  console.log(`   MongoDB: ${process.env.MONGODB_URI}`);
  console.log(`   Client:  ${process.env.CLIENT_URL || 'http://localhost:3000'}\n`);
});
