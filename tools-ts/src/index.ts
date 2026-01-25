/**
 * Eendraadschema Tools
 *
 * Library for converting between YAML and EDS formats for
 * single-line electrical diagrams (eendraadschema).
 */

// EDS codec
export { edsToJson, jsonToEds } from './eds-codec.js';
export type {
  EdsData,
  EdsItem,
  EdsProperties,
  SitplanJson,
  SitplanElement,
  SitplanDefaults,
} from './eds-codec.js';

// YAML to EDS conversion
export { yamlToEds, compileTree, normalizeNode, applyDefaults } from './convert.js';

// EDS to YAML conversion
export { edsToYaml, edsToYamlData, buildTree, stripDefaults, buildIdToRef, TOOL_VERSION } from './eds-to-yaml.js';

// Schema definitions
export { SCHEMA, getDefaults, getTypeNames, SCHEMA_VERSION } from './schema.js';
export type { ElementDefaults, SchemaTypes } from './schema.js';
