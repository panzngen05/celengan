// celengan-api/controllers/transactionController.js
const pool = require('../config/db');
const axios = require('axios');
const crypto = require('crypto');
const { confirmTargetDeposit } = require('../services/paymentService'); // Pastikan path ini benar

// ... (fungsi makeManualDeposit dan getUserTransactions tetap sama seperti sebelumnya) ...
const makeManualDeposit = async (req, res) => { /* ... implementasi sebelumnya ... */
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

const getUserTransactions = async (req, res) => { /* ... implementasi sebelumnya ... */
    const user_id = req.user.id;
    const { target_id, jenis_transaksi, start_date, end_date } = req.query;
    const page = parseInt(req.query.page, 10) || 1;
    const limit = parseInt(req.query.limit, 10) || 10;
    const offset = (page - 1) * limit;

    let query = `
        SELECT t.id, t.target_id, tg.nama_target, t.jenis_transaksi, t.jumlah, 
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


// --- Fungsi Baru/Modifikasi untuk QRIS ---

// @desc    Initiate QRIS payment using PanzNgen API
// @route   POST /api/transactions/qris/initiate
// @access  Private
const initiateQrisPayment = async (req, res) => {
    const { target_id, amount } = req.body; // Ambil amount dari request body
    const user_id = req.user.id;

    if (!target_id || !amount || parseFloat(amount) <= 0) {
        return res.status(400).json({ message: 'Target ID dan jumlah pembayaran (positif) diperlukan.' });
    }

    const ourTransactionRef = `QRIS-${user_id}-${target_id}-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
    
    // Ambil konfigurasi dari .env
    const panzngenCreateUrl = process.env.PANZNGEN_CREATE_PAYMENT_URL;
    const panzngenApiKey = process.env.PANZNGEN_API_KEY;
    const panzngenMerchantQrPayload = process.env.PANZNGEN_MERCHANT_QR_PAYLOAD; // Ini adalah string QRIS panjang dari .env

    if (!panzngenCreateUrl || !panzngenApiKey || !panzngenMerchantQrPayload) {
        console.error("Konfigurasi PanzNGen API (URL, API Key, atau QR Payload) tidak lengkap di .env");
        return res.status(500).json({ message: "Layanan pembayaran QRIS tidak terkonfigurasi dengan benar." });
    }

    try {
        const params = {
            apikey: panzngenApiKey,
            amount: parseFloat(amount),
            codeqr: panzngenMerchantQrPayload, // Menggunakan QR payload dari .env
        };

        console.log(`Memanggil PanzNGen Create Payment: URL=${panzngenCreateUrl}, Params=`, params);
        const panzngenResponse = await axios.get(panzngenCreateUrl, { params });
        console.log("Respons dari PanzNGen Create Payment:", panzngenResponse.data);

        // Asumsi respons PanzNGen:
        // Jika sukses: { "status": 200, "message": "success", "data": { "keyorkut": "...", "qr_string": "...", ...lainnya } }
        // Jika gagal: { "status": 400/dll, "message": "error message" }
        // Sesuaikan kondisi di bawah ini dengan struktur respons aktual PanzNGen Anda
        if (panzngenResponse.data && (panzngenResponse.data.status === 200 || panzngenResponse.data.success === true) && panzngenResponse.data.data && panzngenResponse.data.data.keyorkut) {
            const { keyorkut } = panzngenResponse.data.data;
            // qr_string bisa jadi adalah panzngenMerchantQrPayload itu sendiri jika PanzNGen tidak mengembalikannya,
            // atau PanzNGen mengembalikan qr_string yang sudah dimodifikasi/dinamis.
            // Untuk amannya, kita simpan apa yang kita punya atau apa yang dikembalikan PanzNGen.
            const qrDataForDisplay = panzngenResponse.data.data.qr_string || panzngenResponse.data.data.qrcode || panzngenMerchantQrPayload;

            await pool.query(
                'INSERT INTO qris_payment_attempts (user_id, target_id, amount, panzngen_keyorkut, panzngen_payment_data, status, our_transaction_ref) VALUES (?, ?, ?, ?, ?, ?, ?)',
                [user_id, target_id, parseFloat(amount), keyorkut, qrDataForDisplay, 'PENDING', ourTransactionRef]
            );

            res.status(201).json({
                message: 'Permintaan pembayaran QRIS berhasil dibuat. Silakan selesaikan pembayaran.',
                ourTransactionRef: ourTransactionRef, // ID internal kita
                keyorkut: keyorkut, // ID dari PanzNGen, untuk cek status
                qrData: qrDataForDisplay, // Data QR untuk ditampilkan di frontend
                // paymentDetails: panzngenResponse.data.data // Opsional: kirim semua detail jika perlu
            });
        } else {
            // Jika PanzNGen mengembalikan status gagal atau format tidak sesuai
            const panzngenErrorMessage = panzngenResponse.data ? (panzngenResponse.data.message || JSON.stringify(panzngenResponse.data)) : 'Respons tidak diketahui dari PanzNGen.';
            console.error("PanzNGen mengembalikan error atau format tidak dikenal:", panzngenErrorMessage);
            throw new Error(`Gagal membuat pembayaran QRIS di PanzNGen: ${panzngenErrorMessage}`);
        }

    } catch (error) {
        console.error('Error saat inisiasi pembayaran QRIS:', error.response ? JSON.stringify(error.response.data) : error.message);
        const errorMessage = (error.response && error.response.data && error.response.data.message)
                           ? error.response.data.message
                           : error.message || 'Gagal memproses permintaan pembayaran QRIS.';
        res.status(500).json({ message: errorMessage });
    }
};

// @desc    Check QRIS payment status using Decode Rerezz API
// @route   GET /api/transactions/qris/status/:ourTransactionRef
// @access  Private
const checkQrisPaymentStatus = async (req, res) => {
    const { ourTransactionRef } = req.params;
    const user_id = req.user.id;

    // Ambil konfigurasi dari .env
    const decodeStatusUrl = process.env.DECODE_REREZZ_STATUS_URL;
    const decodeApiKey = process.env.DECODE_REREZZ_API_KEY;
    const decodeMemid = process.env.DECODE_REREZZ_MEMID;

    if (!decodeStatusUrl || !decodeApiKey || !decodeMemid) {
        console.error("Konfigurasi API Decode Rerezz (URL, API Key, atau MEMID) tidak lengkap di .env");
        return res.status(500).json({ message: "Layanan pengecekan status pembayaran tidak terkonfigurasi dengan benar." });
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
            keyorkut: attempt.panzngen_keyorkut, // Ini adalah ID transaksi dari PanzNGen
            apikey: decodeApiKey,
        };
        
        console.log(`Memanggil Decode Rerezz Cek Status: URL=${decodeStatusUrl}, Params=`, params);
        const statusResponse = await axios.get(decodeStatusUrl, { params });
        console.log("Respons dari Decode Rerezz Cek Status:", statusResponse.data);

        // Asumsi respons Decode Rerezz:
        // Jika sukses: { "status": 200, "message": "success", "data": { "status_transaksi": "SUCCESS" / "PENDING" / "FAILED", ... } }
        // Sesuaikan kondisi di bawah ini dengan struktur respons aktual Decode Rerezz Anda
        let paymentStatus = 'PENDING'; // Default
        if (statusResponse.data && (statusResponse.data.status === 200 || statusResponse.data.success === true) && statusResponse.data.data && statusResponse.data.data.status_transaksi) {
            paymentStatus = statusResponse.data.data.status_transaksi.toUpperCase();
        } else if (statusResponse.data && statusResponse.data.message) {
            // Jika ada pesan error dari Decode Rerezz, mungkin status tetap PENDING atau FAILED
            console.warn("Pesan dari Decode Rerezz saat cek status:", statusResponse.data.message);
            // Anda mungkin ingin memetakan pesan error ini ke status yang lebih spesifik jika perlu
        } else {
            console.warn("Format respons tidak dikenal dari Decode Rerezz Cek Status.");
            // Pertahankan status PENDING atau FAILED jika respons tidak jelas
        }

        await pool.query(
            'UPDATE qris_payment_attempts SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
            [paymentStatus, attempt.id]
        );

        if (paymentStatus === 'SUCCESS') {
            const depositDescription = `QRIS Deposit via PanzNGen, Ref: ${attempt.our_transaction_ref}, KeyOrkut: ${attempt.panzngen_keyorkut}`;
            await confirmTargetDeposit(attempt.user_id, attempt.target_id, attempt.amount, depositDescription, attempt.our_transaction_ref);
            return res.json({ message: 'Pembayaran QRIS berhasil dan deposit telah dicatat!', status: paymentStatus, ourTransactionRef: attempt.our_transaction_ref, amount: attempt.amount });
        } else {
            return res.json({ message: `Status pembayaran saat ini: ${paymentStatus}.`, status: paymentStatus, ourTransactionRef: attempt.our_transaction_ref });
        }

    } catch (error) {
        console.error('Error saat cek status pembayaran QRIS:', error.response ? JSON.stringify(error.response.data) : error.message);
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
