// celengan-api/controllers/transactionController.js

const pool = require('../config/db');
const axios = require('axios'); // Untuk memanggil API eksternal (QRIS)
const crypto = require('crypto'); // Untuk generate ID unik internal jika diperlukan (QRIS)
const { confirmTargetDeposit } = require('../services/paymentService'); // Pastikan path ini benar

// @desc    Get all transactions for the logged-in user with filtering and pagination
// @route   GET /api/transactions
// @access  Private (requires JWT)
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

// @desc    Make a manual deposit
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
        console.error("KRITIKAL: Konfigurasi PanzNGen API (URL, API Key, atau QR Payload) tidak lengkap di .env");
        return res.status(500).json({ message: "Layanan pembayaran QRIS tidak terkonfigurasi dengan benar (PanzNgen)." });
    }

    try {
        const params = {
            apikey: panzngenApiKey,
            amount: parseFloat(amount),
            codeqr: panzngenMerchantQrPayload,
        };

        console.log(`[QRIS INITIATE] Memanggil PanzNGen Create Payment: URL=${panzngenCreateUrl}, Params=`, JSON.stringify(params));
        const panzngenResponse = await axios.get(panzngenCreateUrl, { params });
        console.log("[QRIS INITIATE] Respons MENTAH dari PanzNGen /createpayment:", JSON.stringify(panzngenResponse.data, null, 2));

        const pData = panzngenResponse.data;

        if (pData && pData.status === true && pData.result && pData.result.transactionId) {
            const panzngenTransactionId = pData.result.transactionId;
            const qrDataForDisplay = pData.result.qrImageUrl;

            console.log(`[QRIS INITIATE] PanzNgen Transaction ID (disimpan sbg panzngen_keyorkut): ${panzngenTransactionId}`);
            console.log(`[QRIS INITIATE] PanzNgen QR Image URL: ${qrDataForDisplay}`);
            
            Object.keys(pData.result).forEach(key => {
                console.log(`[QRIS INITIATE] PanzNgen pData.result.${key} = ${pData.result[key]}`);
            });

            await pool.query(
                'INSERT INTO qris_payment_attempts (user_id, target_id, amount, panzngen_keyorkut, panzngen_payment_data, status, our_transaction_ref) VALUES (?, ?, ?, ?, ?, ?, ?)',
                [user_id, parseInt(target_id), parseFloat(amount), panzngenTransactionId, qrDataForDisplay, 'PENDING', ourTransactionRef]
            );

            res.status(201).json({
                message: 'Permintaan pembayaran QRIS berhasil dibuat. Silakan selesaikan pembayaran.',
                ourTransactionRef: ourTransactionRef,
                panzngenTransactionId: panzngenTransactionId,
                qrData: qrDataForDisplay,
                paymentDetails: pData.result
            });
        } else {
            const panzngenErrorMessage = pData ? (pData.message || JSON.stringify(pData)) : 'Respons tidak dikenal dari PanzNGen.';
            console.error("[QRIS INITIATE] PanzNGen mengembalikan error atau format tidak dikenal:", panzngenErrorMessage);
            throw new Error(`Gagal membuat pembayaran QRIS di PanzNGen: ${panzngenErrorMessage}`);
        }

    } catch (error) {
        const errorDetails = error.response ? JSON.stringify(error.response.data) : error.message;
        console.error('[QRIS INITIATE] Error saat proses inisiasi pembayaran QRIS:', errorDetails);
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
    const okeconnectKeyForRerezz = process.env.OKECONNECT_KEY_FOR_REREZZ; // "apikey dari okeconnect"

    if (!decodeStatusUrl || !decodeApiKey || !decodeMemid || !okeconnectKeyForRerezz) {
        console.error("KRITIKAL: Konfigurasi API Decode Rerezz (URL, API Key, MEMID, atau Okeconnect Key) tidak lengkap di .env");
        return res.status(500).json({ message: "Layanan pengecekan status pembayaran tidak terkonfigurasi dengan benar (Decode Rerezz)." });
    }

    try {
        const [attempts] = await pool.query(
            'SELECT * FROM qris_payment_attempts WHERE our_transaction_ref = ? AND user_id = ?',
            [ourTransactionRef, user_id]
        );

        if (attempts.length === 0) {
            return res.status(404).json({ message: 'Referensi transaksi tidak ditemukan atau bukan milik Anda.' });
        }
        const attempt = attempts[0]; // Ini berisi `panzngen_keyorkut` (yang adalah transactionId dari PanzNGen)

        if (['SUCCESS', 'FAILED', 'EXPIRED'].includes(attempt.status)) {
            return res.json({ message: `Status pembayaran adalah ${attempt.status}.`, status: attempt.status, ourTransactionRef: attempt.our_transaction_ref, amount: attempt.amount });
        }

        if (!attempt.panzngen_keyorkut) {
             return res.status(400).json({ message: 'Data pembayaran tidak lengkap (ID Transaksi PanzNGen hilang untuk referensi ini).' });
        }

        // --- MEMBANGUN PARAMETER UNTUK DECODE REREZZ ---
        const paramsToDecodeRerezz = {
            memid: decodeMemid,
            keyorkut: okeconnectKeyForRerezz, // Menggunakan "apikey dari okeconnect" dari .env
            apikey: decodeApiKey,             // API Key untuk layanan Decode Rerezz
            
            // !! ================================================================================= !!
            // !! PENTING: ANDA PERLU TAHU NAMA PARAMETER YANG BENAR UNTUK MENGIRIM ID TRANSAKSI    !!
            // !!          PANZNGEN (`attempt.panzngen_keyorkut`) KE API DECODE REREZZ.             !!
            // !!          GANTI 'NAMA_PARAMETER_TRANSAKSI_ID_PANZNGEN' DI BAWAH INI.               !!
            // !! CONTOH: jika parameternya 'order_id' atau 'ref_id' atau 'transaction_id'         !!
            // !! ================================================================================= !!
            NAMA_PARAMETER_TRANSAKSI_ID_PANZNGEN: attempt.panzngen_keyorkut
        };
        
        console.log(`[QRIS STATUS] Memanggil Decode Rerezz Cek Status: URL=${decodeStatusUrl}, Params=`, JSON.stringify(paramsToDecodeRerezz));
        const statusResponse = await axios.get(decodeStatusUrl, { params: paramsToDecodeRerezz });
        console.log("[QRIS STATUS] Respons MENTAH dari Decode Rerezz /cekstatus:", JSON.stringify(statusResponse.data, null, 2));

        let paymentStatus = 'PENDING';
        const rData = statusResponse.data;
        // Sesuaikan parsing status berdasarkan respons aktual Decode Rerezz
        if (rData && (rData.status === 200 || rData.success === true || (typeof rData.status === 'boolean' && rData.status)) && rData.data && rData.data.status_transaksi) {
            paymentStatus = rData.data.status_transaksi.toUpperCase();
        } else if (rData && rData.message) {
            console.warn("[QRIS STATUS] Pesan/error dari Decode Rerezz saat cek status:", rData.message);
            if (rData.message.toLowerCase().includes("gagal mengambil data transaksi") || rData.message.toLowerCase().includes("tidak ditemukan")) {
                paymentStatus = 'FAILED';
            }
        } else {
            console.warn("[QRIS STATUS] Format respons tidak dikenal dari Decode Rerezz Cek Status.");
        }

        await pool.query(
            'UPDATE qris_payment_attempts SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
            [paymentStatus, attempt.id]
        );

        if (paymentStatus === 'SUCCESS') {
            const depositDescription = `QRIS Deposit (Ref: ${attempt.our_transaction_ref}, PanzNgenTrxID: ${attempt.panzngen_keyorkut})`;
            await confirmTargetDeposit(attempt.user_id, attempt.target_id, attempt.amount, depositDescription, attempt.our_transaction_ref);
            return res.json({ message: 'Pembayaran QRIS berhasil dan deposit telah dicatat!', status: paymentStatus, ourTransactionRef: attempt.our_transaction_ref, amount: attempt.amount });
        } else {
            return res.json({ message: `Status pembayaran saat ini: ${paymentStatus}.`, status: paymentStatus, ourTransactionRef: attempt.our_transaction_ref });
        }

    } catch (error) {
        const errorDetails = error.response ? JSON.stringify(error.response.data) : error.message;
        console.error('[QRIS STATUS] Error saat cek status pembayaran QRIS:', errorDetails);
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
