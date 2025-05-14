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
            console.log(`[QRIS INITIATE] PanzNgen QR Image URL (disimpan sbg panzngen_payment_data): ${qrDataForDisplay}`);
            
            // Log semua field di dalam pData.result untuk membantu identifikasi
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
                panzngenTransactionId: panzngenTransactionId, // Kirim ID ini ke frontend
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

// @desc    Check QRIS payment status using Okeconnect Mutasi API
// @route   GET /api/transactions/qris/status/:ourTransactionRef
// @access  Private
const checkQrisPaymentStatus = async (req, res) => {
    const { ourTransactionRef } = req.params;
    const user_id = req.user.id;

    const okeconnectBaseUrl = process.env.OKECONNECT_MUTASI_BASE_URL;
    const okeconnectMemberId = process.env.OKECONNECT_MEMBER_ID;
    const okeconnectSignatureKey = process.env.OKECONNECT_SIGNATURE_KEY; // Ini "keyorkut dari Okeconnect" yang statis

    if (!okeconnectBaseUrl || !okeconnectMemberId || !okeconnectSignatureKey) {
        console.error("KRITIKAL: Konfigurasi API Okeconnect (URL, MemberID, atau Signature Key) tidak lengkap di .env");
        return res.status(500).json({ message: "Layanan pengecekan status pembayaran tidak terkonfigurasi (Okeconnect)." });
    }

    try {
        const [attempts] = await pool.query(
            'SELECT * FROM qris_payment_attempts WHERE our_transaction_ref = ? AND user_id = ?',
            [ourTransactionRef, user_id]
        );

        if (attempts.length === 0) {
            return res.status(404).json({ message: 'Referensi transaksi internal tidak ditemukan atau bukan milik Anda.' });
        }
        const attempt = attempts[0]; // attempt.panzngen_keyorkut berisi ID transaksi dari PanzNGen

        if (attempt.status === 'SUCCESS') {
            return res.json({ message: `Pembayaran sudah BERHASIL.`, status: 'SUCCESS', ourTransactionRef: attempt.our_transaction_ref, amount: attempt.amount });
        }
        if (attempt.status === 'FAILED' || attempt.status === 'EXPIRED') {
             return res.json({ message: `Status pembayaran adalah ${attempt.status}.`, status: attempt.status, ourTransactionRef: attempt.our_transaction_ref, amount: attempt.amount });
        }

        if (!attempt.panzngen_keyorkut) { // Ini adalah PanzNgen Transaction ID
             return res.status(400).json({ message: 'Data pembayaran tidak lengkap (ID Transaksi PanzNGen hilang untuk referensi internal ini).' });
        }

        // URL untuk Okeconnect: https://gateway.okeconnect.com/api/mutasi/qris/{memberID}/{signature}
        const okeconnectStatusUrl = `${okeconnectBaseUrl}/${okeconnectMemberId}/${okeconnectSignatureKey}`;
        
        console.log(`[QRIS STATUS] Memanggil Okeconnect Mutasi API: URL=${okeconnectStatusUrl}`);
        // Berdasarkan contoh URL Anda, API Okeconnect ini tidak memerlukan parameter query tambahan untuk memanggil daftar mutasi.
        // Autentikasi sepertinya dari kombinasi memberID dan signature di path.
        const okeconnectResponse = await axios.get(okeconnectStatusUrl);
        console.log("[QRIS STATUS] Respons MENTAH dari Okeconnect Mutasi API:", JSON.stringify(okeconnectResponse.data, null, 2));

        let paymentStatus = 'PENDING'; // Default jika tidak ditemukan atau belum selesai
        const okeData = okeconnectResponse.data;

        if (okeData && okeData.status && okeData.status.toLowerCase() === 'success' && Array.isArray(okeData.data)) {
            const matchedTransaction = okeData.data.find(trx => {
                // --- KRITERIA PENCOCOKAN (PERLU ANDA VERIFIKASI DAN SESUAIKAN!) ---
                const isAmountMatch = parseFloat(trx.amount) === parseFloat(attempt.amount);
                const isTypeMatch = trx.type && trx.type.toUpperCase() === 'CR'; // CR untuk Credit (dana masuk)

                // PENTING: Field mana di `trx` (data dari Okeconnect) yang berisi ID Transaksi PanzNgen?
                // Ganti `trx.issuer_reff` dengan field yang benar jika berbeda.
                // Mungkin 'trx.reference_no', 'trx.notes', 'trx.description', atau field lain yang unik.
                const isPanzngenIdMatch = trx.issuer_reff === attempt.panzngen_keyorkut; 
                
                // Pertimbangkan juga mencocokkan berdasarkan rentang waktu yang sangat dekat jika perlu,
                // tapi pencocokan ID Transaksi PanzNgen adalah yang paling akurat.
                // const transactionDate = new Date(trx.date);
                // const attemptDate = new Date(attempt.created_at);
                // const isRecent = Math.abs(transactionDate.getTime() - attemptDate.getTime()) < (10 * 60 * 1000); // misal dalam 10 menit

                if (isAmountMatch && isTypeMatch && isPanzngenIdMatch) {
                    console.log(`[QRIS STATUS] Transaksi COCOK ditemukan di mutasi Okeconnect:`, trx);
                    return true;
                }
                return false;
            });

            if (matchedTransaction) {
                paymentStatus = 'SUCCESS';
            } else {
                console.log(`[QRIS STATUS] Transaksi untuk ref ${ourTransactionRef} (PanzNgen ID: ${attempt.panzngen_keyorkut}, Amount: ${attempt.amount}) belum ditemukan/cocok di mutasi Okeconnect.`);
                paymentStatus = 'PENDING';
            }
        } else if (okeData && okeData.message) {
            console.warn("[QRIS STATUS] Pesan/error dari Okeconnect saat mengambil mutasi:", okeData.message);
            if (okeData.message.toLowerCase().includes("gagal mengambil data transaksi") || okeData.message.toLowerCase().includes("tidak ditemukan")) {
                paymentStatus = 'FAILED'; // Jika Okeconnect secara eksplisit bilang gagal atau tidak ditemukan
            } else {
                paymentStatus = 'PENDING'; // Jika pesan error lain, anggap pending untuk dicek lagi
            }
        } else {
            console.warn("[QRIS STATUS] Format respons tidak dikenal dari Okeconnect Mutasi API.");
            paymentStatus = 'PENDING'; // Jika format tidak jelas, anggap PENDING
        }

        // Update status di database kita hanya jika ada perubahan atau belum final dan bukan success dari DB
        if (paymentStatus !== attempt.status || paymentStatus === 'PENDING') {
             if (attempt.status !== 'SUCCESS') { // Jangan update jika di DB sudah SUCCESS
                await pool.query(
                    'UPDATE qris_payment_attempts SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
                    [paymentStatus, attempt.id]
                );
            } else if (attempt.status === 'SUCCESS' && paymentStatus !== 'SUCCESS') {
                // Ini kondisi aneh, di DB sudah SUCCESS tapi API bilang lain. Log dan jangan ubah.
                console.warn(`[QRIS STATUS] Aneh: Status di DB sudah SUCCESS untuk ${ourTransactionRef}, tapi API Okeconnect mengembalikan ${paymentStatus}. Tidak mengubah status.`);
                paymentStatus = 'SUCCESS'; // Pertahankan status SUCCESS dari DB
            }
        }


        if (paymentStatus === 'SUCCESS') {
            // Hanya panggil confirmTargetDeposit jika status sebelumnya BUKAN SUCCESS, untuk menghindari duplikasi.
            if (attempt.status !== 'SUCCESS') {
                const depositDescription = `QRIS Deposit via Okeconnect (Ref: ${attempt.our_transaction_ref}, PanzNgenTrxID: ${attempt.panzngen_keyorkut})`;
                await confirmTargetDeposit(attempt.user_id, attempt.target_id, attempt.amount, depositDescription, attempt.our_transaction_ref);
            }
            return res.json({ message: 'Pembayaran QRIS berhasil dan deposit telah dicatat!', status: paymentStatus, ourTransactionRef: attempt.our_transaction_ref, amount: attempt.amount });
        } else {
            return res.json({ message: `Status pembayaran saat ini: ${paymentStatus}.`, status: paymentStatus, ourTransactionRef: attempt.our_transaction_ref });
        }

    } catch (error) {
        const errorDetails = error.response ? JSON.stringify(error.response.data) : error.message;
        console.error('[QRIS STATUS] Error saat cek status pembayaran QRIS via Okeconnect:', errorDetails);
        const errorMessage = (error.response && error.response.data && error.response.data.message)
                           ? error.response.data.message
                           : error.message || 'Gagal memeriksa status pembayaran QRIS via Okeconnect.';
        res.status(500).json({ message: errorMessage });
    }
};

module.exports = {
    makeManualDeposit,
    getUserTransactions,
    initiateQrisPayment,
    checkQrisPaymentStatus,
};
