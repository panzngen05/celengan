// celengan-api/controllers/transactionController.js
const pool = require('../config/db');
const axios = require('axios'); // Sudah ada untuk QRIS
const crypto = require('crypto'); // Sudah ada untuk QRIS
const { confirmTargetDeposit } = require('../services/paymentService'); // Sudah ada untuk QRIS

// @desc    Get all transactions for the logged-in user with filtering and pagination
// @route   GET /api/transactions
// @access  Private (requires JWT)
const getUserTransactions = async (req, res) => {
    const user_id = req.user.id; // Diambil dari middleware 'protect' (JWT)

    // Ambil parameter query untuk filtering dan pagination
    const { target_id, jenis_transaksi, start_date, end_date } = req.query;
    const page = parseInt(req.query.page, 10) || 1;
    const limit = parseInt(req.query.limit, 10) || 10;
    const offset = (page - 1) * limit;

    let query = `
        SELECT 
            t.id, 
            t.target_id, 
            tg.nama_target, 
            t.jenis_transaksi, 
            t.jumlah, 
            t.deskripsi, 
            t.tanggal_transaksi, 
            t.payment_gateway_ref 
        FROM transactions t 
        JOIN targets tg ON t.target_id = tg.id 
        WHERE t.user_id = ?
    `;
    const queryParams = [user_id];
    
    let countQuery = 'SELECT COUNT(*) AS total_records FROM transactions t WHERE t.user_id = ?';
    const countQueryParams = [user_id];

    // Tambahkan filter jika ada
    if (target_id) {
        query += ' AND t.target_id = ?';
        queryParams.push(target_id);
        countQuery += ' AND t.target_id = ?';
        countQueryParams.push(target_id);
    }
    if (jenis_transaksi) {
        query += ' AND t.jenis_transaksi = ?';
        queryParams.push(jenis_transaksi);
        countQuery += ' AND t.jenis_transaksi = ?';
        countQueryParams.push(jenis_transaksi);
    }
    if (start_date) {
        query += ' AND DATE(t.tanggal_transaksi) >= ?';
        queryParams.push(start_date);
        countQuery += ' AND DATE(t.tanggal_transaksi) >= ?';
        countQueryParams.push(start_date);
    }
    if (end_date) {
        query += ' AND DATE(t.tanggal_transaksi) <= ?';
        queryParams.push(end_date);
        countQuery += ' AND DATE(t.tanggal_transaksi) <= ?';
        countQueryParams.push(end_date);
    }

    query += ' ORDER BY t.tanggal_transaksi DESC LIMIT ? OFFSET ?';
    queryParams.push(limit, offset);

    try {
        const [transactions] = await pool.query(query, queryParams);
        const [totalResult] = await pool.query(countQuery, countQueryParams);
        
        const total_records = totalResult[0].total_records;
        const total_pages = Math.ceil(total_records / limit);

        res.json({
            message: 'Riwayat transaksi berhasil diambil.',
            data: transactions,
            pagination: {
                page: page,
                limit: limit,
                total_records: total_records,
                total_pages: total_pages,
                has_next_page: page < total_pages,
                has_prev_page: page > 1
            }
        });
    } catch (error) {
        console.error('Error saat mengambil riwayat transaksi:', error);
        res.status(500).json({ message: 'Terjadi kesalahan pada server saat mengambil riwayat transaksi.' });
    }
};

// --- Fungsi makeManualDeposit, initiateQrisPayment, checkQrisPaymentStatus ---
// PASTIKAN FUNGSI-FUNGSI INI JUGA ADA DI FILE INI (dari pembahasan QRIS sebelumnya)

// @desc    Make a manual deposit to a target (misalnya transfer bank manual yang dikonfirmasi admin)
// @route   POST /api/transactions/deposit-manual
// @access  Private
const makeManualDeposit = async (req, res) => {
    // ... (implementasi makeManualDeposit seperti sebelumnya)
    const { target_id, jumlah, deskripsi } = req.body;
    const user_id = req.user.id;

    if (!target_id || !jumlah || parseFloat(jumlah) <= 0) {
        return res.status(400).json({ message: 'Target ID dan jumlah deposit (positif) diperlukan' });
    }

    try {
        const paymentRef = `MANUAL-${crypto.randomBytes(8).toString('hex')}`;
        const result = await confirmTargetDeposit(user_id, target_id, jumlah, deskripsi || 'Manual deposit', paymentRef);
        res.status(201).json(result);
    } catch (error) {
        console.error("Error pada makeManualDeposit:", error);
        res.status(500).json({ message: error.message || 'Server error processing manual deposit' });
    }
};

