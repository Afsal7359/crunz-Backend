const mongoose = require('mongoose');

const couponSchema = new mongoose.Schema({
  code:          { type: String, required: true, unique: true, uppercase: true, trim: true },
  description:   { type: String, default: '' },
  discountType:  { type: String, enum: ['percentage', 'fixed'], required: true },
  discountValue: { type: Number, required: true, min: 0 },
  currency:      { type: String, enum: ['GBP', 'INR', 'both'], default: 'both' },
  maxUses:       { type: Number, default: 0 },   // 0 = unlimited
  usedCount:     { type: Number, default: 0 },
  minOrderGBP:   { type: Number, default: 0 },   // min order value to apply
  minOrderINR:   { type: Number, default: 0 },
  active:        { type: Boolean, default: true },
  expiresAt:     { type: Date, default: null },
  createdAt:     { type: Date, default: Date.now },
});

// Virtual: remaining uses
couponSchema.virtual('remaining').get(function () {
  if (this.maxUses === 0) return null; // unlimited
  return Math.max(0, this.maxUses - this.usedCount);
});

module.exports = mongoose.model('Coupon', couponSchema);
