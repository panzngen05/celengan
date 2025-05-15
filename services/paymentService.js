// celengan-api/services/paymentService.js

const pool = require('../config/db'); // Pastikan path ini benar

/**
 * Mengkonfirmasi deposit ke target.
 * @param {number} userId ID pengguna
 * @param {number} targetId ID target
 * @param {number} amount Jumlah yang dideposit
 * @param {string} description Deskripsi transaksi
 * @param {string} paymentRef Referensi pembayaran
 * @returns {Promise<object>} Hasil operasi
 */
async function confirmTargetDeposit(userId, targetId, amount, description, paymentRef) {
    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();
        const [targets] = await connection.query('SELECT * FROM targets WHERE id = ? AND user_id = ? FOR UPDATE', [targetId, userId]);
        if (targets.length === 0) throw new Error('Target tidak ditemukan atau bukan milik pengguna yang sah.');
        
        const target = targets[0];
        const newJumlahTerkumpul = parseFloat(target.jumlah_terkumpul) + parseFloat(amount);
        let newStatus = target.status;

        if (newJumlahTerkumpul >= parseFloat(target.jumlah_target) && target.status !== 'tercapai') {
            newStatus = 'tercapai';
        } else if (target.status === 'tercapai' && newJumlahTerkumpul < parseFloat(target.jumlah_target)){
             newStatus = 'aktif'; 
        } else if (target.status !== 'tercapai' && newJumlahTerkumpul < parseFloat(target.jumlah_target)) {
            newStatus = 'aktif'; 
        }

        await connection.query('UPDATE targets SET jumlah_terkumpul = ?, status = ? WHERE id = ?', [newJumlahTerkumpul, newStatus, targetId]);
        
        const [result] = await connection.query(
            'INSERT INTO transactions (target_id, user_id, jenis_transaksi, jumlah, deskripsi, payment_gateway_ref) VALUES (?, ?, ?, ?, ?, ?)',
            [targetId, userId, 'DEPOSIT', parseFloat(amount), description, paymentRef] // Nilai ENUM: 'DEPOSIT'
        );
        await connection.commit();
        return { message: 'Deposit berhasil dikonfirmasi dan dicatat.', transaction_id: result.insertId, target_id: targetId, new_jumlah_terkumpul: newJumlahTerkumpul, target_status: newStatus };
    } catch (error) {
        await connection.rollback();
        console.error("Error dalam proses konfirmasi deposit (paymentService):", error.message);
        // Sertakan error asli untuk debugging lebih lanjut jika perlu
        const detailError = new Error(error.message || 'Gagal mengkonfirmasi deposit ke target.');
        detailError.originalError = error; // Menyimpan error asli
        throw detailError;
    } finally {
        if (connection) connection.release();
    }
}

/**
 * Memproses penarikan dana dari target tabungan.
 * @param {number} userId ID pengguna
 * @param {number} targetId ID target
 * @param {number} amount Jumlah yang ditarik
 * @param {string} reason Alasan penarikan (wajib)
 * @returns {Promise<object>} Hasil operasi
 */
async function processWithdrawal(userId, targetId, amount, reason) {
    if (!reason || reason.trim() === "") {
        throw new Error('Alasan penarikan wajib diisi.');
    }
    if (parseFloat(amount) <= 0) {
        throw new Error('Jumlah penarikan harus positif.');
    }

    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();
        const [targets] = await connection.query('SELECT * FROM targets WHERE id = ? AND user_id = ? FOR UPDATE', [targetId, userId]);

        if (targets.length === 0) {
            throw new Error('Target tidak ditemukan atau bukan milik pengguna yang sah.');
        }
        const target = targets[0];

        if (parseFloat(target.jumlah_terkumpul) < parseFloat(amount)) {
            throw new Error('Saldo tidak mencukupi untuk melakukan penarikan sejumlah ini.');
        }

        const newJumlahTerkumpul = parseFloat(target.jumlah_terkumpul) - parseFloat(amount);
        let newStatus = target.status;

        if (newJumlahTerkumpul < parseFloat(target.jumlah_target) && target.status === 'tercapai') {
            newStatus = 'aktif';
        }

        await connection.query(
            'UPDATE targets SET jumlah_terkumpul = ?, status = ? WHERE id = ?',
            [newJumlahTerkumpul, newStatus, targetId]
        );

        const withdrawalRef = `WITHDRAW-${userId}-${targetId}-${Date.now()}`;
        const [result] = await connection.query(
            'INSERT INTO transactions (target_id, user_id, jenis_transaksi, jumlah, deskripsi, payment_gateway_ref) VALUES (?, ?, ?, ?, ?, ?)',
            [targetId, userId, 'WITHDRAWAL', parseFloat(amount), reason, withdrawalRef] // Nilai ENUM: 'WITHDRAWAL'
        );
        await connection.commit();
        return { message: 'Penarikan berhasil dicatat.', transaction_id: result.insertId, target_id: targetId, new_jumlah_terkumpul: newJumlahTerkumpul, target_status: newStatus };
    } catch (error) {
        await connection.rollback();
        console.error("Error dalam proses penarikan (paymentService):", error.message);
        const detailError = new Error(error.message || 'Gagal memproses penarikan dana.');
        detailError.originalError = error; // Menyimpan error asli
        throw detailError;
    } finally {
        if (connection) connection.release();
    }
}

module.exports = {
    confirmTargetDeposit,
    processWithdrawal
};
