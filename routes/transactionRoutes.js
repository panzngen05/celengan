// celengan-api/routes/transactionRoutes.js
const express = require('express');
const router = express.Router();
const {
    makeManualDeposit,
    getUserTransactions,
    confirmQrisPaymentByUser,
    handleWithdrawal,
    getAppConfig
} = require('../controllers/transactionController');
const { protect } = require('../middleware/authMiddleware'); // Middleware JWT

// Rute untuk konfigurasi bisa diakses tanpa login jika hanya berisi info publik
// Jika berisi info sensitif, pindahkan ke bawah router.use(protect)
router.get('/config', getAppConfig);

// Semua rute di bawah ini memerlukan autentikasi (login dengan PIN -> dapat JWT)
router.use(protect);

router.post('/deposit-manual', makeManualDeposit);
router.get('/', getUserTransactions); // Untuk melihat riwayat transaksi
router.post('/qris/confirm-payment', confirmQrisPaymentByUser); // Konfirmasi QRIS oleh pengguna
router.post('/withdraw', handleWithdrawal); // Penarikan dana

module.exports = router;
