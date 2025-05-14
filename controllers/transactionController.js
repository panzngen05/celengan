// celengan-api/controllers/transactionController.js

const pool = require('../config/db');
const axios = require('axios'); // Untuk memanggil API eksternal
const crypto = require('crypto'); // Untuk generate ID unik internal jika diperlukan
const { confirmTargetDeposit } = require('../services/paymentService'); // Pastikan path ini benar

// @desc    Get all transactions for the logged-in user with filtering and pagination
// @route   GET /api/transactions
// @access  Private (requires JWT)
const getUserTransactions = async (req, res) => {
    const user_id = req.user.id; // Diambil dari middleware 'protect' (JWT)
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
        const total_records = totalResult[0].total_records;
        const total_pages = Math.ceil(total_records / limit);

        res.json({
            message: 'Riwayat transaksi berhasil diambil.',
            data: transactions,
            pagination: { page, limit, total_records, total_pages, has_next_page: page < total_pages, has_prev_page: page > 1 }
        });
    } catch (error) {
        console.error('Error saat mengambil riwayat transaksi:', error);
        res.status(500).json({ message: 'Terjadi kesalahan pada server saat mengambil riwayat transaksi.' });
    }
};

// @desc    Make a manual deposit (misalnya admin confirmation, bukan via payment gateway otomatis)
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
        // confirmTargetDeposit sudah melakukan console.error
        res.status(500).json({ message: error.message || 'Server error processing manual deposit' });
    }
};

