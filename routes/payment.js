const router          = require('express').Router();
const stripe          = require('stripe')(process.env.STRIPE_SECRET_KEY);
const Order           = require('../models/Order');
const Coupon          = require('../models/Coupon');
const jwt             = require('jsonwebtoken');
const User            = require('../models/User');
const { sendOrderConfirmation, sendAdminNotification } = require('../utils/mailer');

// Optionally extract user from token (no error if not logged in)
async function optionalUser(req) {
  try {
    const header = req.headers.authorization || '';
    if (!header.startsWith('Bearer ')) return null;
    const token = header.slice(7);
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    return await User.findById(decoded.id).select('_id name email');
  } catch { return null; }
}

// ── Create Payment Intent ─────────────────────────────────────────
// Called by frontend when user clicks "Continue to Payment".
// We create the order in DB right here with paymentStatus:'pending'
// so it is never lost, even if the user closes the tab mid-payment.
router.post('/create-intent', async (req, res) => {
  const { amountGBP, amountINR, currency, orderData, couponCode } = req.body;

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

  // Attach order to user if logged in
  const currentUser = await optionalUser(req);

  // Save order immediately with pending status so it is never lost
  let order = null;
  if (orderData && Array.isArray(orderData.items) && orderData.items.length > 0) {
    try {
      order = await Order.create({
        ...(currentUser ? { user: currentUser._id } : {}),
        items: orderData.items,
        totalGBP: Number(orderData.totalGBP) || 0,
        totalINR: Number(orderData.totalINR) || 0,
        currency: orderData.currency || currency,
        shippingAddress: orderData.shippingAddress || {},
        deliveryCharge: Number(orderData.deliveryCharge) || 0,
        notes: orderData.notes || '',
        couponCode: couponCode || '',
        discountAmount: Number(orderData.discountAmount) || 0,
        paymentStatus: 'pending',
        status: 'pending',
        orderSource: 'website',
      });
    } catch (dbErr) {
      console.error('[Payment] Order pre-save failed:', dbErr.message);
    }
  }

  // Use automatic methods for all currencies — includes card, Apple Pay, Google Pay
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

// ── Confirm order after frontend payment success ──────────────────
// Called immediately after stripe.confirmPayment() succeeds on frontend.
// Verifies the payment with Stripe directly, then marks order paid.
// This works even without webhook setup.
router.post('/confirm-order', async (req, res) => {
  const { paymentIntentId, orderId } = req.body;
  console.log('[confirm-order] paymentIntentId:', paymentIntentId, 'orderId:', orderId);
  if (!paymentIntentId) return res.status(400).json({ message: 'paymentIntentId required' });

  // Fetch the intent directly from Stripe to verify it really succeeded
  const intent = await stripe.paymentIntents.retrieve(paymentIntentId);
  console.log('[confirm-order] Stripe intent status:', intent.status);

  if (intent.status !== 'succeeded' && intent.status !== 'processing') {
    return res.status(400).json({ message: `Payment not confirmed. Status: ${intent.status}` });
  }

  const isPaid = intent.status === 'succeeded';

  // Find order by orderId or by stripePaymentIntentId
  let order = null;
  if (orderId) order = await Order.findById(orderId);
  if (!order)  order = await Order.findOne({ stripePaymentIntentId: paymentIntentId });

  if (!order) return res.status(404).json({ message: 'Order not found' });

  if (order.paymentStatus !== 'paid') {
    order.paymentStatus = isPaid ? 'paid' : 'pending';
    order.status        = isPaid ? 'confirmed' : 'pending';
    order.stripePaymentIntentId = paymentIntentId;
    order.orderSource   = 'website';
    // Attach user if not already set
    if (!order.user) {
      const currentUser = await optionalUser(req);
      if (currentUser) order.user = currentUser._id;
    }
    await order.save();

    if (isPaid) {
      // Increment coupon usage if one was applied
      if (order.couponCode) {
        await Coupon.findOneAndUpdate(
          { code: order.couponCode },
          { $inc: { usedCount: 1 } }
        );
      }
      sendAdminNotification(order).catch(() => {});
      // Send confirmation to whoever has an email — logged-in user account takes priority,
      // fall back to the email the guest typed in the checkout form
      let customerEmail = null;
      let customerName  = order.shippingAddress?.name || 'Customer';
      if (order.user) {
        const userDoc = await User.findById(order.user).select('email name');
        if (userDoc?.email) { customerEmail = userDoc.email; customerName = userDoc.name || customerName; }
      }
      if (!customerEmail && order.shippingAddress?.email) {
        customerEmail = order.shippingAddress.email;
      }
      if (customerEmail) {
        sendOrderConfirmation(customerEmail, order, customerName).catch(() => {});
      }
    }
  }

  res.json({ success: true, paymentStatus: order.paymentStatus, status: order.status });
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
        if (order.couponCode) {
          await Coupon.findOneAndUpdate({ code: order.couponCode }, { $inc: { usedCount: 1 } });
        }
        sendAdminNotification(order).catch(() => {});
        let customerEmail = null;
        let customerName  = order.shippingAddress?.name || 'Customer';
        if (order.user) {
          const userDoc = await User.findById(order.user).select('email name');
          if (userDoc?.email) { customerEmail = userDoc.email; customerName = userDoc.name || customerName; }
        }
        if (!customerEmail && order.shippingAddress?.email) {
          customerEmail = order.shippingAddress.email;
        }
        if (customerEmail) {
          sendOrderConfirmation(customerEmail, order, customerName).catch(() => {});
        }
      }
    }
    console.log('[Webhook] Payment succeeded — order:', orderId);

  } else if (event.type === 'payment_intent.payment_failed') {
    if (orderId) {
      await Order.findByIdAndUpdate(orderId, { paymentStatus: 'failed', status: 'cancelled' });
    }
    console.log('[Webhook] Payment failed — order:', orderId);

  } else if (event.type === 'payment_intent.processing') {
    // Payment processing (bank transfers etc.)
    if (orderId) {
      await Order.findByIdAndUpdate(orderId, { paymentStatus: 'pending', status: 'pending' });
    }
    console.log('[Webhook] Payment processing — order:', orderId);
  }

  res.json({ received: true });
});

module.exports = router;
