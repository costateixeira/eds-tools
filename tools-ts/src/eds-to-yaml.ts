/**
 * EDS to YAML converter
 *
 * Converts EDS binary format to human-readable YAML format
 */

import * as fs from 'fs';
import * as path from 'path';
import * as YAML from 'yaml';
import { edsToJson, EdsData, EdsItem, SitplanJson } from './eds-codec.js';
import { getDefaults, SCHEMA_VERSION } from './schema.js';

export const TOOL_VERSION = '1.0.0';

// Types for YAML output
interface YamlNode {
  [key: string]: unknown;
}

interface YamlSitplanLayer {
  pos: [number, number];
  ref?: string;
  id?: number;
  scale?: number;
  rotate?: number;
  page?: number;
  color?: string;
  image?: string;
  size?: [number, number];
  svg_length?: number;
}

interface YamlSitplan {
  defaults: {
    fontsize: number;
    scale: number;
    rotate: number;
  };
  layers: YamlSitplanLayer[];
}

interface YamlMetadata {
  schema_version: string;
  tool_version: string;
  generated_at: string;
}

interface YamlDocument {
  metadata?: YamlMetadata;
  properties?: Record<string, string>;
  sitplan?: YamlSitplan;
  elements: YamlNode[];
}

/**
 * Remove properties that match defaults, keeping only non-default values
 */
function stripDefaults(
  nodeType: string,
  props: Record<string, unknown>
): Record<string, unknown> {
  const defaults = getDefaults(nodeType);
  const result: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(props)) {
    // Skip type and nr, handled separately
    if (key === 'type' || key === 'nr') continue;

    // Skip auto-generated Kring names
    if (key === 'naam' && nodeType === 'Kring') continue;

    // Skip auto values
    if ((key === 'autonr' || key === 'autoKringNaam') && value === 'auto') {
      continue;
    }

    const defaultVal = defaults[key];
    // Compare as strings since EDS often stores numbers as strings
    if (defaultVal !== undefined && String(value) === String(defaultVal)) {
      continue;
    }

    result[key] = value;
  }

  return result;
}

/**
 * Generate next Kring name (A, B, C, ... Z, AA, AB, ...)
 */
function createKringNameGenerator(): () => string {
  let counter = 0;

  return () => {
    let name = '';
    let n = counter;
    while (true) {
      name = String.fromCharCode('A'.charCodeAt(0) + (n % 26)) + name;
      n = Math.floor(n / 26) - 1;
      if (n < 0) break;
    }
    counter++;
    return name;
  };
}

/**
 * Build tree structure from flat EDS data
 */
function buildTree(data: EdsItem[]): YamlNode[] {
  // Build id -> item lookup
  const idToItem = new Map<number, EdsItem>();
  for (const item of data) {
    idToItem.set(item.id, item);
  }

  // Build parent -> children lookup
  const childrenMap = new Map<number, EdsItem[]>();
  for (const item of data) {
    const parent = item.parent;
    if (!childrenMap.has(parent)) {
      childrenMap.set(parent, []);
    }
    childrenMap.get(parent)!.push(item);
  }

  // Sort children by their order in original data
  for (const [, children] of childrenMap) {
    children.sort((a, b) => data.indexOf(a) - data.indexOf(b));
  }

  // Track Kring names for comments
  const getNextKringName = createKringNameGenerator();
  let currentKringName: string | null = null;

  function buildNode(
    item: EdsItem,
    childNr?: number,
    kringName?: string | null
  ): YamlNode {
    const props = item.props as Record<string, unknown>;
    const nodeType = props.type as string;

    // Track Kring names
    if (nodeType === 'Kring') {
      currentKringName = getNextKringName();
    }

    // Strip default values
    const nonDefaultProps = stripDefaults(nodeType, props);

    // Build children recursively
    const children: YamlNode[] = [];
    const isKring = nodeType === 'Kring';
    let childCounter = 1;

    for (const child of childrenMap.get(item.id) || []) {
      if (isKring) {
        children.push(buildNode(child, childCounter, currentKringName));
        childCounter++;
      } else {
        children.push(buildNode(child, undefined, kringName));
      }
    }

    // Build comment for auto-generated refs
    let comment: string | undefined;
    if (nodeType === 'Kring' && currentKringName) {
      comment = `#${currentKringName}`;
    } else if (kringName && childNr) {
      comment = `#${kringName}.${childNr}`;
    }

    // Build YAML node
    const result: Record<string, unknown> = {};
    if (comment) {
      result._comment = comment;
    }
    if (Object.keys(nonDefaultProps).length > 0) {
      Object.assign(result, nonDefaultProps);
    }
    if (children.length > 0) {
      result.children = children;
    }

    // Use type as key if we have props or children
    if (Object.keys(result).length > 0) {
      return { [nodeType]: result };
    } else {
      return nodeType as unknown as YamlNode; // Simple string form
    }
  }

  // Build roots (parent = 0)
  const roots: YamlNode[] = [];
  for (const item of childrenMap.get(0) || []) {
    roots.push(buildNode(item));
  }

  return roots;
}

