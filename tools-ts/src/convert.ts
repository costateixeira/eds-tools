/**
 * YAML to EDS converter
 *
 * Converts human-readable YAML format to EDS binary format
 */

import * as fs from 'fs';
import * as path from 'path';
import * as YAML from 'yaml';
import { jsonToEds, EdsData, EdsItem, SitplanJson, SitplanElement } from './eds-codec.js';
import { SCHEMA, getDefaults, getTypeNames } from './schema.js';

// Types for YAML input
interface YamlNode {
  type?: string;
  props?: Record<string, unknown>;
  children?: YamlNode[];
  nr?: number | string;
  [key: string]: unknown;
}

interface YamlProperties {
  owner?: string;
  installer?: string;
  control?: string;
  info?: string;
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
  labelfontsize?: number;
  adreslocation?: string;
}

interface YamlSitplan {
  numPages?: number;
  activePage?: number;
  defaults?: {
    fontsize?: number;
    scale?: number;
    rotate?: number;
  };
  layers?: YamlSitplanLayer[];
  elements?: YamlSitplanLayer[]; // Old format
}

interface YamlMetadata {
  schema_version?: string;
  tool_version?: string;
  generated_at?: string;
}

interface YamlDocument {
  metadata?: YamlMetadata;
  properties?: YamlProperties;
  sitplan?: YamlSitplan;
  elements?: YamlNode[];
}

const TYPE_NAMES = getTypeNames();

/**
 * Convert shorthand syntax to standard format
 */
function normalizeNode(node: unknown): YamlNode {
  if (typeof node === 'string') {
    // Simple string: "Lichtcircuit"
    return { type: node };
  }

  if (typeof node === 'object' && node !== null) {
    const nodeObj = node as Record<string, unknown>;

    if ('type' in nodeObj) {
      // Already in standard format
      return nodeObj as YamlNode;
    }

    // Check if it's a type-name-as-key format
    for (const typeName of TYPE_NAMES) {
      if (typeName in nodeObj) {
        const value = (nodeObj[typeName] || {}) as Record<string, unknown>;
        const result: YamlNode = { type: typeName };

        if (typeof value === 'object' && value !== null) {
          // Extract children and props
          const { children, props, ...rest } = value as {
            children?: YamlNode[];
            props?: Record<string, unknown>;
            [key: string]: unknown;
          };

          // Combine explicit props with remaining keys
          const combinedProps = { ...(props || {}), ...rest };
          if (Object.keys(combinedProps).length > 0) {
            result.props = combinedProps;
          }
          if (children) {
            result.children = children;
          }
        }
        return result;
      }
    }
  }

  return node as YamlNode;
}

/**
 * Apply defaults for a node type, then overlay with provided props
 */
