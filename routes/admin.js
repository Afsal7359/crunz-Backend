const router = require('express').Router();
const adminAuth = require('../middleware/adminAuth');
const Order = require('../models/Order');
const User = require('../models/User');
const Product = require('../models/Product');
const SiteContent = require('../models/SiteContent');

// Dashboard stats
router.get('/dashboard', adminAuth, async (req, res) => {
  const [totalOrders, totalUsers, totalProducts, recentOrders, paidOrders] = await Promise.all([
    Order.countDocuments({ paymentStatus: 'paid' }),
    User.countDocuments(),
    Product.countDocuments(),
    Order.find().sort('-createdAt').limit(10).populate('user', 'name email'),
    Order.find({ paymentStatus: 'paid' })
  ]);

  const revenueGBP = paidOrders.filter(o => o.currency === 'GBP').reduce((s, o) => s + (o.totalGBP || 0), 0);
  const revenueINR = paidOrders.filter(o => o.currency === 'INR').reduce((s, o) => s + (o.totalINR || 0), 0);

  const statusCounts = {
    pending: 0, confirmed: 0, processing: 0, shipped: 0, delivered: 0, cancelled: 0
  };
  paidOrders.forEach(o => { if (statusCounts[o.status] !== undefined) statusCounts[o.status]++; });

  res.json({ totalOrders, totalUsers, totalProducts, revenueGBP, revenueINR, recentOrders, statusCounts });
});

// ── Transactions (all payments with status) ──────────────────────────
router.get('/transactions', adminAuth, async (req, res) => {
  const { filter = 'all', page = 1, limit = 30 } = req.query;
  const query = {};
  if (filter === 'paid')    query.paymentStatus = 'paid';
  if (filter === 'pending') query.paymentStatus = 'pending';
  if (filter === 'failed')  query.paymentStatus = 'failed';

  const [transactions, total] = await Promise.all([
    Order.find(query)
      .populate('user', 'name email')
      .sort('-createdAt')
      .skip((page - 1) * Number(limit))
      .limit(Number(limit))
      .select('_id user shippingAddress totalGBP totalINR currency paymentStatus status orderSource stripePaymentIntentId createdAt items'),
    Order.countDocuments(query),
  ]);

  const counts = await Promise.all([
    Order.countDocuments({}),
    Order.countDocuments({ paymentStatus: 'paid' }),
    Order.countDocuments({ paymentStatus: 'pending' }),
    Order.countDocuments({ paymentStatus: 'failed' }),
  ]);

  res.json({
    transactions,
    total,
    pages: Math.ceil(total / Number(limit)),
    counts: { all: counts[0], paid: counts[1], pending: counts[2], failed: counts[3] },
  });
});

// All paid orders with filters + pagination
router.get('/orders', adminAuth, async (req, res) => {
  const { status, page = 1, limit = 20 } = req.query;
  const query = { paymentStatus: 'paid' };
  if (status) query.status = status;

  const [orders, total, statusCounts] = await Promise.all([
    Order.find(query)
      .populate('user', 'name email')
      .sort('-createdAt')
      .skip((page - 1) * Number(limit))
      .limit(Number(limit)),
    Order.countDocuments(query),
    Promise.all(
      ['confirmed', 'processing', 'shipped', 'delivered', 'cancelled'].map(s =>
        Order.countDocuments({ paymentStatus: 'paid', status: s }).then(c => ({ s, c }))
      )
    ),
  ]);

  const counts = { all: await Order.countDocuments({ paymentStatus: 'paid' }) };
  statusCounts.forEach(({ s, c }) => { counts[s] = c; });

  res.json({ orders, total, pages: Math.ceil(total / Number(limit)), counts });
});

// Update order status
router.put('/orders/:id', adminAuth, async (req, res) => {
  const { status } = req.body;
  const order = await Order.findByIdAndUpdate(req.params.id, { status }, { new: true }).populate('user', 'name email');
  if (!order) return res.status(404).json({ message: 'Order not found' });
  res.json(order);
});

// Delete order
router.delete('/orders/:id', adminAuth, async (req, res) => {
  await Order.findByIdAndDelete(req.params.id);
  res.json({ message: 'Order deleted' });
});

// All users
router.get('/users', adminAuth, async (req, res) => {
  const users = await User.find().select('-otp -otpExpiry').sort('-createdAt');
  res.json(users);
});

// Toggle admin
router.put('/users/:id/admin', adminAuth, async (req, res) => {
  const user = await User.findById(req.params.id);
  if (!user) return res.status(404).json({ message: 'User not found' });
  user.isAdmin = !user.isAdmin;
  await user.save();
  res.json({ isAdmin: user.isAdmin, message: `User ${user.isAdmin ? 'promoted to' : 'removed from'} admin` });
});

// Delete user
router.delete('/users/:id', adminAuth, async (req, res) => {
  await User.findByIdAndDelete(req.params.id);
  res.json({ message: 'User deleted' });
});

// Get all site content
router.get('/content', adminAuth, async (req, res) => {
  const content = await SiteContent.find();
  const obj = {};
  content.forEach(c => (obj[c.key] = c.value));
  res.json(obj);
});

// Update site content
router.put('/content/:key', adminAuth, async (req, res) => {
  const { value } = req.body;
  const doc = await SiteContent.findOneAndUpdate(
    { key: req.params.key },
    { value, updatedAt: new Date() },
    { upsert: true, new: true }
  );
  res.json(doc);
});

// Batch update content
router.put('/content', adminAuth, async (req, res) => {
  const updates = req.body; // { key: value, ... }
  const ops = Object.entries(updates).map(([key, value]) =>
    SiteContent.findOneAndUpdate({ key }, { value, updatedAt: new Date() }, { upsert: true })
  );
  await Promise.all(ops);
  res.json({ message: 'Content updated' });
});

module.exports = router;
