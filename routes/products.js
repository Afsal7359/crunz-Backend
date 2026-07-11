const router = require('express').Router();
const Product = require('../models/Product');
const adminAuth = require('../middleware/adminAuth');

// Public: all products (including out-of-stock — frontend shows OOS badge)
router.get('/', async (req, res) => {
  const products = await Product.find().sort('order');
  res.json(products);
});

// Admin: all products
router.get('/admin/all', adminAuth, async (req, res) => {
  const products = await Product.find().sort('order');
  res.json(products);
});

// Public: single product
router.get('/:id', async (req, res) => {
  const product = await Product.findById(req.params.id);
  if (!product) return res.status(404).json({ message: 'Product not found' });
  res.json(product);
});

// Admin: create
router.post('/', adminAuth, async (req, res) => {
  const product = await Product.create(req.body);
  res.status(201).json(product);
});

// Admin: update
router.put('/:id', adminAuth, async (req, res) => {
  const product = await Product.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true });
  if (!product) return res.status(404).json({ message: 'Product not found' });
  res.json(product);
});

// Admin: delete
router.delete('/:id', adminAuth, async (req, res) => {
  await Product.findByIdAndDelete(req.params.id);
  res.json({ message: 'Product deleted' });
});

module.exports = router;
