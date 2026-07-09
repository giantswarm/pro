/**
 * Fields Management Module
 *
 * Provides functions to list, find, and match GitHub Project V2 fields
 * on a given project board. All functions return data directly
 * without console output.
 */

import { fetchPaginated } from './api.js';
import { LIST_FIELDS_QUERY } from './project.js';
import { normalizeFieldValue } from './utils.js';
import { logger } from './logger.js';

/**
 * List all fields in a project board
 * @param {string} boardId - The GitHub project node ID
 * @param {string} [token] - Optional per-request GitHub token
 * @returns {Promise<Array>} - Array of field objects
 */
export async function listFields(boardId, token) {
  const first = 100;
  try {
    const allFields = await fetchPaginated(
      LIST_FIELDS_QUERY,
      { projectId: boardId, first },
      result => result.node.fields,
      token
    );

    return allFields;
  } catch (error) {
    logger.error(`Error fetching fields: ${error.message}`);
    throw error;
  }
}

/**
 * Updatable field __typename values.
 * - ProjectV2SingleSelectField: single-select fields (Status, Kind, etc.)
 * - ProjectV2IterationField: iteration fields (Quarter, Sprint, etc.)
 * - ProjectV2Field with dataType DATE: date fields (Start Date, Target Date, etc.)
 */
const UPDATABLE_FIELD_TYPES = new Set([
  'ProjectV2SingleSelectField',
  'ProjectV2IterationField',
]);

/**
 * Find a field by name in a project board.
 * Returns single-select, iteration, and date fields that can be updated.
 * @param {string} fieldName - The name of the field to find (case insensitive)
 * @param {string} boardId - The GitHub project node ID
 * @param {string} [token] - Optional per-request GitHub token
 * @returns {Promise<Object|null>} - The field object or null if not found
 */
export async function findFieldByName(fieldName, boardId, token) {
  const allFields = await listFields(boardId, token);

  const field = allFields.find(field => {
    if (field.name.toLowerCase() !== fieldName.toLowerCase()) return false;
    if (UPDATABLE_FIELD_TYPES.has(field.__typename)) return true;
    // ProjectV2Field with dataType DATE
    if (field.__typename === 'ProjectV2Field' && field.dataType === 'DATE') return true;
    return false;
  });

  return field || null;
}

/**
 * Find a matching option in a field's options
 * @param {Array} options - Field options
 * @param {string} optionName - The name to match
 * @returns {Object|null} - Matching option or null
 */
export function findMatchingOption(options, optionName) {
  if (!optionName) return null;

  // Try direct match first
  const exactMatch = options.find(option => option.name === optionName);
  if (exactMatch) return exactMatch;

  // Try case-insensitive match with normalization
  const normalizedName = normalizeFieldValue(optionName);
  return options.find(option => {
    const normalizedOption = normalizeFieldValue(option.name);
    return normalizedOption === normalizedName;
  });
}

/**
 * Find a matching iteration in a field's iteration configuration
 * @param {Object} field - An iteration field with configuration.iterations[]
 * @param {string} value - The iteration title to match (e.g. "Q2 2026")
 * @returns {Object|null} - Matching iteration {id, title, startDate, duration} or null
 */
export function findMatchingIteration(field, value) {
  const iterations = field.configuration?.iterations;
  if (!iterations?.length || !value) return null;

  // Try direct match first
  const exactMatch = iterations.find(iter => iter.title === value);
  if (exactMatch) return exactMatch;

  // Try case-insensitive match with normalization
  const normalizedValue = normalizeFieldValue(value);
  return iterations.find(iter => {
    const normalizedTitle = normalizeFieldValue(iter.title);
    return normalizedTitle === normalizedValue;
  }) || null;
}
