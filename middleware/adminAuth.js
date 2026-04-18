const authMiddleware = require('./auth');

module.exports = async (req, res, next) => {
  await authMiddleware(req, res, () => {
    if (!req.user || !req.user.isAdmin) {
      return res.status(403).json({ message: 'Admin access required' });
    }
    next();
  });
};