// @desc    Initiate QRIS payment using PanzNgen API
// @route   POST /api/transactions/qris/initiate
// @access  Private
const initiateQrisPayment = async (req, res) => {
    const { target_id, amount } = req.body;
    const user_id = req.user.id;

    if (!target_id || !amount || parseFloat(amount) <= 0) {
        return res.status(400).json({ message: 'Target ID dan jumlah pembayaran (positif) diperlukan.' });
    }

    const ourTransactionRef = `QRIS-${user_id}-${target_id}-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
    
    const panzngenCreateUrl = process.env.PANZNGEN_CREATE_PAYMENT_URL;
    const panzngenApiKey = process.env.PANZNGEN_API_KEY;
    const panzngenMerchantQrPayload = process.env.PANZNGEN_MERCHANT_QR_PAYLOAD;

    if (!panzngenCreateUrl || !panzngenApiKey || !panzngenMerchantQrPayload) {
        console.error("Konfigurasi PanzNGen API (URL, API Key, atau QR Payload) tidak lengkap di .env");
        return res.status(500).json({ message: "Layanan pembayaran QRIS tidak terkonfigurasi dengan benar." });
    }

    try {
        const params = {
            apikey: panzngenApiKey,
            amount: parseFloat(amount),
            codeqr: panzngenMerchantQrPayload,
        };

        console.log(`Memanggil PanzNGen Create Payment: URL=${panzngenCreateUrl}, Params=`, params);
        const panzngenResponse = await axios.get(panzngenCreateUrl, { params });
        console.log("Respons dari PanzNGen Create Payment:", JSON.stringify(panzngenResponse.data, null, 2));

        // Struktur respons PanzNGen yang diharapkan (berdasarkan log pengguna):
        // {"status":true,"creator":"PanzNgen","result":{"transactionId":"...", "qrImageUrl":"..."}}
        if (panzngenResponse.data && panzngenResponse.data.status === true && panzngenResponse.data.result && panzngenResponse.data.result.transactionId) {
            
            const panzngenTransactionId = panzngenResponse.data.result.transactionId;
            const qrDataForDisplay = panzngenResponse.data.result.qrImageUrl;

            await pool.query(
                'INSERT INTO qris_payment_attempts (user_id, target_id, amount, panzngen_keyorkut, panzngen_payment_data, status, our_transaction_ref) VALUES (?, ?, ?, ?, ?, ?, ?)',
                [user_id, parseInt(target_id), parseFloat(amount), panzngenTransactionId, qrDataForDisplay, 'PENDING', ourTransactionRef]
            );

            res.status(201).json({
                message: 'Permintaan pembayaran QRIS berhasil dibuat. Silakan selesaikan pembayaran.',
                ourTransactionRef: ourTransactionRef,
                keyorkut: panzngenTransactionId,
                qrData: qrDataForDisplay,
                paymentDetails: panzngenResponse.data.result
            });
        } else {
            const panzngenErrorMessage = panzngenResponse.data ? (panzngenResponse.data.message || JSON.stringify(panzngenResponse.data)) : 'Respons tidak dikenal dari PanzNGen.';
            console.error("PanzNGen mengembalikan error atau format tidak dikenal:", panzngenErrorMessage);
            throw new Error(`Gagal membuat pembayaran QRIS di PanzNGen: ${panzngenErrorMessage}`);
        }

    } catch (error) {
        const errorDetails = error.response ? JSON.stringify(error.response.data) : error.message;
        console.error('Error saat inisiasi pembayaran QRIS:', errorDetails);
        
        let clientErrorMessage = 'Gagal memproses permintaan pembayaran QRIS.';
        if (error.message && error.message.startsWith('Gagal membuat pembayaran QRIS di PanzNGen:')) {
            clientErrorMessage = error.message;
        } else if (error.response && error.response.data && error.response.data.message) {
            clientErrorMessage = error.response.data.message;
        }
        
        res.status(500).json({ message: clientErrorMessage });
    }
};

// @desc    Check QRIS payment status using Decode Rerezz API
// @route   GET /api/transactions/qris/status/:ourTransactionRef
// @access  Private
const checkQrisPaymentStatus = async (req, res) => {
    const { ourTransactionRef } = req.params;
    const user_id = req.user.id;

    const decodeStatusUrl = process.env.DECODE_REREZZ_STATUS_URL;
    const decodeApiKey = process.env.DECODE_REREZZ_API_KEY;
    const decodeMemid = process.env.DECODE_REREZZ_MEMID;

    if (!decodeStatusUrl || !decodeApiKey || !decodeMemid) {
        console.error("Konfigurasi API Decode Rerezz (URL, API Key, atau MEMID) tidak lengkap di .env");
        return res.status(500).json({ message: "Layanan pengecekan status pembayaran tidak terkonfigurasi." });
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
            return res.json({ message: `Status pembayaran adalah ${attempt.status}.`, status: attempt.status, ourTransactionRef: attempt.our_transaction_ref, amount: attempt.amount });
        }

        if (!attempt.panzngen_keyorkut) {
             return res.status(400).json({ message: 'Data pembayaran tidak lengkap (keyorkut dari PanzNGen hilang).' });
        }

        const params = {
            memid: decodeMemid,
            keyorkut: attempt.panzngen_keyorkut,
            apikey: decodeApiKey,
        };
        
        console.log(`Memanggil Decode Rerezz Cek Status: URL=${decodeStatusUrl}, Params=`, params);
        const statusResponse = await axios.get(decodeStatusUrl, { params });
        console.log("Respons dari Decode Rerezz Cek Status:", JSON.stringify(statusResponse.data, null, 2));

        // Asumsi struktur respons Decode Rerezz, sesuaikan jika perlu:
        // {"status":200,"message":"success","data":{"status_transaksi":"SUCCESS", ...}}
        let paymentStatus = 'PENDING'; // Default
        if (statusResponse.data && (statusResponse.data.status === 200 || statusResponse.data.success === true || typeof statusResponse.data.status === 'boolean' && statusResponse.data.status) && statusResponse.data.data && statusResponse.data.data.status_transaksi) {
            paymentStatus = statusResponse.data.data.status_transaksi.toUpperCase();
        } else if (statusResponse.data && statusResponse.data.message) {
            console.warn("Pesan/error dari Decode Rerezz saat cek status:", statusResponse.data.message);
        } else {
            console.warn("Format respons tidak dikenal dari Decode Rerezz Cek Status.");
        }

        await pool.query(
            'UPDATE qris_payment_attempts SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
            [paymentStatus, attempt.id]
        );

        if (paymentStatus === 'SUCCESS') {
            const depositDescription = `QRIS Deposit (Ref: ${attempt.our_transaction_ref})`;
            await confirmTargetDeposit(attempt.user_id, attempt.target_id, attempt.amount, depositDescription, attempt.our_transaction_ref);
            return res.json({ message: 'Pembayaran QRIS berhasil dan deposit telah dicatat!', status: paymentStatus, ourTransactionRef: attempt.our_transaction_ref, amount: attempt.amount });
        } else {
            return res.json({ message: `Status pembayaran saat ini: ${paymentStatus}.`, status: paymentStatus, ourTransactionRef: attempt.our_transaction_ref });
        }

    } catch (error) {
        const errorDetails = error.response ? JSON.stringify(error.response.data) : error.message;
        console.error('Error saat cek status pembayaran QRIS:', errorDetails);
        const errorMessage = (error.response && error.response.data && error.response.data.message)
                           ? error.response.data.message
                           : error.message || 'Gagal memeriksa status pembayaran QRIS.';
        res.status(500).json({ message: errorMessage });
    }
};

module.exports = {
    makeManualDeposit,
    getUserTransactions,
    initiateQrisPayment,
    checkQrisPaymentStatus,
};
