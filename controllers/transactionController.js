// celengan-api/controllers/transactionController.js
const pool = require('../config/db');
const crypto = require('crypto'); // Untuk referensi unik jika perlu
const { confirmTargetDeposit } = require('../services/paymentService'); // Pastikan path ini benar

// @desc    Get all transactions for the logged-in user
// @route   GET /api/transactions
// @access  Private
const getUserTransactions = async (req, res) => {
    const user_id = req.user.id;
    const { target_id, jenis_transaksi, start_date, end_date } = req.query;
    const page = parseInt(req.query.page, 10) || 1;
    const limit = parseInt(req.query.limit, 10) || 10;
    const offset = (page - 1) * limit;

    let query = `
        SELECT 
            t.id, t.target_id, tg.nama_target, t.jenis_transaksi, t.jumlah, 
            t.deskripsi, t.tanggal_transaksi, t.payment_gateway_ref 
        FROM transactions t 
        JOIN targets tg ON t.target_id = tg.id 
        WHERE t.user_id = ?`;
    const queryParams = [user_id];
    
    let countQuery = 'SELECT COUNT(*) AS total_records FROM transactions t WHERE t.user_id = ?';
    const countQueryParams = [user_id];

    if (target_id) { query += ' AND t.target_id = ?'; queryParams.push(target_id); countQuery += ' AND t.target_id = ?'; countQueryParams.push(target_id); }
    if (jenis_transaksi) { query += ' AND t.jenis_transaksi = ?'; queryParams.push(jenis_transaksi); countQuery += ' AND t.jenis_transaksi = ?'; countQueryParams.push(jenis_transaksi); }
    if (start_date) { query += ' AND DATE(t.tanggal_transaksi) >= ?'; queryParams.push(start_date); countQuery += ' AND DATE(t.tanggal_transaksi) >= ?'; countQueryParams.push(start_date); }
    if (end_date) { query += ' AND DATE(t.tanggal_transaksi) <= ?'; queryParams.push(end_date); countQuery += ' AND DATE(t.tanggal_transaksi) <= ?'; countQueryParams.push(end_date); }

    query += ' ORDER BY t.tanggal_transaksi DESC LIMIT ? OFFSET ?';
    queryParams.push(limit, offset);

    try {
        const [transactions] = await pool.query(query, queryParams);
        const [totalResult] = await pool.query(countQuery, countQueryParams);
        
        let total_records = 0;
        if (totalResult && totalResult.length > 0 && totalResult[0] && totalResult[0].total_records !== undefined) {
            total_records = parseInt(totalResult[0].total_records, 10);
        } else {
            console.warn("Query COUNT untuk transaksi tidak mengembalikan hasil yang diharapkan atau total_records undefined:", totalResult);
        }
        
        const total_pages = Math.ceil(total_records / limit);

        res.json({
            message: 'Riwayat transaksi berhasil diambil.',
            data: transactions,
            pagination: { page, limit, total_records, total_pages, has_next_page: page < total_pages, has_prev_page: page > 1 }
        });
    } catch (error) {
        console.error('Error saat mengambil riwayat transaksi:', error);
        res.status(500).json({ message: 'Gagal mengambil data transaksi dari server.' }); 
    }
};

// @desc    Make a manual deposit (admin confirmation or other manual processes)
// @route   POST /api/transactions/deposit-manual
// @access  Private
const makeManualDeposit = async (req, res) => {
    const { target_id, jumlah, deskripsi } = req.body;
    const user_id = req.user.id;

    if (!target_id || !jumlah || parseFloat(jumlah) <= 0) {
        return res.status(400).json({ message: 'Target ID dan jumlah deposit (positif) diperlukan' });
    }

    try {
        const paymentRef = `MANUAL-${user_id}-${Date.now()}`;
        const result = await confirmTargetDeposit(user_id, parseInt(target_id), parseFloat(jumlah), deskripsi || 'Deposit manual', paymentRef);
        res.status(201).json(result);
    } catch (error) {
        res.status(500).json({ message: error.message || 'Server error processing manual deposit' });
    }
};

// @desc    Confirm QRIS payment by user (user clicks "I have paid")
// @route   POST /api/transactions/qris/confirm-payment
// @access  Private
const confirmQrisPaymentByUser = async (req, res) => {
    const { target_id, amount } = req.body; // `ourTransactionRef` bisa dibuat di sini atau opsional dari frontend
    const user_id = req.user.id;

    if (!target_id || !amount || parseFloat(amount) <= 0) {
        return res.status(400).json({ message: 'Target ID dan jumlah pembayaran (positif) diperlukan untuk konfirmasi.' });
    }

    try {
        // Buat referensi pembayaran unik
        const paymentReference = `QRIS_USERCONF-${user_id}-${target_id}-${Date.now()}-${crypto.randomBytes(2).toString('hex')}`;
        const description = `Deposit QRIS (dikonfirmasi pengguna) Rp${parseFloat(amount)}`;

        // Panggil service yang sama dengan deposit manual
        const result = await confirmTargetDeposit(
            user_id,
            parseInt(target_id),
            parseFloat(amount),
            description,
            paymentReference
        );

        // Hapus tabel qris_payment_attempts atau data terkait jika sudah tidak dibutuhkan
        // Misal, jika Anda masih menggunakan tabel itu untuk referensi sementara sebelum konfirmasi:
        // await pool.query('DELETE FROM qris_payment_attempts WHERE our_transaction_ref = ? AND user_id = ?', [req.body.ourTransactionRef, user_id]);
        // Namun dengan alur baru ini, tabel qris_payment_attempts tidak lagi sentral untuk QRIS.

        res.status(200).json({
            message: 'Konfirmasi pembayaran QRIS Anda telah diterima dan saldo target diperbarui.',
            transactionDetails: result // Mengembalikan detail transaksi yang dibuat
        });

    } catch (error) {
        // confirmTargetDeposit sudah melakukan console.error
        res.status(500).json({ message: error.message || 'Gagal memproses konfirmasi pembayaran QRIS Anda.' });
    }
};

// Endpoint untuk mengambil konfigurasi dasar, termasuk URL QRIS statis
// @desc    Get app configuration
// @route   GET /api/config
// @access  Public or Private (tergantung kebutuhan)
const getAppConfig = (req, res) => {
    const staticQrisImageUrl = process.env.STATIC_QRIS_IMAGE_URL;
    if (!staticQrisImageUrl || staticQrisImageUrl === "URL_GAMBAR_QRIS_STATIS_ANDA_DISINI") {
        console.warn("PERINGATAN: STATIC_QRIS_IMAGE_URL belum diatur dengan benar di .env");
        return res.status(500).json({ message: "Konfigurasi QRIS belum lengkap di server."});
    }
    res.json({
        staticQrisImageUrl: staticQrisImageUrl
    });
};


module.exports = {
    makeManualDeposit,
    getUserTransactions,
    confirmQrisPaymentByUser,
    getAppConfig, // Tambahkan ini
};
