function safeEqual(a, b) {
  const crypto = require('node:crypto');
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const aa = Buffer.from(a); const bb = Buffer.from(b);
  return aa.length === bb.length && crypto.timingSafeEqual(aa, bb);
}
function uploadAuth(req, res, next) {
  if (!safeEqual(req.get('x-upload-key') || '', process.env.UPLOAD_KEY || '')) {
    return res.status(401).json({ error: 'Invalid upload key.' });
  }
  next();
}
function deviceAuth(req, res, next) {
  const token = (req.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (!safeEqual(token, process.env.DEVICE_TOKEN || '')) {
    return res.status(401).json({ error: 'Device authentication failed.' });
  }
  next();
}
module.exports = { uploadAuth, deviceAuth };
