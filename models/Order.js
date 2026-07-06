const mongoose = require('mongoose');

const orderItemSchema = new mongoose.Schema({
  product: { type: mongoose.Schema.Types.ObjectId, ref: 'Product' },
  name: String,
  image: String,
  priceGBP: Number,
  priceINR: Number,
  qty: Number
});

const orderSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  items: [orderItemSchema],
  totalGBP: { type: Number, default: 0 },
  totalINR: { type: Number, default: 0 },
  currency: { type: String, enum: ['GBP', 'INR'], default: 'GBP' },
  status: {
    type: String,
    enum: ['pending', 'confirmed', 'processing', 'shipped', 'delivered', 'cancelled'],
    default: 'pending'
  },
  shippingAddress: {
    name: String,
    email: String,
    phone: String,
    street: String,
    city: String,
    postcode: String,
    country: { type: String, default: 'United Kingdom' }
  },
  stripePaymentIntentId: String,
  paymentStatus: { type: String, enum: ['pending', 'paid', 'failed'], default: 'pending' },
  orderSource: { type: String, enum: ['website', 'whatsapp'], default: 'website' },
  deliveryCharge:   { type: Number, default: 0 },
  couponCode:       { type: String, default: '' },
  discountAmount:   { type: Number, default: 0 },   // in order currency
  notes: String,
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Order', orderSchema);
