import crypto from 'crypto';

export const escapeHtml = (s) => {
  if (!s) return '';
  return String(s).replace(
    /[&<>"']/g,
    (c) =>
      ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
      }[c])
  );
};

export const generateRandomCode = (length = 8) => {
  return crypto.randomBytes(length).toString('hex').toUpperCase();
};

export const validateEmail = (email) => {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
};

export const validateRequired = (data, requiredFields) => {
  const missing = requiredFields.filter(field => !data[field]);
  return missing.length === 0 ? null : missing;
};
