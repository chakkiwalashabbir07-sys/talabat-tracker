require('dotenv').config();
const express = require('express');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const mongoSanitize = require('express-mongo-sanitize');
const connectDB = require('./config/db');
const mongoose = require('mongoose');
const { verifyToken } = require('./middleware/authMiddleware');

const app = express();
app.set('trust proxy', 1);

// Set security HTTP headers with relaxed CSP for CDN, barcode scanner, and camera
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'", "https://cdn.tailwindcss.com", "https://unpkg.com", "https://cdnjs.cloudflare.com"],
        scriptSrcAttr: ["'unsafe-inline'"],
        styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
        fontSrc: ["'self'", "https://fonts.gstatic.com", "data:"],
        imgSrc: ["'self'", "data:", "blob:"],
        mediaSrc: ["'self'", "blob:"],
        workerSrc: ["'self'", "blob:"],
        connectSrc: ["'self'", "https://unpkg.com", "https://cdnjs.cloudflare.com"]
      }
    }
  })
);

// Parse JSON payload (limit size to prevent DoS attacks)
app.use(express.json({ limit: '10kb' }));
app.use(express.urlencoded({ extended: true, limit: '10kb' }));

// Prevent NoSQL query injection (Express 5 compatible)
app.use((req, res, next) => {
  if (req.body) req.body = mongoSanitize.sanitize(req.body);
  if (req.params) req.params = mongoSanitize.sanitize(req.params);
  if (req.query) mongoSanitize.sanitize(req.query);
  next();
});

app.use(express.static('public', { extensions: ['html'] }));
app.use('/tashjee-and-tanbeeh', express.static('public', { extensions: ['html'] }));

// Route aliases for clean URLs and reverse proxy subpaths (/tashjee-and-tanbeeh)
app.get('/tashjee-and-tanbeeh', (req, res) => res.redirect('/evaluation.html'));
app.get('/tashjee-and-tanbeeh/admin', (req, res) => res.redirect('/admin.html'));
app.get('/tashjee-and-tanbeeh/evaluation', (req, res) => res.redirect('/evaluation.html'));
app.get('/tashjee-and-tanbeeh/login', (req, res) => res.redirect('/login.html'));
app.get('/admin', (req, res) => res.redirect('/admin.html'));
app.get('/evaluation', (req, res) => res.redirect('/evaluation.html'));
app.get('/login', (req, res) => res.redirect('/login.html'));

// Rate Limiting: General API endpoints (Allow high throughput for live gate scanning and dashboards)
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5000,
  validate: { xForwardedForHeader: false },
  skip: (req) => {
    const url = req.originalUrl || req.url || '';
    return url.includes('/queue/status') || url.includes('/stats') || url.includes('/remarks');
  },
  message: { success: false, message: 'Too many requests, please try again later.' }
});

// Rate Limiting: Strict Auth endpoint (10 login attempts per 15 min per IP)
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  validate: { xForwardedForHeader: false },
  message: { success: false, message: 'Too many failed login attempts. Try again in 15 minutes.' }
});

// Database Connection
connectDB();

// Health Check endpoint (used by Render and uptime monitors)
app.get('/health', async (req, res) => {
  const isDbConnected = mongoose.connection.readyState === 1;
  let students = 0;
  let users = 0;
  if (isDbConnected) {
    try {
      const Student = require('./models/Student');
      const User = require('./models/User');
      students = await Student.countDocuments();
      users = await User.countDocuments();
    } catch (e) {}
  }
  res.json({
    status: 'ok',
    database: isDbConnected ? 'connected' : 'disconnected',
    students,
    users,
    message: isDbConnected ? 'System healthy' : 'Database not connected. Please verify MONGO_URI in Render Environment Variables.'
  });
});

// Auth Route
app.post('/api/auth/login', authLimiter, require('./controllers/authController').login);

// Protected API Routes
app.use('/api/student', apiLimiter, verifyToken, require('./routes/studentRoutes'));
app.use('/api/movement', apiLimiter, verifyToken, require('./routes/movementRoutes'));
app.use('/api/evaluation', apiLimiter, verifyToken, require('./routes/evaluationRoutes'));
app.use('/tashjee-and-tanbeeh/api/evaluation', apiLimiter, verifyToken, require('./routes/evaluationRoutes'));

// Global Error Handler (Prevents stack trace leaks in production)
app.use((err, req, res, next) => {
  console.error(err.stack || err);
  res.status(err.status || 500).json({
    success: false,
    message: err.message || 'Internal Server Error'
  });
});

process.on('uncaughtException', (err) => {
  console.error('[UNCAUGHT EXCEPTION]', err.message || err);
});

process.on('unhandledRejection', (reason) => {
  console.error('[UNHANDLED REJECTION]', reason ? (reason.message || reason) : 'Unknown reason');
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => console.log(`Server running in ${process.env.NODE_ENV || 'development'} mode on port ${PORT}`));