/**
 * Build mapping from element id to ref string (KringName.nr)
 */
function buildIdToRef(data: EdsItem[]): Map<number, string> {
  const idToRef = new Map<number, string>();
  const getNextKringName = createKringNameGenerator();
  let currentKringName: string | null = null;

  for (const item of data) {
    const props = item.props as Record<string, unknown>;
    const nodeType = props.type as string;

    if (nodeType === 'Kring') {
      currentKringName = getNextKringName();
    }

    if (currentKringName && props.nr) {
      const ref = `${currentKringName}.${props.nr}`;
      idToRef.set(item.id, ref);
    }
  }

  return idToRef;
}

/**
 * Extract embedded image from SVG and save to file
 */
function extractImageFromSvg(
  svgText: string,
  outputDir: string,
  index: number
): string | null {
  // Look for embedded base64 image
  const match = svgText.match(
    /data:image\/(png|jpeg|jpg);base64,([A-Za-z0-9+/=]+)/
  );
  if (!match) return null;

  let imgFormat = match[1];
  if (imgFormat === 'jpeg') imgFormat = 'jpg';
  const b64Data = match[2];

  const filename = `image_${index}.${imgFormat}`;
  const filepath = path.join(outputDir, filename);

  fs.writeFileSync(filepath, Buffer.from(b64Data, 'base64'));

  return filename;
}

/**
 * Convert sitplanjson to YAML sitplan format
 */
function buildSitplanYaml(
  sitplanjson: SitplanJson | null,
  idToRef: Map<number, string>,
  outputDir?: string
): YamlSitplan | null {
  if (!sitplanjson || !sitplanjson.elements?.length) {
    return null;
  }

  const defaults = sitplanjson.defaults || {};
  const defaultScale = defaults.scale ?? 0.7;
  const defaultRotate = defaults.rotate ?? 0;
  const defaultFontsize = defaults.fontsize ?? 10;

  const layers: YamlSitplanLayer[] = [];
  let imageIndex = 0;

  for (const elem of sitplanjson.elements) {
    const electroId = elem.electroItemId;
    const svgData = elem.svg || '';

    if (electroId === null && svgData) {
      // This is an embedded image layer
      const yamlLayer: YamlSitplanLayer = {
        pos: [
          Math.round(elem.posx * 10) / 10,
          Math.round(elem.posy * 10) / 10,
        ],
        size: [elem.sizex || 0, elem.sizey || 0],
      };

      // Extract and save image if output_dir provided
      if (outputDir) {
        const filename = extractImageFromSvg(svgData, outputDir, imageIndex);
        if (filename) {
          yamlLayer.image = filename;
          imageIndex++;
        }
      } else {
        yamlLayer.svg_length = svgData.length;
      }

      if ((elem.scale ?? defaultScale) !== defaultScale) {
        yamlLayer.scale = elem.scale;
      }
      if ((elem.rotate ?? defaultRotate) !== defaultRotate) {
        yamlLayer.rotate = elem.rotate;
      }
      if ((elem.page ?? 1) !== 1) {
        yamlLayer.page = elem.page;
      }

      layers.push(yamlLayer);
    } else if (electroId !== null) {
      // This is an electrical element reference
      const ref = idToRef.get(electroId);

      const yamlLayer: YamlSitplanLayer = {
        pos: [
          Math.round(elem.posx * 10) / 10,
          Math.round(elem.posy * 10) / 10,
        ],
      };

      // Use human-readable ref if available
      if (ref) {
        yamlLayer.ref = ref;
      } else {
        yamlLayer.id = electroId;
      }

      if ((elem.page ?? 1) !== 1) {
        yamlLayer.page = elem.page;
      }
      if (elem.scale !== defaultScale) {
        yamlLayer.scale = elem.scale;
      }
      if (elem.rotate !== defaultRotate) {
        yamlLayer.rotate = elem.rotate;
      }
      if (elem.color && elem.color !== '#000000' && elem.color !== 'black') {
        yamlLayer.color = elem.color;
      }

      layers.push(yamlLayer);
    }
  }

  if (layers.length === 0) {
    return null;
  }

  return {
    defaults: {
      fontsize: defaultFontsize,
      scale: defaultScale,
      rotate: defaultRotate,
    },
    layers,
  };
}

/**
 * Convert EDS file to YAML data structure
 */
