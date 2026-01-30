import express from 'express';
import { auth } from '../middleware/auth.js';
import { LicenseService } from '../services/licenseService.js';

const router = express.Router();

// Create license codes (admin only)
router.post('/create-license', auth, express.json(), async (req, res) => {
  try {
    // Check if user is admin (docent id 1)
    if (req.user.id !== 1) {
      return res.status(403).json({ error: 'Alleen admin mag licenties aanmaken' });
    }

    const { max_leerlingen = 30, vervalt_op, aantal = 1 } = req.body;
    const licenses = await LicenseService.createLicense(req.user.id, { max_leerlingen, vervalt_op, aantal });
    
    res.json({ ok: true, licenses });
  } catch (err) {
    console.error('/admin/create-license error:', err);
    res.status(500).json({ error: 'server error' });
  }
});

// Get all licenses (admin only)
router.get('/licenses', auth, async (req, res) => {
  try {
    if (req.user.id !== 1) {
      return res.status(403).json({ error: 'Alleen admin toegang' });
    }

    const licenses = await LicenseService.getAllLicenses();
    res.json(licenses);
  } catch (err) {
    console.error('/admin/licenses error:', err);
    res.status(500).json({ error: 'server error' });
  }
});

export default router;
