const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT) || 587,
  secure: false,
  auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  tls: { rejectUnauthorized: false }
});

const brandHeader = `
  <div style="font-family:'Inter',Arial,sans-serif;max-width:560px;margin:0 auto;padding:32px;background:#fff">
  <div style="margin-bottom:28px">
    <span style="font-size:26px;font-weight:900;letter-spacing:-1px;color:#0a0a0a">CRUNZ</span>
    <span style="font-size:11px;color:#aaa;margin-left:8px;letter-spacing:2px;text-transform:uppercase">Premium Banana Chips</span>
  </div>`;

const brandFooter = `
  <div style="margin-top:32px;padding-top:20px;border-top:1px solid #f0f0f0">
    <p style="font-size:11px;color:#aaa;margin:0">Questions? <a href="mailto:crunzsnacks@gmail.com" style="color:#0a0a0a">crunzsnacks@gmail.com</a> · WhatsApp <a href="https://wa.me/447741940700" style="color:#0a0a0a">+44 7741 940 700</a></p>
    <p style="font-size:11px;color:#ccc;margin:6px 0 0">© ${new Date().getFullYear()} CRUNZ · Preston, United Kingdom</p>
  </div></div>`;

async function sendOTP(email, otp, name) {
  await transporter.sendMail({
    from: `"Crunz Snacks" <${process.env.SMTP_USER}>`,
    to: email,
    subject: 'Your Crunz Verification Code',
    html: `${brandHeader}
      <h2 style="font-size:20px;font-weight:800;color:#0a0a0a;margin:0 0 10px">Verify your email, ${name.split(' ')[0]}</h2>
      <p style="font-size:14px;color:#666;line-height:1.6;margin:0 0 24px">Enter this code to complete your registration:</p>
      <div style="background:#0a0a0a;color:#fff;font-size:36px;font-weight:900;letter-spacing:10px;text-align:center;padding:28px;border-radius:10px;margin-bottom:20px">${otp}</div>
      <p style="font-size:12px;color:#aaa">This code expires in <strong>10 minutes</strong>. If you didn't request this, you can safely ignore this email.</p>
      ${brandFooter}`
  });
}

async function sendOrderConfirmation(email, order, name) {
  const sym = order.currency === 'INR' ? '₹' : '£';
  const total = order.currency === 'INR' ? order.totalINR : order.totalGBP;
  const orderId = order._id.toString().slice(-6).toUpperCase();

  const itemRows = order.items.map(i => {
    const price = order.currency === 'INR' ? i.priceINR : i.priceGBP;
    return `<tr>
      <td style="padding:10px 0;font-size:14px;border-bottom:1px solid #f5f5f5;color:#333">${i.name}</td>
      <td style="padding:10px 0;font-size:14px;border-bottom:1px solid #f5f5f5;color:#666;text-align:center">× ${i.qty}</td>
      <td style="padding:10px 0;font-size:14px;border-bottom:1px solid #f5f5f5;font-weight:700;text-align:right">${sym}${(price * i.qty).toFixed(2)}</td>
    </tr>`;
  }).join('');

  await transporter.sendMail({
    from: `"Crunz Snacks" <${process.env.SMTP_USER}>`,
    to: email,
    subject: `Order Confirmed #${orderId} — Thank you, ${name.split(' ')[0]}!`,
    html: `${brandHeader}
      <div style="background:#0a0a0a;color:#fff;padding:20px 24px;border-radius:10px;margin-bottom:28px">
        <p style="font-size:11px;letter-spacing:2px;text-transform:uppercase;opacity:.5;margin:0 0 6px">Order confirmed</p>
        <h2 style="font-size:24px;font-weight:900;margin:0">Order #${orderId}</h2>
      </div>
      <p style="font-size:14px;color:#555;line-height:1.7;margin:0 0 24px">Hi ${name.split(' ')[0]}, thank you for your order! We're getting it ready and will update you when it ships.</p>
      <table style="width:100%;border-collapse:collapse;margin-bottom:16px">
        <thead><tr>
          <th style="text-align:left;font-size:11px;letter-spacing:1.5px;text-transform:uppercase;color:#aaa;padding-bottom:10px;border-bottom:2px solid #f0f0f0">Item</th>
          <th style="text-align:center;font-size:11px;letter-spacing:1.5px;text-transform:uppercase;color:#aaa;padding-bottom:10px;border-bottom:2px solid #f0f0f0">Qty</th>
          <th style="text-align:right;font-size:11px;letter-spacing:1.5px;text-transform:uppercase;color:#aaa;padding-bottom:10px;border-bottom:2px solid #f0f0f0">Price</th>
        </tr></thead>
        <tbody>${itemRows}</tbody>
      </table>
      <div style="display:flex;justify-content:space-between;align-items:center;padding:14px 0;border-top:2px solid #0a0a0a">
        <span style="font-size:15px;font-weight:700">Total</span>
        <span style="font-size:20px;font-weight:900">${sym}${Number(total).toFixed(2)}</span>
      </div>
      <div style="background:#fafafa;border:1px solid #f0f0f0;border-radius:8px;padding:18px;margin-top:24px">
        <p style="font-size:11px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;color:#aaa;margin:0 0 10px">Delivery Address</p>
        <p style="font-size:14px;color:#333;margin:0;line-height:1.7">
          ${order.shippingAddress.name}<br>
          ${order.shippingAddress.street}<br>
          ${order.shippingAddress.city ? order.shippingAddress.city + ', ' : ''}${order.shippingAddress.postcode}<br>
          ${order.shippingAddress.country}
        </p>
      </div>
      ${brandFooter}`
  });
}

