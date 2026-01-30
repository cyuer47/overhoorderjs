import { getDB } from './database.js';
import crypto from 'crypto';

export class LicenseService {
  static async createLicense(adminId, { max_leerlingen = 30, vervalt_op, aantal = 1 }) {
    const db = getDB();
    const createdLicenses = [];

    for (let i = 0; i < aantal; i++) {
      const licentie_code = crypto.randomBytes(8).toString('hex').toUpperCase();
      
      const result = await db.run(
        'INSERT INTO licenties (max_leerlingen, vervalt_op, licentie_code, created_by, created_at) VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)',
        max_leerlingen,
        vervalt_op || null,
        licentie_code,
        adminId
      );
      
      createdLicenses.push({
        id: result.lastID,
        licentie_code,
        max_leerlingen,
        vervalt_op
      });
    }
    
    return createdLicenses;
  }

  static async redeemLicense(userId, licentie_code) {
    const db = getDB();
    
    // Find unused license code
    const license = await db.get(
      'SELECT * FROM licenties WHERE licentie_code = ? AND is_redeemed = 0',
      licentie_code.toUpperCase()
    );

    if (!license) {
      throw new Error('Ongeldige of al gebruikte licentiecode');
    }

    // Check if expired
    if (license.vervalt_op && new Date(license.vervalt_op) < new Date()) {
      throw new Error('Licentie is verlopen');
    }

    // Mark as redeemed
    await db.run(
      'UPDATE licenties SET is_redeemed = 1, redeemed_by = ?, redeemed_at = CURRENT_TIMESTAMP, docent_id = ? WHERE id = ?',
      userId,
      userId,
      license.id
    );
    
    const updatedLicense = await db.get('SELECT * FROM licenties WHERE id = ?', license.id);
    return updatedLicense;
  }

  static async getAllLicenses() {
    const db = getDB();
    return await db.all(`
      SELECT l.*, d1.naam as created_by_name, d2.naam as redeemed_by_name 
      FROM licenties l 
      LEFT JOIN docenten d1 ON l.created_by = d1.id 
      LEFT JOIN docenten d2 ON l.redeemed_by = d2.id 
      ORDER BY l.created_at DESC
    `);
  }

  static async getLicensesByTeacher(teacherId) {
    const db = getDB();
    return await db.all(`
      SELECT l.*, k.naam as klas_naam, COUNT(lr.id) as huidige_leerlingen 
      FROM licenties l 
      LEFT JOIN klassen k ON l.klas_id = k.id 
      LEFT JOIN leerlingen lr ON lr.klas_id = k.id 
      WHERE l.docent_id = ? AND l.is_redeemed = 1 AND l.actief = 1 
        AND (l.vervalt_op IS NULL OR DATE(l.vervalt_op) >= DATE('now')) 
      GROUP BY l.id
    `, teacherId);
  }

  static async getAvailableLicense(teacherId) {
    const db = getDB();
    return await db.get(
      'SELECT * FROM licenties WHERE docent_id = ? AND is_redeemed = 1 AND actief = 1 AND (vervalt_op IS NULL OR DATE(vervalt_op) >= DATE(\'now\')) AND klas_id IS NULL LIMIT 1',
      teacherId
    );
  }

  static async assignLicenseToClass(licenseId, klasId) {
    const db = getDB();
    await db.run(
      'UPDATE licenties SET klas_id = ? WHERE id = ?',
      klasId,
      licenseId
    );
  }
}
