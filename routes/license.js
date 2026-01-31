import express from 'express';
import { auth } from '../middleware/auth.js';
import { LicenseService } from '../services/licenseService.js';

const router = express.Router();

// Redeem license code
router.post('/redeem-license', auth, express.json(), async (req, res) => {
  try {
    const { licentie_code } = req.body;
    
    if (!licentie_code) {
      return res.status(400).json({ error: 'licentie_code required' });
    }

    const license = await LicenseService.redeemLicense(req.user.id, licentie_code);
    res.json({ ok: true, license });
  } catch (err) {
    console.error('/redeem-license error:', err);
    res.status(400).json({ error: err.message });
  }
});

// Get license usage for a class
router.get('/license-usage/:klasId', auth, async (req, res) => {
  try {
    const klasId = parseInt(req.params.klasId, 10);
    
    // This would need to be implemented in LicenseService
    // For now, returning a basic response
    res.json({ 
      message: 'License usage endpoint - to be implemented',
      klasId 
    });
  } catch (err) {
    console.error('/license-usage error:', err);
    res.status(500).json({ error: 'server error' });
  }
});

export default router;
