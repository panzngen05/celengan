// celengan-api/routes/transactionRoutes.js
const express = require('express');
const router = express.Router();
const {
    makeManualDeposit, // Ubah nama rute ini jika perlu
    getUserTransactions,
    initiateQrisPayment,
    checkQrisPaymentStatus
} = require('../controllers/transactionController');
const { protect } = require('../middleware/authMiddleware'); // Menggunakan middleware JWT 'protect'

// Semua rute di bawah ini akan diproteksi
router.use(protect); // Terapkan middleware ke semua rute di file ini

// Rute lama untuk deposit manual (jika masih dipakai, pertimbangkan path yang lebih spesifik)
router.post('/deposit-manual', makeManualDeposit);

// Rute untuk mendapatkan riwayat transaksi pengguna
router.get('/', getUserTransactions);

// --- Rute Baru untuk QRIS ---
router.post('/qris/initiate', initiateQrisPayment);
router.get('/qris/status/:ourTransactionRef', checkQrisPaymentStatus);


module.exports = router;
