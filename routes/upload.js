const router = require('express').Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const adminAuth = require('../middleware/adminAuth');
const { v2: cloudinary } = require('cloudinary');

if (process.env.CLOUDINARY_CLOUD_NAME) {
  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key:    process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
  });
}

function diskStorage(subdir = '') {
  return multer.diskStorage({
    destination: (req, file, cb) => {
      const dir = path.join(__dirname, '..', 'uploads', subdir);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      cb(null, dir);
    },
    filename: (req, file, cb) => {
      const unique = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
      cb(null, unique + path.extname(file.originalname).toLowerCase());
    }
  });
}

// ── Image upload (5 MB, images only) ──────────────────────────────────
const imageUpload = multer({
  storage: diskStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (/\.(jpe?g|png|webp|gif)$/i.test(file.originalname)) cb(null, true);
    else cb(new Error('Only image files allowed (jpg, png, webp, gif)'));
  }
});

router.post('/', adminAuth, imageUpload.single('image'), (req, res) => {
  if (!req.file) return res.status(400).json({ message: 'No file uploaded' });
  const backendUrl = process.env.BACKEND_URL || `http://localhost:${process.env.PORT || 5000}`;
  res.json({
    url: `${backendUrl}/uploads/${req.file.filename}`,
    filename: req.file.filename
  });
});

// ── Video upload (25 MB, video only) ──────────────────────────────────
const videoUpload = multer({
  storage: diskStorage('videos'),
  limits: { fileSize: 25 * 1024 * 1024 }, // 25 MB
  fileFilter: (req, file, cb) => {
    if (/\.(mp4|webm|mov|avi|mkv)$/i.test(file.originalname)) cb(null, true);
    else cb(new Error('Only video files allowed (mp4, webm, mov, avi, mkv)'));
  }
});

router.post('/video', adminAuth, videoUpload.single('video'), (req, res) => {
  if (!req.file) return res.status(400).json({ message: 'No file uploaded' });
  const backendUrl = process.env.BACKEND_URL || `http://localhost:${process.env.PORT || 5000}`;
  res.json({
    url: `${backendUrl}/uploads/videos/${req.file.filename}`,
    filename: req.file.filename
  });
});

// ── Delete a video file by filename ──────────────────────────────────
router.delete('/video/:filename', adminAuth, (req, res) => {
  const { filename } = req.params;
  // Only allow safe filenames — no path traversal
  if (!filename || /[/\\]/.test(filename)) {
    return res.status(400).json({ message: 'Invalid filename' });
  }
  const filePath = path.join(__dirname, '..', 'uploads', 'videos', filename);
  if (!fs.existsSync(filePath)) {
    return res.json({ message: 'File not found (already deleted)' });
  }
  fs.unlink(filePath, err => {
    if (err) return res.status(500).json({ message: 'Failed to delete file' });
    res.json({ message: 'Deleted' });
  });
});

// ── Delete a Cloudinary asset by public_id ────────────────────────────
router.delete('/cloudinary', adminAuth, async (req, res) => {
  const { publicId } = req.body;
  if (!publicId) return res.status(400).json({ message: 'publicId is required' });

  if (!process.env.CLOUDINARY_CLOUD_NAME) {
    return res.status(501).json({ message: 'Cloudinary not configured on server' });
  }

  const result = await cloudinary.uploader.destroy(publicId, { resource_type: 'video' });
  if (result.result === 'ok' || result.result === 'not found') {
    return res.json({ message: 'Deleted', result: result.result });
  }
  res.status(500).json({ message: 'Cloudinary deletion failed', result: result.result });
});

module.exports = router;
