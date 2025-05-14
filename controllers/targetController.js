const pool = require('../config/db');

// @desc    Create new target
// @route   POST /api/targets
// @access  Private
const createTarget = async (req, res) => {
    const { nama_target, jumlah_target, tanggal_target } = req.body;
    const user_id = req.user.id; // dari middleware protect

    if (!nama_target || !jumlah_target) {
        return res.status(400).json({ message: 'Nama target dan jumlah target diperlukan' });
    }

    // Validasi tanggal_target jika ada (opsional, bisa juga di frontend)
    // const parsedTanggalTarget = tanggal_target ? new Date(tanggal_target) : null;

    try {
        const [result] = await pool.query(
            'INSERT INTO targets (user_id, nama_target, jumlah_target, tanggal_target) VALUES (?, ?, ?, ?)',
            [user_id, nama_target, parseFloat(jumlah_target), tanggal_target || null]
        );
        res.status(201).json({
            id: result.insertId,
            user_id,
            nama_target,
            jumlah_target: parseFloat(jumlah_target),
            tanggal_target: tanggal_target || null,
            jumlah_terkumpul: 0.00,
            status: 'aktif'
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Server error creating target' });
    }
};

// @desc    Get all targets for a user
// @route   GET /api/targets
// @access  Private
const getUserTargets = async (req, res) => {
    const user_id = req.user.id;
    try {
        const [targets] = await pool.query(
            'SELECT id, nama_target, jumlah_target, jumlah_terkumpul, tanggal_target, status, created_at, (jumlah_terkumpul / jumlah_target * 100) AS progress_percentage FROM targets WHERE user_id = ? ORDER BY created_at DESC',
            [user_id]
        );
        res.json(targets);
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Server error fetching targets' });
    }
};

// @desc    Get single target by ID
// @route   GET /api/targets/:id
// @access  Private
const getTargetById = async (req, res) => {
    const target_id = req.params.id;
    const user_id = req.user.id;
    try {
        const [targets] = await pool.query(
            'SELECT id, nama_target, jumlah_target, jumlah_terkumpul, tanggal_target, status, created_at, (jumlah_terkumpul / jumlah_target * 100) AS progress_percentage FROM targets WHERE id = ? AND user_id = ?',
            [target_id, user_id]
        );
        if (targets.length > 0) {
            res.json(targets[0]);
        } else {
            res.status(404).json({ message: 'Target not found or not authorized' });
        }
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Server error fetching target' });
    }
};

// @desc    Update target
// @route   PUT /api/targets/:id
// @access  Private
const updateTarget = async (req, res) => {
    const target_id = req.params.id;
    const user_id = req.user.id;
    const { nama_target, jumlah_target, tanggal_target, status } = req.body;

    // Cek apakah target ada dan milik user
    try {
        const [currentTargets] = await pool.query(
            'SELECT * FROM targets WHERE id = ? AND user_id = ?',
            [target_id, user_id]
        );

        if (currentTargets.length === 0) {
            return res.status(404).json({ message: 'Target not found or not authorized' });
        }
        const currentTarget = currentTargets[0];

        const updatedData = {
            nama_target: nama_target || currentTarget.nama_target,
            jumlah_target: jumlah_target ? parseFloat(jumlah_target) : currentTarget.jumlah_target,
            tanggal_target: tanggal_target !== undefined ? (tanggal_target || null) : currentTarget.tanggal_target,
            status: status || currentTarget.status,
        };

        // Jika jumlah target diubah, cek apakah jumlah terkumpul melebihi target baru
        if (updatedData.jumlah_target < currentTarget.jumlah_terkumpul) {
            // Logika ini bisa disesuaikan, misalnya tidak boleh mengurangi target di bawah yang sudah terkumpul
            // atau status otomatis jadi 'tercapai' jika jumlah_terkumpul >= jumlah_target baru.
            // Untuk saat ini, kita biarkan saja.
        }
         // Jika status diubah menjadi 'tercapai' dan jumlah terkumpul belum sama dengan target,
        // atau sebaliknya, mungkin perlu validasi tambahan.

        await pool.query(
            'UPDATE targets SET nama_target = ?, jumlah_target = ?, tanggal_target = ?, status = ? WHERE id = ?',
            [updatedData.nama_target, updatedData.jumlah_target, updatedData.tanggal_target, updatedData.status, target_id]
        );
        res.json({ id: target_id, ...updatedData });

    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Server error updating target' });
    }
};

// @desc    Delete target
// @route   DELETE /api/targets/:id
// @access  Private
const deleteTarget = async (req, res) => {
    const target_id = req.params.id;
    const user_id = req.user.id;

    try {
        // Optional: Hapus juga transaksi terkait target ini jika diinginkan, atau biarkan (tergantung aturan bisnis)
        // await pool.query('DELETE FROM transactions WHERE target_id = ? AND user_id = ?', [target_id, user_id]);

        const [result] = await pool.query(
            'DELETE FROM targets WHERE id = ? AND user_id = ?',
            [target_id, user_id]
        );

        if (result.affectedRows > 0) {
            res.json({ message: 'Target removed' });
        } else {
            res.status(404).json({ message: 'Target not found or not authorized' });
        }
    } catch (error) {
        console.error(error);
        // Jika ada foreign key constraint ke tabel transactions,
        // dan transaksi tidak dihapus dulu, ini bisa error.
        res.status(500).json({ message: 'Server error deleting target' });
    }
};


module.exports = {
    createTarget,
    getUserTargets,
    getTargetById,
    updateTarget,
    deleteTarget,
};
