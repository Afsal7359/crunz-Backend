const mongoose = require('mongoose');

const productSchema = new mongoose.Schema({
  name: { type: String, required: true },
  flavor: { type: String, default: '' },
  description: { type: String, default: '' },
  badge: { type: String, default: '' },
  tags: { type: [String], default: [] },
  priceGBP: { type: Number, required: true },
  priceINR: { type: Number, required: true },
  image: { type: String, default: '' },
  spice: { type: String, default: 'None' },
  rating: { type: Number, default: 5 },
  inStock: { type: Boolean, default: true },
  order: { type: Number, default: 0 },
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Product', productSchema);
