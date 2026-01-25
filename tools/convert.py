# convert.py - Simple script to convert YAML to EDS
import sys
import os
import yaml
import copy
from eds_codec import json_to_eds

SCHEMA_VERSION = "1.0.0"

# Load defaults from schema.yaml
def load_schema():
    """Load element type defaults from schema.yaml."""
    global SCHEMA_VERSION
    schema_path = os.path.join(os.path.dirname(__file__), "schema.yaml")
    with open(schema_path, "r", encoding="utf-8") as f:
        schema = yaml.safe_load(f)

    # Get schema version
    SCHEMA_VERSION = schema.get("version", "1.0.0")

    defaults = {}
    for type_name, type_def in schema.get("types", {}).items():
        defaults[type_name] = type_def.get("defaults", {})
    return defaults

DEFAULTS = load_schema()

def normalize_node(node):
    """Convert shorthand syntax to standard format.

    Supports:
    - "Lichtcircuit" -> {type: Lichtcircuit}
    - Lichtcircuit: {props: ...} -> {type: Lichtcircuit, props: ...}
    - {type: Lichtcircuit, ...} -> unchanged
    """
    if isinstance(node, str):
        # Simple string: "Lichtcircuit"
        return {"type": node}

    if isinstance(node, dict):
        if "type" in node:
            # Already in standard format
            return node

        # Check if it's a type-name-as-key format
        for type_name in DEFAULTS.keys():
            if type_name in node:
                # Format: Lichtcircuit: {props: ..., children: ...}
                # Or:     Lichtcircuit: {type_lamp: spot, children: ...}
                value = node[type_name] or {}
                result = {"type": type_name}
                if isinstance(value, dict):
                    # Separate children from props
                    children = value.pop("children", None)
                    props = value.pop("props", None)
                    # Remaining keys are direct props
                    if value:
                        props = {**(props or {}), **value}
                    if props:
                        result["props"] = props
                    if children:
                        result["children"] = children
                return result

    return node

def apply_defaults(node_type, props):
    """Apply defaults for a node type, then overlay with provided props."""
    defaults = DEFAULTS.get(node_type, {})
    result = copy.deepcopy(defaults)
    result.update(props)
    return result

def compile_tree(tree, properties=None, sitplan=None, yaml_dir=None):
    data = []
    active = []
    ids = []
    next_id = 1
    # Map "KringName.nr" -> element id for sitplan references
    ref_to_id = {}
    current_kring_name = None
    kring_counter = 0

    def get_next_kring_name():
        nonlocal kring_counter
        # Generate A, B, C, ... Z, AA, AB, ...
        name = ""
        n = kring_counter
        while True:
            name = chr(ord('A') + n % 26) + name
            n = n // 26 - 1
            if n < 0:
                break
        kring_counter += 1
        return name

    def walk(node, parent=0, indent=0, auto_nr=None, kring_name=None):
        nonlocal next_id, current_kring_name
        my_id = next_id
        next_id += 1

        # Normalize shorthand syntax
        node = normalize_node(node)
        node_type = node["type"]
        # Apply defaults then overlay with provided props
        props = apply_defaults(node_type, node.get("props", {}))
        props["type"] = node_type

        # nr: explicit > auto-assigned > empty
        if "nr" in node:
            props = {"nr": str(node["nr"]), **props}
        elif auto_nr is not None:
            props = {"nr": str(auto_nr), **props}
        elif "nr" not in props:
            props = {"nr": "", **props}

        item = {
            "id": my_id,
            "parent": parent,
            "indent": indent,
            "collapsed": False,
            "props": props,
            "sourcelist": None
        }

        data.append(item)
        active.append(True)
        ids.append(my_id)

        # Track Kring name for sitplan refs
        if node_type == "Kring":
            current_kring_name = get_next_kring_name()

        # Register ref for sitplan (KringName.nr)
        if current_kring_name and props.get("nr"):
            ref = f"{current_kring_name}.{props['nr']}"
            ref_to_id[ref] = my_id

        # Auto-number children within Kring
        is_kring = node_type == "Kring"
        child_nr = 1
        for child in node.get("children", []):
            # Normalize child to check for explicit nr
            child_norm = normalize_node(child)
            if is_kring and "nr" not in child_norm:
                walk(child_norm, my_id, indent + 1, auto_nr=child_nr, kring_name=current_kring_name)
                child_nr += 1
            else:
                walk(child_norm, my_id, indent + 1, kring_name=current_kring_name)

    # Support single root or list of roots
    roots = tree if isinstance(tree, list) else [tree]
    for root in roots:
        walk(root)

    return {
        "currentView": "",
        "idToOrdinalMap": {},
        "length": len(data),
        "data": data,
        "active": active,
        "id": ids,
        "print_table": {
            "height": 562,
            "maxwidth": 484,
            "displaypage": 0,
            "enableAutopage": True,
            "printPageMode": "all",
            "printPageRange": "",
            "pages": [{"height": 562, "start": 0, "stop": 484, "info": "2 x 230V ~50 Hz"}],
            "pagemarkers": {"markers": []},
            "modevertical": "alles",
            "starty": 0,
            "stopy": 562,
            "papersize": "A4"
        },
        "properties": {
            "filename": "",
            "owner": (properties or {}).get("owner", "").strip().replace("\n", "<br>"),
            "installer": (properties or {}).get("installer", "").strip().replace("\n", "<br>"),
            "control": (properties or {}).get("control", "").strip().replace("\n", "<br>"),
            "info": (properties or {}).get("info", "2 x 230V ~50 Hz").strip().replace("\n", "<br>"),
            "currentView": None,
            "legacySchakelaars": False
        },
        "curid": next_id,
        "mode": "edit",
        "sitplan": None,
        "sitplanjson": build_sitplanjson(sitplan, ref_to_id, yaml_dir),
        "sitplanview": None
    }

