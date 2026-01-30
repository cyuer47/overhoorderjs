import { body, validationResult, param, query } from "express-validator";

/**
 * Validation middleware helpers and custom validators
 */

/**
 * Handle validation errors - middleware to check results
 */
export function handleValidationErrors(req, res, next) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      error: "Validation failed",
      details: errors.array(),
    });
  }
  next();
}

/**
 * Validators for user/docent endpoints
 */
export const registerValidation = [
  body("email").isEmail().normalizeEmail(),
  body("password")
    .isLength({ min: 6 })
    .withMessage("Password must be at least 6 characters"),
  body("naam").optional().trim().isLength({ min: 1 }),
];

export const loginValidation = [
  body("email").isEmail().normalizeEmail(),
  body("password").notEmpty().withMessage("Password is required"),
];

/**
 * Validators for class endpoints
 */
export const createKlasValidation = [
  body("naam")
    .trim()
    .notEmpty()
    .withMessage("Class name is required")
    .isLength({ min: 1, max: 255 }),
  body("vak").optional().trim().isLength({ max: 255 }),
];

/**
 * Validators for question list endpoints
 */
export const createVragenlijstValidation = [
  body("klas_id").isInt().withMessage("Valid class ID required"),
  body("naam")
    .trim()
    .notEmpty()
    .withMessage("Question list name is required")
    .isLength({ min: 1, max: 255 }),
];

/**
 * Validators for question endpoints
 */
export const createVraagValidation = [
  body("vraag").trim().notEmpty().withMessage("Question is required"),
  body("antwoord").trim().notEmpty().withMessage("Answer is required"),
];

/**
 * Validators for session endpoints
 */
export const createSessieValidation = [
  body("klas_id").isInt().withMessage("Valid class ID required"),
  body("vragenlijst_id").isInt().withMessage("Valid question list ID required"),
];

/**
 * Validators for student submission
 */
export const submitAnswerValidation = [
  param("id").isInt().withMessage("Valid session ID required"),
  body("leerling_id").isInt().withMessage("Valid student ID required"),
  body("vraag_id").isInt().withMessage("Valid question ID required"),
  body("antwoord").trim().notEmpty().withMessage("Answer is required"),
];

/**
 * Validators for student join
 */
export const studentJoinValidation = [
  body("klascode")
    .trim()
    .toUpperCase()
    .notEmpty()
    .withMessage("Class code is required"),
  body("naam")
    .trim()
    .notEmpty()
    .withMessage("Student name is required")
    .isLength({ min: 1, max: 255 }),
];

/**
 * Validators for grading
 */
export const gradeAnswerValidation = [
  body("resultaat_id").isInt().withMessage("Valid result ID required"),
  body("status")
    .isIn(["goed", "typfout", "fout", "onbekend"])
    .withMessage("Invalid status"),
];
