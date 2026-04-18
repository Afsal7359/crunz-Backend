const router = require('express').Router();
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { OAuth2Client } = require('google-auth-library');
const User = require('../models/User');
const authMiddleware = require('../middleware/auth');
const { sendOTP } = require('../utils/mailer');

const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);
const signToken = (id) => jwt.sign({ id }, process.env.JWT_SECRET, { expiresIn: '30d' });
const userPayload = (u) => ({ id: u._id, name: u.name, email: u.email, isAdmin: u.isAdmin, addresses: u.addresses });

// Register — sends OTP
router.post('/register', async (req, res) => {
  const { name, email, password } = req.body;
  if (!name || !email || !password) return res.status(400).json({ message: 'All fields required' });

  let user = await User.findOne({ email });
  if (user && user.isVerified) return res.status(400).json({ message: 'Email already registered. Please sign in.' });

  const otp = crypto.randomInt(100000, 999999).toString();
  const otpExpiry = new Date(Date.now() + 10 * 60 * 1000);

  if (!user) {
    user = new User({ name, email, password, otp, otpExpiry });
  } else {
    user.name = name;
    user.password = password;
    user.otp = otp;
    user.otpExpiry = otpExpiry;
  }
  await user.save();
  await sendOTP(email, otp, name);
  res.json({ message: 'OTP sent to your email', userId: user._id });
});

// Verify OTP
router.post('/verify-otp', async (req, res) => {
  const { userId, otp } = req.body;
  const user = await User.findById(userId).select('+otp +otpExpiry');
  if (!user) return res.status(404).json({ message: 'User not found' });
  if (user.otp !== String(otp)) return res.status(400).json({ message: 'Invalid OTP' });
  if (new Date() > new Date(user.otpExpiry)) return res.status(400).json({ message: 'OTP expired. Please resend.' });

  user.isVerified = true;
  user.otp = undefined;
  user.otpExpiry = undefined;
  await user.save();

  res.json({ token: signToken(user._id), user: userPayload(user) });
});

// Resend OTP
router.post('/resend-otp', async (req, res) => {
  const { userId } = req.body;
  const user = await User.findById(userId);
  if (!user) return res.status(404).json({ message: 'User not found' });
  const otp = crypto.randomInt(100000, 999999).toString();
  user.otp = otp;
  user.otpExpiry = new Date(Date.now() + 10 * 60 * 1000);
  await user.save();
  await sendOTP(user.email, otp, user.name);
  res.json({ message: 'OTP resent successfully' });
});

// Login
router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  const user = await User.findOne({ email }).select('+password');
  if (!user || !user.password) return res.status(400).json({ message: 'Invalid email or password' });
  if (!user.isVerified) {
    return res.status(400).json({ message: 'Please verify your email first', userId: user._id, needsVerification: true });
  }
  const match = await user.comparePassword(password);
  if (!match) return res.status(400).json({ message: 'Invalid email or password' });
  res.json({ token: signToken(user._id), user: userPayload(user) });
});

// Google OAuth
router.post('/google', async (req, res) => {
  const { credential } = req.body;
  if (!credential) return res.status(400).json({ message: 'Google credential required' });

  const ticket = await client.verifyIdToken({ idToken: credential, audience: process.env.GOOGLE_CLIENT_ID });
  const { sub, name, email } = ticket.getPayload();

  let user = await User.findOne({ $or: [{ googleId: sub }, { email }] });
  if (!user) {
    user = await User.create({ name, email, googleId: sub, isVerified: true });
  } else if (!user.googleId) {
    user.googleId = sub;
    user.isVerified = true;
    await user.save();
  }

  res.json({ token: signToken(user._id), user: userPayload(user) });
});

// Get current user
router.get('/me', authMiddleware, (req, res) => {
  res.json({ user: userPayload(req.user) });
});

// Add address
router.post('/address', authMiddleware, async (req, res) => {
  const user = await User.findById(req.user._id);
  const addr = req.body;
  if (addr.isDefault) user.addresses.forEach(a => (a.isDefault = false));
  user.addresses.push(addr);
  await user.save();
  res.json({ addresses: user.addresses });
});

// Delete address
router.delete('/address/:index', authMiddleware, async (req, res) => {
  const user = await User.findById(req.user._id);
  user.addresses.splice(Number(req.params.index), 1);
  await user.save();
  res.json({ addresses: user.addresses });
});

module.exports = router;
