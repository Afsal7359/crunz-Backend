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

// ── Sessions list (paginated, date-filtered) ─────────────────────────
router.get('/sessions', adminAuth, async (req, res) => {
  try {
    const { date, page = 1, limit = 25 } = req.query;

    const targetDate = date ? new Date(date) : new Date();
    const start = new Date(targetDate); start.setHours(0, 0, 0, 0);
    const end   = new Date(targetDate); end.setHours(23, 59, 59, 999);

    const skip = (Number(page) - 1) * Number(limit);

    const [sessions, countResult] = await Promise.all([
      AnalyticsEvent.aggregate([
        { $match: { timestamp: { $gte: start, $lte: end } } },
        { $sort: { timestamp: 1 } },
        { $group: {
          _id: '$sessionId',
          startTime:   { $min: '$timestamp' },
          lastSeen:    { $max: '$timestamp' },
          country:     { $first: '$country' },
          countryCode: { $first: '$countryCode' },
          city:        { $first: '$city' },
          device:      { $first: '$device' },
          browser:     { $first: '$browser' },
          ip:          { $first: '$ip' },
          userId:      { $last:  '$userId' },
          eventCount:  { $sum: 1 },
          pageViews:   { $sum: { $cond: [{ $eq: ['$event', 'page_view'] },  1, 0] } },
          addToCart:   { $sum: { $cond: [{ $eq: ['$event', 'add_to_cart'] }, 1, 0] } },
          converted:   { $sum: { $cond: [{ $eq: ['$event', 'payment_success'] }, 1, 0] } },
          duration:    { $max: { $cond: [{ $eq: ['$event', 'session_end'] }, '$duration', 0] } },
          entryPage:   { $first: { $cond: [{ $eq: ['$event', 'page_view'] }, '$page', null] } },
          lastPage:    { $last:  { $cond: [{ $eq: ['$event', 'page_view'] }, '$page', null] } },
        }},
        { $sort: { startTime: -1 } },
        { $skip: skip },
        { $limit: Number(limit) },
        { $lookup: { from: 'users', localField: 'userId', foreignField: '_id', as: 'u' } },
        { $unwind: { path: '$u', preserveNullAndEmptyArrays: true } },
        { $project: {
          sessionId:   '$_id',
          startTime: 1, lastSeen: 1,
          country: 1, countryCode: 1, city: 1,
          device: 1, browser: 1, ip: 1,
          eventCount: 1, pageViews: 1, addToCart: 1, converted: 1, duration: 1,
          entryPage: 1, lastPage: 1,
          userName:  '$u.name',
          userEmail: '$u.email',
        }},
      ]),
      AnalyticsEvent.aggregate([
        { $match: { timestamp: { $gte: start, $lte: end } } },
        { $group: { _id: '$sessionId' } },
        { $count: 'total' },
      ]).then(r => r[0]?.total || 0),
    ]);

    res.json({
      sessions,
      total: countResult,
      page:  Number(page),
      pages: Math.ceil(countResult / Number(limit)),
      date:  targetDate.toISOString().split('T')[0],
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: err.message });
  }
});

// ── Single session detail (full event timeline) ──────────────────────
router.get('/sessions/:sessionId', adminAuth, async (req, res) => {
  try {
    const events = await AnalyticsEvent.find({ sessionId: req.params.sessionId })
      .sort('timestamp')
      .populate('userId', 'name email')
      .lean();
    res.json({ sessionId: req.params.sessionId, events });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ── Page-wise stats (date-filtered) ──────────────────────────────────
router.get('/pages', adminAuth, async (req, res) => {
  try {
    const { date } = req.query;
    const targetDate = date ? new Date(date) : new Date();
    const start = new Date(targetDate); start.setHours(0, 0, 0, 0);
    const end   = new Date(targetDate); end.setHours(23, 59, 59, 999);

    const pages = await AnalyticsEvent.aggregate([
      { $match: { timestamp: { $gte: start, $lte: end }, event: 'page_view' } },
      { $group: {
        _id:      '$page',
        views:    { $sum: 1 },
        sessions: { $addToSet: '$sessionId' },
        bounces:  { $sum: { $cond: [{ $eq: ['$properties.isBounce', true] }, 1, 0] } },
      }},
      { $project: {
        page:           '$_id',
        views:          1,
        uniqueVisitors: { $size: '$sessions' },
        bounces:        1,
      }},
      { $sort: { views: -1 } },
    ]);

    // Entry page stats (first page of each session)
    const entryPages = await AnalyticsEvent.aggregate([
      { $match: { timestamp: { $gte: start, $lte: end }, event: 'page_view' } },
      { $sort: { timestamp: 1 } },
      { $group: { _id: '$sessionId', firstPage: { $first: '$page' } } },
      { $group: { _id: '$firstPage', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 10 },
    ]);

    // Exit page stats (last page before session end)
    const exitPages = await AnalyticsEvent.aggregate([
      { $match: { timestamp: { $gte: start, $lte: end }, event: 'page_view' } },
      { $sort: { timestamp: -1 } },
      { $group: { _id: '$sessionId', lastPage: { $first: '$page' } } },
      { $group: { _id: '$lastPage', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 10 },
    ]);

    res.json({
      pages,
      entryPages,
      exitPages,
      date: targetDate.toISOString().split('T')[0],
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;
