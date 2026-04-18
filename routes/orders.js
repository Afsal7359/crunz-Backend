const router = require('express').Router();
const Order = require('../models/Order');
const User = require('../models/User');
const authMiddleware = require('../middleware/auth');
const { sendOrderConfirmation, sendAdminNotification } = require('../utils/mailer');

// Create order (called after successful Stripe payment)
router.post('/', authMiddleware, async (req, res) => {
  const { items, shippingAddress, currency, stripePaymentIntentId, saveAddress, notes } = req.body;

  const totalGBP = items.reduce((s, i) => s + i.priceGBP * i.qty, 0);
  const totalINR = items.reduce((s, i) => s + i.priceINR * i.qty, 0);

  const order = await Order.create({
    user: req.user._id,
    items,
    totalGBP: Math.round(totalGBP * 100) / 100,
    totalINR: Math.round(totalINR * 100) / 100,
    currency,
    shippingAddress,
    stripePaymentIntentId,
    paymentStatus: 'paid',
    status: 'confirmed',
    notes: notes || ''
  });

  // Optionally save address
  if (saveAddress) {
    const user = await User.findById(req.user._id);
    const exists = user.addresses.some(
      a => a.street === shippingAddress.street && a.postcode === shippingAddress.postcode
    );
    if (!exists) {
      const isFirst = user.addresses.length === 0;
      user.addresses.push({ ...shippingAddress, isDefault: isFirst });
      await user.save();
    }
  }

  // Send emails (non-blocking)
  sendOrderConfirmation(req.user.email, order, req.user.name).catch(console.error);
  sendAdminNotification(order).catch(console.error);

  res.status(201).json(order);
});

// My orders
router.get('/my', authMiddleware, async (req, res) => {
  const orders = await Order.find({ user: req.user._id }).sort('-createdAt');
  res.json(orders);
});

// Single order
router.get('/:id', authMiddleware, async (req, res) => {
  const order = await Order.findById(req.params.id);
  if (!order) return res.status(404).json({ message: 'Order not found' });
  if (order.user.toString() !== req.user._id.toString() && !req.user.isAdmin) {
    return res.status(403).json({ message: 'Access denied' });
  }
  res.json(order);
});

module.exports = router;
