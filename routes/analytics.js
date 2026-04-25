const router        = require('express').Router();
const AnalyticsEvent = require('../models/AnalyticsEvent');
const adminAuth     = require('../middleware/adminAuth');

// ── Collect event (public, no auth) ─────────────────────────────────
router.post('/event', async (req, res) => {
  const {
    sessionId, event, page, properties, device, browser, userId, duration,
    country, countryCode, city, region, latitude, longitude, timezone,
  } = req.body;
  if (!sessionId || !event) return res.status(400).json({ message: 'sessionId and event required' });

  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim()
           || req.socket?.remoteAddress
           || '';

  await AnalyticsEvent.create({
    sessionId, event, page, properties,
    device, browser, userId: userId || null, duration: duration || 0,
    country: country || '', countryCode: countryCode || '',
    city: city || '', region: region || '',
    latitude: latitude || null, longitude: longitude || null,
    timezone: timezone || '', ip,
  });
  res.json({ ok: true });
});

// ── Admin: full analytics summary ───────────────────────────────────
router.get('/summary', adminAuth, async (req, res) => {
  const { range = '7d' } = req.query;
  const days   = range === '30d' ? 30 : range === '1d' ? 1 : 7;
  const since  = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  // ── Aggregations in parallel ──────────────────────────────────────
  const [
    totalEvents,
    eventBreakdown,
    deviceBreakdown,
    browserBreakdown,
    dailySessions,
    topPages,
    funnelRaw,
    avgDurationRaw,
    recentEvents,
  ] = await Promise.all([
    // total events
    AnalyticsEvent.countDocuments({ timestamp: { $gte: since } }),

    // event type counts
    AnalyticsEvent.aggregate([
      { $match: { timestamp: { $gte: since } } },
      { $group: { _id: '$event', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
    ]),

    // device breakdown
    AnalyticsEvent.aggregate([
      { $match: { timestamp: { $gte: since }, event: 'session_start' } },
      { $group: { _id: '$device', count: { $sum: 1 } } },
    ]),

    // browser breakdown
    AnalyticsEvent.aggregate([
      { $match: { timestamp: { $gte: since }, event: 'session_start' } },
      { $group: { _id: '$browser', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 5 },
    ]),

    // daily unique sessions
    AnalyticsEvent.aggregate([
      { $match: { timestamp: { $gte: since }, event: 'session_start' } },
      { $group: {
          _id: { $dateToString: { format: '%Y-%m-%d', date: '$timestamp' } },
          sessions: { $sum: 1 },
      }},
      { $sort: { _id: 1 } },
    ]),

    // top pages
    AnalyticsEvent.aggregate([
      { $match: { timestamp: { $gte: since }, event: 'page_view' } },
      { $group: { _id: '$page', views: { $sum: 1 } } },
      { $sort: { views: -1 } },
      { $limit: 8 },
    ]),

    // funnel: unique sessions at each step
    Promise.all([
      'session_start', 'product_view', 'add_to_cart',
      'checkout_start', 'payment_start', 'payment_success',
    ].map(ev =>
      AnalyticsEvent.distinct('sessionId', { event: ev, timestamp: { $gte: since } })
        .then(ids => ({ event: ev, count: ids.length }))
    )),

    // avg session duration (from session_end events)
    AnalyticsEvent.aggregate([
      { $match: { timestamp: { $gte: since }, event: 'session_end', duration: { $gt: 0 } } },
      { $group: { _id: null, avg: { $avg: '$duration' }, total: { $sum: 1 } } },
    ]),

    // recent 20 events
    AnalyticsEvent.find({ timestamp: { $gte: since } })
      .sort('-timestamp')
      .limit(20)
      .populate('userId', 'name email')
      .select('sessionId event page device browser properties timestamp userId country countryCode city region'),
  ]);

  // Location aggregations (separate — not in the main parallel block)
  const [countryBreakdown, cityBreakdown] = await Promise.all([
    AnalyticsEvent.aggregate([
      { $match: { timestamp: { $gte: since }, event: 'session_start', country: { $ne: '' } } },
      { $group: { _id: { country: '$country', countryCode: '$countryCode' }, sessions: { $sum: 1 } } },
      { $sort: { sessions: -1 } },
      { $limit: 15 },
    ]),
    AnalyticsEvent.aggregate([
      { $match: { timestamp: { $gte: since }, event: 'session_start', city: { $ne: '' } } },
      { $group: { _id: { city: '$city', country: '$country', countryCode: '$countryCode' }, sessions: { $sum: 1 } } },
      { $sort: { sessions: -1 } },
      { $limit: 10 },
    ]),
  ]);

  // unique session count
  const uniqueSessions = await AnalyticsEvent.distinct('sessionId', {
    timestamp: { $gte: since }, event: 'session_start',
  }).then(ids => ids.length);

  // unique logged-in users
  const loggedInUsers = await AnalyticsEvent.distinct('userId', {
    timestamp: { $gte: since }, userId: { $ne: null },
  }).then(ids => ids.filter(Boolean).length);

  const avgDuration = avgDurationRaw[0]?.avg || 0;

  res.json({
    range,
    totalEvents,
    uniqueSessions,
    loggedInUsers,
    avgDuration: Math.round(avgDuration),
    eventBreakdown,
    deviceBreakdown,
    browserBreakdown,
    dailySessions,
    topPages,
    funnel: funnelRaw,
    recentEvents,
    countryBreakdown,
    cityBreakdown,
  });
});

module.exports = router;
