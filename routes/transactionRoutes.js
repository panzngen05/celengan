// celengan-api/routes/transactionRoutes.js
const express = require('express');
const router = express.Router();
const {
    makeManualDeposit,
    getUserTransactions,
    confirmQrisPaymentByUser, // Fungsi controller baru
    getAppConfig             // Fungsi controller baru
} = require('../controllers/transactionController');
const { protect } = require('../middleware/authMiddleware');

// Rute untuk konfigurasi (bisa diproteksi atau tidak, tergantung kebutuhan)
router.get('/config', getAppConfig); // Misal: /api/transactions/config

// Semua rute di bawah ini memerlukan autentikasi
router.use(protect);

router.post('/deposit-manual', makeManualDeposit);
router.get('/', getUserTransactions);

// Rute baru untuk konfirmasi pembayaran QRIS oleh pengguna
router.post('/qris/confirm-payment', confirmQrisPaymentByUser);

module.exports = router;