function applyDefaults(
  nodeType: string,
  props: Record<string, unknown>
): Record<string, unknown> {
  const defaults = getDefaults(nodeType);
  return { ...defaults, ...props };
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
 * Load image file and wrap in SVG with base64 encoding
 */
function loadImageAsSvg(imagePath: string, size: [number, number]): string {
  const ext = path.extname(imagePath).toLowerCase().slice(1);
  const mimeTypes: Record<string, string> = {
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
  };
  const mimeType = mimeTypes[ext] || 'image/png';

  const imgData = fs.readFileSync(imagePath).toString('base64');
  const [width, height] = size;

  return `<svg width="${width}" height="${height}"><image xlink:href="data:${mimeType};base64,${imgData}" width="${width}" height="${height}"/></svg>`;
}

/**
 * Build sitplanjson from YAML sitplan section
 */
function buildSitplanJson(
  sitplan: YamlSitplan | undefined,
  refToId: Map<string, number>,
  yamlDir?: string
): SitplanJson {
  if (!sitplan) {
    return {
      numPages: 1,
      activePage: 1,
      defaults: { fontsize: 11, scale: 0.7, rotate: 0 },
      elements: [],
    };
  }

  const defaults = sitplan.defaults || {};
  const defaultFontsize = defaults.fontsize ?? 10;
  const defaultScale = defaults.scale ?? 0.25;
  const defaultRotate = defaults.rotate ?? 0;

  const elements: SitplanElement[] = [];

  // Support both 'layers' (new format) and 'elements' (old format)
  const layerList = sitplan.layers || sitplan.elements || [];

  for (const layer of layerList) {
    const pos = layer.pos || [0, 0];
    const scale = layer.scale ?? defaultScale;
    const rotate = layer.rotate ?? defaultRotate;
    const page = layer.page ?? 1;
    const color = layer.color ?? '#000000';

    if (layer.image) {
      // This is an image layer
      const size = layer.size || [200, 200];

      let svgContent = '';
      if (yamlDir) {
        const imagePath = path.join(yamlDir, layer.image);
        if (fs.existsSync(imagePath)) {
          svgContent = loadImageAsSvg(imagePath, size);
        } else {
          console.warn(`Warning: Image file '${layer.image}' not found`);
        }
      }

      elements.push({
        page,
        posx: pos[0],
        posy: pos[1],
        sizex: size[0],
        sizey: size[1],
        labelposx: pos[0] + size[0] * 0.2,
        labelposy: pos[1] + 1,
        labelfontsize: defaultFontsize,
        adrestype: null,
        adres: null,
        adreslocation: 'rechts',
        rotate,
        scale,
        movable: true,
        color,
        svg: svgContent,
        electroItemId: null,
      });
    } else {
      // This is an electrical element reference
      const ref = layer.ref;
      let electroId: number | undefined;

      if (ref) {
        electroId = refToId.get(ref);
        if (electroId === undefined) {
          console.warn(`Warning: sitplan ref '${ref}' not found in schema`);
          continue;
        }
      } else if (layer.id !== undefined) {
        electroId = layer.id;
      } else {
        continue;
      }

      const labelfontsize = layer.labelfontsize ?? defaultFontsize;

      // Calculate size based on scale
      const baseSize = 200;
      const sizex = Math.floor(baseSize * scale) + 1;
      const sizey = Math.floor(baseSize * scale);

      elements.push({
        page,
        posx: pos[0],
        posy: pos[1],
        sizex,
        sizey,
        labelposx: pos[0] + sizex * 0.2,
        labelposy: pos[1] + 1,
        labelfontsize,
        adrestype: 'auto',
        adres: null,
        adreslocation: layer.adreslocation ?? 'rechts',
        rotate,
        scale,
        movable: true,
        color,
        svg: '',
        electroItemId: electroId,
      });
    }
  }

  return {
    numPages: sitplan.numPages ?? 1,
    activePage: sitplan.activePage ?? 1,
    defaults: {
      fontsize: defaultFontsize,
      scale: defaultScale,
      rotate: defaultRotate,
    },
    elements,
  };
}

/**
 * Compile YAML tree to EDS data structure
 */
function compileTree(
  tree: YamlNode[],
  properties?: YamlProperties,
  sitplan?: YamlSitplan,
  yamlDir?: string
): EdsData {
  const data: EdsItem[] = [];
  const active: boolean[] = [];
  const ids: number[] = [];
  let nextId = 1;

  // Map "KringName.nr" -> element id for sitplan references
  const refToId = new Map<string, number>();
  const getNextKringName = createKringNameGenerator();
  let currentKringName: string | null = null;

  function walk(
    node: YamlNode,
    parent = 0,
    indent = 0,
    autoNr?: number
  ): void {
    const myId = nextId++;

    // Normalize shorthand syntax
    const normalizedNode = normalizeNode(node);
    const nodeType = normalizedNode.type!;

    // Apply defaults then overlay with provided props
    const props = applyDefaults(nodeType, normalizedNode.props || {});
    props.type = nodeType;

    // nr: explicit > auto-assigned > empty
    if ('nr' in normalizedNode) {
      props.nr = String(normalizedNode.nr);
    } else if (autoNr !== undefined) {
      props.nr = String(autoNr);
    } else if (!('nr' in props)) {
      props.nr = '';
    }

    const item: EdsItem = {
      id: myId,
      parent,
      indent,
      collapsed: false,
      props,
      sourcelist: null,
    };

    data.push(item);
    active.push(true);
    ids.push(myId);

    // Track Kring name for sitplan refs
    if (nodeType === 'Kring') {
      currentKringName = getNextKringName();
    }

    // Register ref for sitplan (KringName.nr)
    if (currentKringName && props.nr) {
      const ref = `${currentKringName}.${props.nr}`;
      refToId.set(ref, myId);
    }

    // Auto-number children within Kring
    const isKring = nodeType === 'Kring';
    let childNr = 1;

    for (const child of normalizedNode.children || []) {
      const childNorm = normalizeNode(child);
      if (isKring && !('nr' in childNorm)) {
        walk(childNorm, myId, indent + 1, childNr);
        childNr++;
      } else {
        walk(childNorm, myId, indent + 1);
      }
    }
  }

  // Process all root elements
  for (const root of tree) {
    walk(root);
  }

  return {
    currentView: '',
    idToOrdinalMap: {},
    length: data.length,
    data,
    active,
    id: ids,
    print_table: {
      height: 562,
      maxwidth: 484,
      displaypage: 0,
      enableAutopage: true,
      printPageMode: 'all',
      printPageRange: '',
      pages: [
        {
          height: 562,
          start: 0,
          stop: 484,
          info: properties?.info || '2 x 230V ~50 Hz',
        },
      ],
      pagemarkers: { markers: [] },
      modevertical: 'alles',
      starty: 0,
      stopy: 562,
      papersize: 'A4',
    },
    properties: {
      filename: '',
      owner: (properties?.owner || '').trim().replace(/\n/g, '<br>'),
      installer: (properties?.installer || '').trim().replace(/\n/g, '<br>'),
      control: (properties?.control || '').trim().replace(/\n/g, '<br>'),
      info: (properties?.info || '2 x 230V ~50 Hz').trim().replace(/\n/g, '<br>'),
      currentView: null,
      legacySchakelaars: false,
    },
    curid: nextId,
    mode: 'edit',
    sitplan: null,
    sitplanjson: buildSitplanJson(sitplan, refToId, yamlDir),
    sitplanview: null,
  };
}

/**
 * Convert YAML file to EDS file
 */
export function yamlToEds(yamlPath: string, edsPath: string): void {
  const yamlContent = fs.readFileSync(yamlPath, 'utf-8');
  const doc = YAML.parse(yamlContent) as YamlDocument;

  // Get directory of YAML file for resolving relative image paths
  const yamlDir = path.dirname(path.resolve(yamlPath));

  // Extract sections
  const properties = doc.properties;
  const sitplan = doc.sitplan;
  const elements = doc.elements || [];

  const edsData = compileTree(elements, properties, sitplan, yamlDir);
  jsonToEds(edsData, edsPath);

  console.log(`Converted ${yamlPath} -> ${edsPath}`);
}

export { compileTree, normalizeNode, applyDefaults };