async function sendAdminNotification(order) {
  const sym = order.currency === 'INR' ? '₹' : '£';
  const total = order.currency === 'INR' ? order.totalINR : order.totalGBP;
  const orderId = order._id.toString().slice(-6).toUpperCase();
  const itemList = order.items.map(i => `• ${i.name} × ${i.qty}`).join('<br>');

  await transporter.sendMail({
    from: `"Crunz Orders" <${process.env.SMTP_USER}>`,
    to: process.env.ADMIN_EMAIL,
    subject: `🍌 New Order #${orderId} — ${sym}${Number(total).toFixed(2)}`,
    html: `${brandHeader}
      <div style="background:#0a0a0a;color:#fff;padding:20px 24px;border-radius:10px;margin-bottom:20px">
        <p style="font-size:11px;letter-spacing:2px;text-transform:uppercase;opacity:.5;margin:0 0 6px">New order received</p>
        <h2 style="font-size:24px;font-weight:900;margin:0">#${orderId}</h2>
      </div>
      <table style="width:100%;border-collapse:collapse;font-size:14px">
        <tr><td style="padding:8px 0;color:#666;width:140px">Total</td><td style="font-weight:800;font-size:18px">${sym}${Number(total).toFixed(2)} (${order.currency})</td></tr>
        <tr><td style="padding:8px 0;color:#666">Items</td><td style="color:#333">${itemList}</td></tr>
        <tr><td style="padding:8px 0;color:#666">Customer</td><td style="font-weight:600">${order.shippingAddress.name}</td></tr>
        <tr><td style="padding:8px 0;color:#666">Phone</td><td>${order.shippingAddress.phone || 'N/A'}</td></tr>
        <tr><td style="padding:8px 0;color:#666">Address</td><td>${order.shippingAddress.street}, ${order.shippingAddress.city || ''} ${order.shippingAddress.postcode}, ${order.shippingAddress.country}</td></tr>
        <tr><td style="padding:8px 0;color:#666">Payment</td><td style="color:#16a34a;font-weight:700">✓ ${order.paymentStatus}</td></tr>
      </table>
      ${brandFooter}`
  });
}

module.exports = { sendOTP, sendOrderConfirmation, sendAdminNotification };
