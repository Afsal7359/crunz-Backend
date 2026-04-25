const router    = require('express').Router();
const Coupon    = require('../models/Coupon');
const adminAuth = require('../middleware/adminAuth');

// ── Helper: calculate discount amount ───────────────────────────────
function calcDiscount(coupon, subtotal, currency) {
  if (coupon.discountType === 'percentage') {
    return Math.round((subtotal * coupon.discountValue / 100) * 100) / 100;
  }
  // fixed — value is in GBP if currency='GBP', INR if currency='INR', otherwise use as-is
  return Math.min(coupon.discountValue, subtotal);
}

// ── Public: validate coupon ──────────────────────────────────────────
router.post('/validate', async (req, res) => {
  const { code, subtotal, currency } = req.body;
  if (!code) return res.status(400).json({ message: 'Coupon code required' });

  const coupon = await Coupon.findOne({ code: code.trim().toUpperCase(), active: true });
  if (!coupon) return res.status(404).json({ message: 'Invalid or expired coupon code' });

  // Expiry check
  if (coupon.expiresAt && new Date() > coupon.expiresAt) {
    return res.status(400).json({ message: 'This coupon has expired' });
  }

  // Uses check
  if (coupon.maxUses > 0 && coupon.usedCount >= coupon.maxUses) {
    return res.status(400).json({ message: 'This coupon has reached its usage limit' });
  }

  // Currency check
  if (coupon.currency !== 'both' && coupon.currency !== currency) {
    return res.status(400).json({ message: `This coupon is only valid for ${coupon.currency} payments` });
  }

  // Min order check
  const minOrder = currency === 'INR' ? coupon.minOrderINR : coupon.minOrderGBP;
  if (subtotal < minOrder) {
    const sym = currency === 'INR' ? '₹' : '£';
    return res.status(400).json({ message: `Minimum order of ${sym}${minOrder} required for this coupon` });
  }

  const discountAmount = calcDiscount(coupon, subtotal, currency);
  const remaining = coupon.maxUses === 0 ? null : coupon.maxUses - coupon.usedCount;

  res.json({
    valid: true,
    code: coupon.code,
    description: coupon.description,
    discountType: coupon.discountType,
    discountValue: coupon.discountValue,
    discountAmount,
    remaining,
  });
});

// ── Admin: list all coupons with stats ──────────────────────────────
router.get('/', adminAuth, async (req, res) => {
  const Order  = require('../models/Order');
  const coupons = await Coupon.find().sort('-createdAt');

  // For each coupon, get total revenue generated
  const withStats = await Promise.all(coupons.map(async (c) => {
    const orders = await Order.find({ couponCode: c.code, paymentStatus: 'paid' })
      .select('totalGBP totalINR currency discountAmount');
    const revenueGBP = orders.filter(o => o.currency === 'GBP').reduce((s, o) => s + o.totalGBP, 0);
    const revenueINR = orders.filter(o => o.currency === 'INR').reduce((s, o) => s + o.totalINR, 0);
    const totalDiscount = orders.reduce((s, o) => s + (o.discountAmount || 0), 0);
    return {
      ...c.toObject({ virtuals: true }),
      orderCount: orders.length,
      revenueGBP,
      revenueINR,
      totalDiscount,
    };
  }));

  res.json(withStats);
});

// ── Admin: create coupon ─────────────────────────────────────────────
router.post('/', adminAuth, async (req, res) => {
  const { code, description, discountType, discountValue, currency, maxUses, minOrderGBP, minOrderINR, active, expiresAt } = req.body;
  if (!code || !discountType || discountValue === undefined) {
    return res.status(400).json({ message: 'code, discountType and discountValue are required' });
  }
  const existing = await Coupon.findOne({ code: code.trim().toUpperCase() });
  if (existing) return res.status(409).json({ message: 'Coupon code already exists' });

  const coupon = await Coupon.create({
    code, description, discountType, discountValue,
    currency: currency || 'both',
    maxUses: maxUses || 0,
    minOrderGBP: minOrderGBP || 0,
    minOrderINR: minOrderINR || 0,
    active: active !== false,
    expiresAt: expiresAt || null,
  });
  res.status(201).json(coupon);
});

// ── Admin: update coupon ─────────────────────────────────────────────
router.put('/:id', adminAuth, async (req, res) => {
  const coupon = await Coupon.findByIdAndUpdate(req.params.id, req.body, { new: true });
  if (!coupon) return res.status(404).json({ message: 'Coupon not found' });
  res.json(coupon);
});

// ── Admin: delete coupon ─────────────────────────────────────────────
router.delete('/:id', adminAuth, async (req, res) => {
  await Coupon.findByIdAndDelete(req.params.id);
  res.json({ message: 'Coupon deleted' });
});

module.exports = router;
