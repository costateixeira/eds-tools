# eds_to_yaml.py - Convert EDS to YAML format
import sys
import os
import yaml
import json
from datetime import datetime, timezone
from eds_codec import eds_to_json

SCHEMA_VERSION = "1.0.0"
TOOL_VERSION = "1.0.0"

# Custom list type for flow-style output
class FlowList(list):
    """List that will be dumped in flow style."""
    pass

def represent_flow_list(dumper, data):
    return dumper.represent_sequence('tag:yaml.org,2002:seq', data, flow_style=True)

yaml.add_representer(FlowList, represent_flow_list)

# Load defaults from schema.yaml
def load_schema():
    """Load element type defaults and version from schema.yaml."""
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

def strip_defaults(node_type, props):
    """Remove properties that match defaults, keeping only non-default values."""
    defaults = DEFAULTS.get(node_type, {})
    result = {}
    for key, value in props.items():
        if key in ("type", "nr"):
            continue  # Skip type and nr, handled separately
        # Skip auto-generated properties
        if key == "naam" and node_type == "Kring":
            continue  # Kring names are auto-generated
        if key in ("autonr", "autoKringNaam") and value == "auto":
            continue  # Skip auto values
        default_val = defaults.get(key)
        # Compare as strings since EDS often stores numbers as strings
        if str(value) != str(default_val) if default_val is not None else True:
            result[key] = value
    return result

def build_tree(data):
    """Convert flat EDS data to tree structure."""
    # Build id -> item lookup
    id_to_item = {item["id"]: item for item in data}

    # Build parent -> children lookup
    children_map = {}
    for item in data:
        parent = item["parent"]
        if parent not in children_map:
            children_map[parent] = []
        children_map[parent].append(item)

    # Sort children by their order in original data
    for parent in children_map:
        children_map[parent].sort(key=lambda x: data.index(x))

    # Track Kring names for comments
    kring_counter = [0]  # Use list to allow mutation in nested function
    current_kring_name = [None]

    def get_next_kring_name():
        name = ""
        n = kring_counter[0]
        while True:
            name = chr(ord('A') + n % 26) + name
            n = n // 26 - 1
            if n < 0:
                break
        kring_counter[0] += 1
        return name

    def build_node(item, child_nr=None, kring_name=None):
        props = item["props"]
        node_type = props["type"]

        # Track Kring names
        if node_type == "Kring":
            current_kring_name[0] = get_next_kring_name()

        # Strip default values
        non_default_props = strip_defaults(node_type, props)

        # Build children recursively
        children = []
        is_kring = node_type == "Kring"
        child_counter = 1
        for child in children_map.get(item["id"], []):
            if is_kring:
                children.append(build_node(child, child_nr=child_counter, kring_name=current_kring_name[0]))
                child_counter += 1
            else:
                children.append(build_node(child, kring_name=kring_name))

        # Build comment for auto-generated refs
        comment = None
        if node_type == "Kring" and current_kring_name[0]:
            comment = f"#{current_kring_name[0]}"
        elif kring_name and child_nr:
            comment = f"#{kring_name}.{child_nr}"

        # Build YAML node - put _comment first so it appears right after the type key
        result = {}
        if comment:
            result["_comment"] = comment
        if non_default_props:
            result.update(non_default_props)
        if children:
            result["children"] = children

        # Use type as key if we have props or children
        if result:
            return {node_type: result}
        else:
            return node_type  # Simple string form

    # Build roots (parent = 0)
    roots = []
    for item in children_map.get(0, []):
        roots.append(build_node(item))

    return roots

def build_id_to_ref(data):
    """Build mapping from element id to ref string (KringName.nr)."""
    id_to_ref = {}
    kring_counter = 0
    current_kring_name = None

    def get_next_kring_name():
        nonlocal kring_counter
        name = ""
        n = kring_counter
        while True:
            name = chr(ord('A') + n % 26) + name
            n = n // 26 - 1
            if n < 0:
                break
        kring_counter += 1
        return name

    for item in data:
        props = item["props"]
        node_type = props.get("type")

        if node_type == "Kring":
            current_kring_name = get_next_kring_name()

        if current_kring_name and props.get("nr"):
            ref = f"{current_kring_name}.{props['nr']}"
            id_to_ref[item["id"]] = ref

    return id_to_ref

def extract_image_from_svg(svg_text, output_dir, index):
    """Extract embedded image from SVG and save to file. Returns filename."""
    import re
    import base64

    # Look for embedded base64 image: data:image/png;base64,xxxxx
    match = re.search(r'data:image/(png|jpeg|jpg);base64,([A-Za-z0-9+/=]+)', svg_text)
    if not match:
        return None

    img_format = match.group(1)
    if img_format == 'jpeg':
        img_format = 'jpg'
    b64_data = match.group(2)

    filename = f"image_{index}.{img_format}"
    filepath = os.path.join(output_dir, filename)

    with open(filepath, 'wb') as f:
        f.write(base64.b64decode(b64_data))

    return filename