def load_image_as_svg(image_path, size):
    """Load an image file and wrap it in SVG with base64 encoding."""
    import base64

    ext = image_path.lower().rsplit('.', 1)[-1]
    mime_types = {'png': 'image/png', 'jpg': 'image/jpeg', 'jpeg': 'image/jpeg', 'gif': 'image/gif'}
    mime_type = mime_types.get(ext, 'image/png')

    with open(image_path, 'rb') as f:
        img_data = base64.b64encode(f.read()).decode('ascii')

    width, height = size
    return f'<svg width="{width}" height="{height}"><image xlink:href="data:{mime_type};base64,{img_data}" width="{width}" height="{height}"/></svg>'

def build_sitplanjson(sitplan, ref_to_id, yaml_dir=None):
    """Build sitplanjson from YAML sitplan section."""
    if not sitplan:
        return {
            "numPages": 1,
            "activePage": 1,
            "defaults": {"fontsize": 11, "scale": 0.7, "rotate": 0},
            "elements": []
        }

    # Get defaults
    defaults = sitplan.get("defaults", {})
    default_fontsize = defaults.get("fontsize", 10)
    default_scale = defaults.get("scale", 0.25)
    default_rotate = defaults.get("rotate", 0)

    elements = []

    # Support both 'layers' (new format) and 'elements' (old format)
    layer_list = sitplan.get("layers", sitplan.get("elements", []))

    for layer in layer_list:
        pos = layer.get("pos", [0, 0])
        scale = layer.get("scale", default_scale)
        rotate = layer.get("rotate", default_rotate)
        page = layer.get("page", 1)
        color = layer.get("color", "#000000")

        if "image" in layer:
            # This is an image layer
            size = layer.get("size", [200, 200])
            image_file = layer["image"]

            # Load image from file
            svg_content = ""
            if yaml_dir:
                image_path = os.path.join(yaml_dir, image_file)
                if os.path.exists(image_path):
                    svg_content = load_image_as_svg(image_path, size)
                else:
                    print(f"Warning: Image file '{image_file}' not found")

            elements.append({
                "page": page,
                "posx": pos[0],
                "posy": pos[1],
                "sizex": size[0],
                "sizey": size[1],
                "labelposx": pos[0] + size[0] * 0.2,
                "labelposy": pos[1] + 1,
                "labelfontsize": default_fontsize,
                "adrestype": None,
                "adres": None,
                "adreslocation": "rechts",
                "rotate": rotate,
                "scale": scale,
                "movable": True,
                "color": color,
                "svg": svg_content,
                "electroItemId": None
            })
        else:
            # This is an electrical element reference
            ref = layer.get("ref")
            elem_id = layer.get("id")  # Support internal ID as alternative

            if ref:
                electro_id = ref_to_id.get(ref)
                if not electro_id:
                    print(f"Warning: sitplan ref '{ref}' not found in schema")
                    continue
            elif elem_id:
                electro_id = elem_id
            else:
                continue

            labelfontsize = layer.get("labelfontsize", default_fontsize)

            # Calculate size based on scale (default symbol size ~200x200)
            base_size = 200
            sizex = int(base_size * scale) + 1
            sizey = int(base_size * scale)

            # Label position offset
            labelposx = pos[0] + sizex * 0.2
            labelposy = pos[1] + 1

            elements.append({
                "page": page,
                "posx": pos[0],
                "posy": pos[1],
                "sizex": sizex,
                "sizey": sizey,
                "labelposx": labelposx,
                "labelposy": labelposy,
                "labelfontsize": labelfontsize,
                "adrestype": "auto",
                "adres": None,
                "adreslocation": layer.get("adreslocation", "rechts"),
                "rotate": rotate,
                "scale": scale,
                "movable": True,
                "color": color,
                "svg": "",
                "electroItemId": electro_id
            })

    return {
        "numPages": sitplan.get("numPages", 1),
        "activePage": sitplan.get("activePage", 1),
        "defaults": {
            "fontsize": default_fontsize,
            "scale": default_scale,
            "rotate": default_rotate
        },
        "elements": elements
    }

def yaml_to_eds(yaml_path, eds_path):
    with open(yaml_path, "r", encoding="utf-8") as f:
        tree = yaml.safe_load(f)

    # Get directory of YAML file for resolving relative image paths
    yaml_dir = os.path.dirname(os.path.abspath(yaml_path))

    # Extract properties and sitplan if present
    properties = None
    sitplan = None
    if isinstance(tree, dict):
        properties = tree.pop("properties", None)
        sitplan = tree.pop("sitplan", None)
        tree = tree.get("elements", [])

    json_to_eds(compile_tree(tree, properties, sitplan, yaml_dir), eds_path)
    print(f"Converted {yaml_path} -> {eds_path}")

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python convert.py input.yaml [output.eds]")
        print("       If output.eds is omitted, uses input name with .eds extension")
        sys.exit(1)

    yaml_path = sys.argv[1]
    if len(sys.argv) >= 3:
        eds_path = sys.argv[2]
    else:
        eds_path = yaml_path.rsplit(".", 1)[0] + ".eds"

    yaml_to_eds(yaml_path, eds_path)
