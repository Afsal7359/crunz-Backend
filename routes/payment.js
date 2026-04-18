const router = require('express').Router();
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const authMiddleware = require('../middleware/auth');

// Create payment intent
// amount should be in smallest currency unit: pence (GBP) or paise (INR)
router.post('/create-intent', authMiddleware, async (req, res) => {
  const { amountGBP, amountINR, currency } = req.body;

  let amount, cur;
  if (currency === 'INR') {
    amount = Math.round(amountINR * 100); // paise
    cur = 'inr';
  } else {
    amount = Math.round(amountGBP * 100); // pence
    cur = 'gbp';
  }

  const paymentIntent = await stripe.paymentIntents.create({
    amount,
    currency: cur,
    metadata: { userId: req.user._id.toString() },
    automatic_payment_methods: { enabled: true }
  });

  res.json({ clientSecret: paymentIntent.client_secret, paymentIntentId: paymentIntent.id });
});

module.exports = router;