// @desc    Initiate QRIS payment
// @route   POST /api/transactions/qris/initiate
// @access  Private
const initiateQrisPayment = async (req, res) => {
    // ... (implementasi initiateQrisPayment seperti sebelumnya)
    const { target_id, amount } = req.body;
    const user_id = req.user.id;

    if (!target_id || !amount || parseFloat(amount) <= 0) {
        return res.status(400).json({ message: 'Target ID dan jumlah pembayaran (positif) diperlukan.' });
    }

    const ourTransactionRef = `QRIS-${user_id}-${target_id}-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
    const panzngenApiKey = process.env.PANZNGEN_API_KEY;
    const panzngenBaseUrl = process.env.PANZNGEN_API_BASE_URL;
    const codeqr = req.body.codeqr || process.env.PANZNGEN_DEFAULT_CODEQR;


    if (!panzngenApiKey || !panzngenBaseUrl) {
        console.error("Konfigurasi PanzNGen API tidak lengkap di .env");
        return res.status(500).json({ message: "Layanan pembayaran tidak terkonfigurasi dengan benar." });
    }

    try {
        const createPaymentUrl = `${panzngenBaseUrl}/createpayment`;
        const panzngenResponse = await axios.get(createPaymentUrl, {
            params: {
                apikey: panzngenApiKey,
                amount: parseFloat(amount),
                codeqr: codeqr,
            }
        });

        if (!panzngenResponse.data || !panzngenResponse.data.success || !panzngenResponse.data.data || !panzngenResponse.data.data.keyorkut) {
            throw new Error(panzngenResponse.data.message || 'Gagal membuat pembayaran QRIS di PanzNGen.');
        }

        const { keyorkut, qr_string } = panzngenResponse.data.data;

        await pool.query(
            'INSERT INTO qris_payment_attempts (user_id, target_id, amount, panzngen_keyorkut, panzngen_payment_data, status, our_transaction_ref) VALUES (?, ?, ?, ?, ?, ?, ?)',
            [user_id, target_id, parseFloat(amount), keyorkut, qr_string || JSON.stringify(panzngenResponse.data.data), 'PENDING', ourTransactionRef]
        );

        res.status(201).json({
            message: 'Permintaan pembayaran QRIS berhasil dibuat. Silakan selesaikan pembayaran.',
            ourTransactionRef: ourTransactionRef,
            keyorkut: keyorkut,
            qrData: qr_string,
            paymentDetails: panzngenResponse.data.data
        });

    } catch (error) {
        console.error('Error saat inisiasi pembayaran QRIS:', error.response ? error.response.data : error.message);
        const errorMessage = error.response && error.response.data && error.response.data.message
                           ? error.response.data.message
                           : error.message || 'Gagal memproses permintaan pembayaran QRIS.';
        res.status(500).json({ message: errorMessage });
    }
};

// @desc    Check QRIS payment status
// @route   GET /api/transactions/qris/status/:ourTransactionRef
// @access  Private
const checkQrisPaymentStatus = async (req, res) => {
    // ... (implementasi checkQrisPaymentStatus seperti sebelumnya)
    const { ourTransactionRef } = req.params;
    const user_id = req.user.id;

    const panzngenApiKey = process.env.PANZNGEN_API_KEY;
    const panzngenBaseUrl = process.env.PANZNGEN_API_BASE_URL;
    const panzngenMerchantId = process.env.PANZNGEN_MERCHANT_ID;

    if (!panzngenApiKey || !panzngenBaseUrl || !panzngenMerchantId) {
        console.error("Konfigurasi PanzNGen API tidak lengkap di .env untuk cek status");
        return res.status(500).json({ message: "Layanan pengecekan status tidak terkonfigurasi." });
    }

    try {
        const [attempts] = await pool.query(
            'SELECT * FROM qris_payment_attempts WHERE our_transaction_ref = ? AND user_id = ?',
            [ourTransactionRef, user_id]
        );

        if (attempts.length === 0) {
            return res.status(404).json({ message: 'Referensi transaksi tidak ditemukan atau bukan milik Anda.' });
        }
        const attempt = attempts[0];

        if (attempt.status === 'SUCCESS' || attempt.status === 'FAILED' || attempt.status === 'EXPIRED') {
            return res.json({
                message: `Status pembayaran adalah ${attempt.status}.`,
                status: attempt.status,
                ourTransactionRef: attempt.our_transaction_ref,
                amount: attempt.amount
            });
        }
        if (!attempt.panzngen_keyorkut) {
             return res.status(400).json({ message: 'Data pembayaran tidak lengkap (keyorkut hilang).' });
        }

        const checkStatusUrl = `${panzngenBaseUrl}/cekstatus`;
        const statusResponse = await axios.get(checkStatusUrl, {
            params: {
                apikey: panzngenApiKey,
                merchant: panzngenMerchantId,
                keyorkut: attempt.panzngen_keyorkut,
            }
        });
        
        if (!statusResponse.data || !statusResponse.data.success || !statusResponse.data.data || !statusResponse.data.data.status) {
            throw new Error(statusResponse.data.message || 'Gagal memeriksa status pembayaran di PanzNGen.');
        }

        const paymentStatus = statusResponse.data.data.status.toUpperCase();

        await pool.query(
            'UPDATE qris_payment_attempts SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
            [paymentStatus, attempt.id]
        );

        if (paymentStatus === 'SUCCESS') {
            const depositDescription = `QRIS Deposit ref: ${attempt.our_transaction_ref}`;
            await confirmTargetDeposit(attempt.user_id, attempt.target_id, attempt.amount, depositDescription, attempt.our_transaction_ref);
            
            return res.json({
                message: 'Pembayaran QRIS berhasil dan deposit telah dicatat!',
                status: paymentStatus,
                ourTransactionRef: attempt.our_transaction_ref,
                amount: attempt.amount
            });
        } else {
            return res.json({
                message: `Status pembayaran saat ini: ${paymentStatus}.`,
                status: paymentStatus,
                ourTransactionRef: attempt.our_transaction_ref
            });
        }
    } catch (error) {
        console.error('Error saat cek status pembayaran QRIS:', error.response ? error.response.data : error.message);
        const errorMessage = error.response && error.response.data && error.response.data.message
                           ? error.response.data.message
                           : error.message || 'Gagal memeriksa status pembayaran QRIS.';
        res.status(500).json({ message: errorMessage });
    }
};
// --- Akhir dari Fungsi-Fungsi Controller ---


// Pastikan semua fungsi yang ingin Anda gunakan di rute diekspor di sini
module.exports = {
    makeManualDeposit,     // Jika Anda masih menggunakan deposit manual
    getUserTransactions,   // <-- FUNGSI YANG BARU DITAMBAHKAN/DIPASTIKAN ADA
    initiateQrisPayment,
    checkQrisPaymentStatus,
    // Tambahkan fungsi controller lain jika ada
};
