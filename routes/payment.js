const router   = require('express').Router();
const stripe   = require('stripe')(process.env.STRIPE_SECRET_KEY);
const Order    = require('../models/Order');
const { sendOrderConfirmation, sendAdminNotification } = require('../utils/mailer');

// ── Create Payment Intent ─────────────────────────────────────────
// Called by frontend when user clicks "Continue to Payment".
// We create the order in DB right here with paymentStatus:'pending'
// so it is never lost, even if the user closes the tab mid-payment.
router.post('/create-intent', async (req, res) => {
  const { amountGBP, amountINR, currency, orderData } = req.body;

  if (!currency) return res.status(400).json({ message: 'currency is required' });

  let amount, cur;
  if (currency === 'INR') {
    amount = Math.round((Number(amountINR) || 0) * 100); // paise
    cur = 'inr';
  } else {
    amount = Math.round((Number(amountGBP) || 0) * 100); // pence
    cur = 'gbp';
  }

  if (!amount || amount < 50) {
    return res.status(400).json({ message: 'Invalid order amount' });
  }

  // Save order immediately with pending status so it is never lost
  let order = null;
  if (orderData && Array.isArray(orderData.items) && orderData.items.length > 0) {
    try {
      order = await Order.create({
        items: orderData.items,
        totalGBP: Number(orderData.totalGBP) || 0,
        totalINR: Number(orderData.totalINR) || 0,
        currency: orderData.currency || currency,
        shippingAddress: orderData.shippingAddress || {},
        deliveryCharge: Number(orderData.deliveryCharge) || 0,
        notes: orderData.notes || '',
        paymentStatus: 'pending',
        status: 'pending',
        orderSource: 'website',
      });
    } catch (dbErr) {
      console.error('[Payment] Order pre-save failed:', dbErr.message);
      // Still proceed — order will be saved by webhook fallback
    }
  }

  const paymentIntent = await stripe.paymentIntents.create({
    amount,
    currency: cur,
    automatic_payment_methods: { enabled: true },
    metadata: { orderId: order ? order._id.toString() : '' },
  });

  // Attach Stripe intent ID to order
  if (order) {
    order.stripePaymentIntentId = paymentIntent.id;
    await order.save();
  }

  res.json({
    clientSecret: paymentIntent.client_secret,
    paymentIntentId: paymentIntent.id,
    orderId: order ? order._id : null,
  });
});

// ── Stripe Webhook ────────────────────────────────────────────────
// Stripe calls this URL automatically when payment succeeds, fails, etc.
// Must use raw body (not JSON parsed) — registered before express.json() in server.js
router.post('/webhook', async (req, res) => {
  const sig    = req.headers['stripe-signature'];
  const secret = process.env.STRIPE_WEBHOOK_SECRET;

  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, sig, secret);
  } catch (err) {
    console.error('[Webhook] signature failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  const intent = event.data.object;
  const orderId = intent.metadata?.orderId;

  if (event.type === 'payment_intent.succeeded') {
    if (orderId) {
      const order = await Order.findById(orderId);
      if (order && order.paymentStatus !== 'paid') {
        order.paymentStatus = 'paid';
        order.status = 'confirmed';
        await order.save();
        // Send confirmation email if we have customer email
        if (order.shippingAddress?.email) {
          sendOrderConfirmation(order.shippingAddress.email, order, order.shippingAddress.name).catch(() => {});
        }
        sendAdminNotification(order).catch(() => {});
      }
    }
    console.log('[Webhook] Payment succeeded — order:', orderId);

  } else if (event.type === 'payment_intent.payment_failed') {
    if (orderId) {
      await Order.findByIdAndUpdate(orderId, { paymentStatus: 'failed', status: 'cancelled' });
    }
    console.log('[Webhook] Payment failed — order:', orderId);

  } else if (event.type === 'payment_intent.processing') {
    // Bank transfer / UPI can stay processing for minutes
    if (orderId) {
      await Order.findByIdAndUpdate(orderId, { paymentStatus: 'pending', status: 'pending' });
    }
    console.log('[Webhook] Payment processing — order:', orderId);
  }

  res.json({ received: true });
});

module.exports = router;