def build_sitplan_yaml(sitplanjson, id_to_ref, output_dir=None):
    """Convert sitplanjson to YAML sitplan format."""
    if not sitplanjson or not sitplanjson.get("elements"):
        return None

    defaults = sitplanjson.get("defaults", {})
    default_scale = defaults.get("scale", 0.7)
    default_rotate = defaults.get("rotate", 0)
    default_fontsize = defaults.get("fontsize", 10)

    # Use 'layers' to preserve order (images and elements interleaved)
    layers = []
    image_index = 0

    for elem in sitplanjson.get("elements", []):
        electro_id = elem.get("electroItemId")
        svg_data = elem.get("svg", "")

        if electro_id is None and svg_data:
            # This is an embedded image layer
            yaml_layer = {
                "pos": FlowList([round(elem["posx"], 1), round(elem["posy"], 1)]),
                "size": FlowList([elem.get("sizex", 0), elem.get("sizey", 0)])
            }

            # Extract and save image if output_dir provided
            if output_dir:
                filename = extract_image_from_svg(svg_data, output_dir, image_index)
                if filename:
                    yaml_layer["image"] = filename
                    image_index += 1
            else:
                # Keep inline SVG reference
                yaml_layer["svg_length"] = len(svg_data)  # For debugging

            if elem.get("scale", default_scale) != default_scale:
                yaml_layer["scale"] = elem["scale"]
            if elem.get("rotate", default_rotate) != default_rotate:
                yaml_layer["rotate"] = elem["rotate"]
            if elem.get("page", 1) != 1:
                yaml_layer["page"] = elem["page"]

            layers.append(yaml_layer)
        elif electro_id is not None:
            # This is an electrical element reference
            ref = id_to_ref.get(electro_id)

            yaml_layer = {
                "pos": FlowList([round(elem["posx"], 1), round(elem["posy"], 1)])
            }

            # Use human-readable ref if available, otherwise use internal id
            if ref:
                yaml_layer["ref"] = ref
            else:
                yaml_layer["id"] = electro_id

            # Only include non-default values
            if elem.get("page", 1) != 1:
                yaml_layer["page"] = elem["page"]
            if elem.get("scale") != default_scale:
                yaml_layer["scale"] = elem["scale"]
            if elem.get("rotate") != default_rotate:
                yaml_layer["rotate"] = elem["rotate"]
            if elem.get("color", "#000000") not in ("#000000", "black"):
                yaml_layer["color"] = elem["color"]

            layers.append(yaml_layer)

    if not layers:
        return None

    result = {
        "defaults": {
            "fontsize": default_fontsize,
            "scale": default_scale,
            "rotate": default_rotate
        },
        "layers": layers
    }

    return result

def eds_to_yaml_data(eds_path, output_dir=None):
    """Convert EDS file to YAML data structure.

    Args:
        eds_path: Path to EDS file
        output_dir: Directory to save extracted images (optional)
    """
    eds_json = eds_to_json(eds_path)

    # Build tree from data
    tree = build_tree(eds_json["data"])

    # Build properties
    props = eds_json.get("properties", {})
    properties = {}
    if props.get("owner"):
        properties["owner"] = props["owner"].replace("<br>", "\n")
    if props.get("installer"):
        properties["installer"] = props["installer"].replace("<br>", "\n")
    if props.get("control"):
        properties["control"] = props["control"].replace("<br>", "\n")
    if props.get("info") and props["info"] != "2 x 230V ~50 Hz":
        properties["info"] = props["info"].replace("<br>", "\n")

    # Build sitplan
    id_to_ref = build_id_to_ref(eds_json["data"])
    sitplan = build_sitplan_yaml(eds_json.get("sitplanjson"), id_to_ref, output_dir)

    # Build result with explicit ordering
    result = {}

    # Add metadata
    result["metadata"] = {
        "schema_version": SCHEMA_VERSION,
        "tool_version": TOOL_VERSION,
        "generated_at": datetime.now(timezone.utc).isoformat()
    }

    if properties:
        result["properties"] = properties
    if sitplan:
        result["sitplan"] = sitplan
    result["elements"] = tree

    return result

def add_yaml_comments(yaml_text):
    """Convert _comment fields to inline YAML comments."""
    import re
    lines = yaml_text.split('\n')
    result = []
    i = 0
    while i < len(lines):
        line = lines[i]
        # Check if next line is a _comment field
        if i + 1 < len(lines):
            next_line = lines[i + 1]
            comment_match = re.match(r'^(\s*)_comment:\s*["\']?(#[A-Z]+(?:\.\d+)?)["\']?\s*$', next_line)
            if comment_match:
                # Add comment to end of current line
                comment = comment_match.group(2)
                # Check if current line ends with `:` or is a type key
                if line.rstrip().endswith(':'):
                    result.append(f"{line} {comment}")
                else:
                    result.append(f"{line}  {comment}")
                i += 2  # Skip the _comment line
                continue
        result.append(line)
        i += 1
    return '\n'.join(result)

def eds_to_yaml(eds_path, yaml_path):
    """Convert EDS file to YAML file.

    Images are extracted to the same directory as the YAML file.
    """
    output_dir = os.path.dirname(os.path.abspath(yaml_path))
    data = eds_to_yaml_data(eds_path, output_dir)

    yaml_text = yaml.dump(data, allow_unicode=True, default_flow_style=False, sort_keys=False)
    yaml_text = add_yaml_comments(yaml_text)

    with open(yaml_path, "w", encoding="utf-8") as f:
        f.write(yaml_text)

    print(f"Converted {eds_path} -> {yaml_path}")

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python eds_to_yaml.py input.eds [output.yaml]")
        print("       If output.yaml is omitted, uses input name with .yaml extension")
        sys.exit(1)

    eds_path = sys.argv[1]
    if len(sys.argv) >= 3:
        yaml_path = sys.argv[2]
    else:
        yaml_path = eds_path.rsplit(".", 1)[0] + ".yaml"

    eds_to_yaml(eds_path, yaml_path)
