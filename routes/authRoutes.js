// celengan-api/routes/authRoutes.js
const express = require('express');
const router = express.Router();
const {
    registerUserWithPin,
    loginUserWithPin,
    getUserProfile
} = require('../controllers/authController');
const { protect } = require('../middleware/authMiddleware');

// Impor dan konfigurasi rate limiter di sini
const rateLimit = require('express-rate-limit');
const pinLoginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 menit
    max: 5, // Batasi setiap IP (+email) untuk 5 percobaan login PIN
    message: { message: 'Terlalu banyak percobaan login dengan PIN, silakan coba lagi setelah 15 menit.' },
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req, res) => {
        return req.ip + (req.body.email || '');
    }
});

router.post('/register-pin', registerUserWithPin);
router.post('/login-pin', pinLoginLimiter, loginUserWithPin); // Terapkan limiter di sini
router.get('/profile', protect, getUserProfile);

module.exports = router;
