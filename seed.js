require('dotenv').config();
const mongoose = require('mongoose');
const Product = require('./models/Product');
const SiteContent = require('./models/SiteContent');
const User = require('./models/User');

const products = [
  {
    name: 'Spanish Tomato',
    flavor: 'Tangy · Bold',
    description: 'A rich, tangy burst of tomato flavour with a hint of authentic Spanish seasoning. Every bite is bold, satisfying and completely addictive.',
    badge: 'BEST SELLER',
    tags: ['Rich Tomato', 'Spanish Herbs', 'Tangy Burst', 'Zesty Finish'],
    priceGBP: 3.99,
    priceINR: 424,
    image: '/images/spanish-tomato.jpg',
    spice: 'Mild',
    rating: 5,
    order: 1
  },
  {
    name: 'Peri Peri Magic',
    flavor: 'Spicy · Fiery',
    description: 'Bold peri peri spice meets the natural sweetness of banana for pure flavour magic. For those who dare to taste something truly different.',
    badge: 'SPICY',
    tags: ['Peri Peri Spice', 'Fiery Heat', 'Bold Flavour', 'Smoky Finish'],
    priceGBP: 3.99,
    priceINR: 424,
    image: '/images/peri-peri.jpg',
    spice: 'Hot 🔥🔥',
    rating: 5,
    order: 2
  },
  {
    name: 'Sour & Onion Cream',
    flavor: 'Creamy · Tangy',
    description: 'A creamy, tangy delight with a perfect onion twist. Light, refreshing and totally irresistible — the fan favourite for good reason.',
    badge: 'FAN FAV',
    tags: ['Creamy', 'Tangy Sour', 'Onion Twist', 'Light & Fresh'],
    priceGBP: 3.99,
    priceINR: 424,
    image: '/images/sour-onion.jpg',
    spice: 'None',
    rating: 5,
    order: 3
  },
  {
    name: 'Classic Normal',
    flavor: 'Pure · Natural',
    description: 'The original. Pure natural banana chip with nothing but clean flavour. Simple, honest and absolutely satisfying every single time.',
    badge: 'CLASSIC',
    tags: ['Pure Banana', 'Natural', 'Lightly Salted', 'Classic Crunch'],
    priceGBP: 3.49,
    priceINR: 370,
    image: '/images/classic-normal.jpg',
    spice: 'None',
    rating: 5,
    order: 4
  }
];

const defaultContent = [
  { key: 'announce', value: 'Free delivery on orders over £25 ·  · Zero Preservatives' },
  { key: 'hero_eyebrow', value: 'Premium Banana Chips' },
  { key: 'hero_title', value: 'CRUNZ' },
  { key: 'hero_sub', value: 'Zero preservatives. Four bold flavours. The ultimate crunch in every bite.' },
  { key: 'hero_cta', value: 'Shop Now' },
  { key: 'about_title', value: 'Made with passion.\nShared with the world.' },
  { key: 'about_desc', value: 'Born in Preston, UK, Crunz was created for those who demand more from their snacks. We source the finest bananas, craft them with care, and deliver extraordinary flavour in every pack.' },
  { key: 'footer_tagline', value: 'Premium banana chips from Preston, UK. The ultimate crunch in every bite.' },
  { key: 'whatsapp', value: '447741940700' },
  { key: 'email', value: 'crunzsnacks@gmail.com' },
  { key: 'instagram', value: 'https://instagram.com/crunzofficial' },
  { key: 'free_delivery_threshold_gbp', value: 25 },
  { key: 'free_delivery_threshold_inr', value: 2500 }
];

async function seed() {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log('Connected to MongoDB');

  // Seed products
  await Product.deleteMany({});
  const created = await Product.insertMany(products);
  console.log(`✓ Seeded ${created.length} products`);

  // Seed content
  for (const c of defaultContent) {
    await SiteContent.findOneAndUpdate({ key: c.key }, c, { upsert: true });
  }
  console.log(`✓ Seeded ${defaultContent.length} content entries`);

  // Create admin user if not exists
  const adminEmail = process.env.ADMIN_EMAIL || 'admin@crunzofficial.com';
  let admin = await User.findOne({ email: adminEmail });
  if (!admin) {
    admin = await User.create({
      name: 'Crunz Admin',
      email: adminEmail,
      password: 'admin123',
      isAdmin: true,
      isVerified: true
    });
    console.log(`✓ Admin user created: ${adminEmail} / admin123`);
    console.log('  ⚠️  Change the admin password immediately!');
  } else {
    console.log(`✓ Admin user already exists: ${adminEmail}`);
  }

  await mongoose.disconnect();
  console.log('\n✅ Seed complete!\n');
}

seed().catch(err => { console.error(err); process.exit(1); });
