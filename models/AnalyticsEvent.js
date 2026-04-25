const mongoose = require('mongoose');

const analyticsEventSchema = new mongoose.Schema({
  sessionId:   { type: String, required: true, index: true },
  event:       { type: String, required: true, index: true },
  page:        { type: String, default: '/' },
  properties:  { type: mongoose.Schema.Types.Mixed, default: {} },
  device:      { type: String, enum: ['mobile', 'tablet', 'desktop'], default: 'desktop' },
  browser:     { type: String, default: 'unknown' },
  userId:      { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  duration:    { type: Number, default: 0 },
  // Location
  country:     { type: String, default: '' },
  countryCode: { type: String, default: '' },
  city:        { type: String, default: '' },
  region:      { type: String, default: '' },
  latitude:    { type: Number, default: null },
  longitude:   { type: Number, default: null },
  timezone:    { type: String, default: '' },
  ip:          { type: String, default: '' },
  timestamp:   { type: Date, default: Date.now, index: true },
}, { timestamps: false });

// TTL: auto-delete events older than 90 days
analyticsEventSchema.index({ timestamp: 1 }, { expireAfterSeconds: 90 * 24 * 60 * 60 });

module.exports = mongoose.model('AnalyticsEvent', analyticsEventSchema);