export function edsToYamlData(
  edsPath: string,
  outputDir?: string
): YamlDocument {
  const edsJson = edsToJson(edsPath);

  // Build tree from data
  const tree = buildTree(edsJson.data);

  // Build properties
  const props = edsJson.properties || {};
  const properties: Record<string, string> = {};
  if (props.owner) {
    properties.owner = props.owner.replace(/<br>/g, '\n');
  }
  if (props.installer) {
    properties.installer = props.installer.replace(/<br>/g, '\n');
  }
  if (props.control) {
    properties.control = props.control.replace(/<br>/g, '\n');
  }
  if (props.info && props.info !== '2 x 230V ~50 Hz') {
    properties.info = props.info.replace(/<br>/g, '\n');
  }

  // Build sitplan
  const idToRef = buildIdToRef(edsJson.data);
  const sitplan = buildSitplanYaml(edsJson.sitplanjson, idToRef, outputDir);

  // Build result with explicit ordering (metadata, properties, sitplan, elements)
  const result: YamlDocument = { elements: tree };

  // Add metadata
  result.metadata = {
    schema_version: SCHEMA_VERSION,
    tool_version: TOOL_VERSION,
    generated_at: new Date().toISOString(),
  };

  if (Object.keys(properties).length > 0) {
    result.properties = properties;
  }
  if (sitplan) {
    result.sitplan = sitplan;
  }

  return result;
}

/**
 * Convert _comment fields to inline YAML comments
 */
function addYamlComments(yamlText: string): string {
  const lines = yamlText.split('\n');
  const result: string[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Check if next line is a _comment field
    if (i + 1 < lines.length) {
      const nextLine = lines[i + 1];
      const commentMatch = nextLine.match(
        /^(\s*)_comment:\s*['"]?(#[A-Z]+(?:\.\d+)?)['"]?\s*$/
      );

      if (commentMatch) {
        const comment = commentMatch[2];
        // Add comment to end of current line
        if (line.trimEnd().endsWith(':')) {
          result.push(`${line} ${comment}`);
        } else {
          result.push(`${line}  ${comment}`);
        }
        i += 2; // Skip the _comment line
        continue;
      }
    }
    result.push(line);
    i++;
  }

  return result.join('\n');
}

/**
 * Serialize YAML with explicit key ordering
 */
function serializeYaml(data: YamlDocument): string {
  const parts: string[] = [];

  // Metadata section
  if (data.metadata) {
    parts.push('metadata:');
    parts.push(`  schema_version: "${data.metadata.schema_version}"`);
    parts.push(`  tool_version: "${data.metadata.tool_version}"`);
    parts.push(`  generated_at: "${data.metadata.generated_at}"`);
    parts.push('');
  }

  // Properties section
  if (data.properties && Object.keys(data.properties).length > 0) {
    parts.push('properties:');
    for (const [key, value] of Object.entries(data.properties)) {
      if (value.includes('\n')) {
        parts.push(`  ${key}: |`);
        for (const line of value.split('\n')) {
          parts.push(`    ${line}`);
        }
      } else {
        parts.push(`  ${key}: ${value}`);
      }
    }
    parts.push('');
  }

  // Sitplan section
  if (data.sitplan) {
    const sitplanDoc = new YAML.Document({ sitplan: data.sitplan });
    let sitplanText = sitplanDoc.toString({ lineWidth: 0 });
    // Convert pos/size arrays to flow style
    sitplanText = sitplanText.replace(
      /pos:\s*\n\s*-\s*(\d+(?:\.\d+)?)\s*\n\s*-\s*(\d+(?:\.\d+)?)/g,
      'pos: [$1, $2]'
    );
    sitplanText = sitplanText.replace(
      /size:\s*\n\s*-\s*(\d+(?:\.\d+)?)\s*\n\s*-\s*(\d+(?:\.\d+)?)/g,
      'size: [$1, $2]'
    );
    parts.push(sitplanText.trim());
    parts.push('');
  }

  // Elements section
  const elementsDoc = new YAML.Document({ elements: data.elements });
  let elementsText = elementsDoc.toString({ lineWidth: 0 });
  parts.push(elementsText.trim());

  return parts.join('\n');
}

/**
 * Convert EDS file to YAML file
 */
export function edsToYaml(edsPath: string, yamlPath: string): void {
  const outputDir = path.dirname(path.resolve(yamlPath));
  const data = edsToYamlData(edsPath, outputDir);

  let yamlText = serializeYaml(data);
  yamlText = addYamlComments(yamlText);

  fs.writeFileSync(yamlPath, yamlText, 'utf-8');
  console.log(`Converted ${edsPath} -> ${yamlPath}`);
}

export { buildTree, stripDefaults, buildIdToRef };
