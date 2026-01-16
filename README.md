# Eendraadschema YAML Format Specification

A human-readable YAML format for defining single-line electrical diagrams, convertible to/from the native EDS format.

## Rationale

This YAML format provides:

- **Human readability** - Clear hierarchical structure mirrors the electrical installation
- **Version control friendly** - Plain text enables meaningful diffs
- **Reduced verbosity** - Only non-default values need specification
- **Programmatic generation** - Easy to generate from other tools

## Document Structure

```yaml
metadata:      # Conversion info (auto-generated)
properties:    # Document metadata (optional)
sitplan:       # Site plan diagram (optional)
elements:      # Electrical element tree (required)
```

### Metadata (auto-generated)

When converting from EDS to YAML, metadata is added automatically:

```yaml
metadata:
  schema_version: "1.0.0"   # Version of element defaults used
  tool_version: "1.0.0"     # Converter tool version
  generated_at: "2026-01-16T12:00:00.000Z"
```

This enables tracking of which schema version was used and when the file was generated.

### Properties

```yaml
properties:
  owner: |
    Owner Name
    Street Address
    Postal Code City
  installer: Electrician Name
  control: Certification Authority
  info: 2 x 230V ~50 Hz
```

### Elements

Elements support multiple syntax forms:

```yaml
# Simple (all defaults)
- Contactdoos

# Inline properties
- Contactdoos: {aantal: '2', is_geaard: true}

# With children
- Kring:
    amperage: '20'
    type_kabel: VOB 3G2,5
    children:
    - Contactdoos: {aantal: '2'}
    - Contactdoos
```

**Automatic features:**
- Kring names auto-generated: A, B, C, ... Z, AA, AB...
- Children within Kring auto-numbered: 1, 2, 3...
- Default values applied automatically

## Element Types

### Infrastructure

| Type | Key Properties |
|------|----------------|
| `Zekering/differentieel` | `amperage`, `bescherming` (automatisch/differentieelautomaat), `kortsluitvermogen`, `differentieel_delta_amperage` |
| `Elektriciteitsmeter` | `adres` |
| `Aansluiting` | `newPage` (true for page break), `amperage` |
| `Bord` | `naam`, `is_geaard` |
| `Kring` | `amperage`, `type_kabel`, `kabel_locatie`, `tekst` |

### Loads

| Type | Key Properties |
|------|----------------|
| `Contactdoos` | `aantal`, `is_geaard`, `is_halfwaterdicht` |
| `Lichtcircuit` | `aantal_schakelaars`, `type_schakelaar`, `aantal_lichtpunten` |
| `Lichtpunt` | `aantal`, `type_lamp` (standaard/TL/spot/LED) |
| `Schakelaars` | `aantal_schakelaars`, `type_schakelaar` (enkelpolig/tweepools/teleruptor) |
| `Drukknop` | `aantal` |

### Appliances

| Type | Key Properties |
|------|----------------|
| `Motor` | `adres` |
| `Wasmachine` | `adres` |
| `Droogkast` | `adres` |
| `Kookfornuis` | `adres` |
| `Elektrische oven` | `adres` |
| `Ketel` | `ketel_type`, `energiebron`, `warmte_functie` |

### Text

| Type | Key Properties |
|------|----------------|
| `Verbruiker` | `tekst`, `adres` |
| `Vrije tekst` | `tekst`, `vrije_tekst_type` |

## Common Values

**Cable types:** `VOB 3G1,5`, `VOB 3G2,5`, `VOB 3G6`, `XVB CCa 3G1,5`

**Cable location:** `standaard`, `In wand`, `Op wand`

**Protection:** `geen`, `automatisch`, `differentieelautomaat`

## Multi-Page Documents

Use `newPage: true` on `Aansluiting`:

```yaml
elements:
- Zekering/differentieel:
    children:
    - Aansluiting:
        children:
        - Bord:
            children:
            - Kring: ...  # Page 1

- Aansluiting:
    newPage: true
    children:
    - Bord:
        children:
        - Kring: ...  # Page 2
```

## Sitplan (Optional)

```yaml
sitplan:
  defaults:
    fontsize: 10
    scale: 0.25
  layers:
  - pos: [59.4, 94.7]
    ref: "A.1"          # KringName.ChildNumber
  - pos: [50, 50]
    image: floorplan.png
    size: [400, 300]
```

## Complete Example

```yaml
properties:
  owner: John Doe
  installer: Licensed Electrician
  info: 2 x 230V ~50 Hz

elements:
- Zekering/differentieel:
    amperage: '63'
    kortsluitvermogen: '15'

- Elektriciteitsmeter:
    children:
    - Zekering/differentieel:
        bescherming: differentieelautomaat
        differentieel_delta_amperage: '30'
        children:
        - Aansluiting:
            children:
            - Bord:
                children:
                - Kring:  # Circuit A - Kitchen
                    amperage: '20'
                    type_kabel: VOB 3G2,5
                    tekst: Kitchen
                    children:
                    - Contactdoos: {aantal: '3'}
                    - Contactdoos: {aantal: '2'}

                - Kring:  # Circuit B - Lighting
                    children:
                    - Lichtcircuit: {aantal_schakelaars: '2'}
                    - Schakelaars:
                        children:
                        - Lichtpunt: {aantal: '6', type_lamp: spot}

                - Kring:  # Circuit C - Washing machine
                    amperage: '20'
                    type_kabel: VOB 3G2,5
                    children:
                    - Contactdoos:
                        children:
                        - Wasmachine
```

---

# CLI Tools

## Python

Located in `tools/`:

```bash
cd tools

# YAML to EDS
python convert.py ../yaml/input.yaml [output.eds]

# EDS to YAML
python eds_to_yaml.py ../eds/input.eds [output.yaml]
```

## TypeScript/Node.js

Located in `tools-ts/`:

### Setup

```bash
cd tools-ts
npm install
```

### Development (no build)

```bash
npx tsx src/cli.ts yaml2eds ../yaml/input.yaml [output.eds]
npx tsx src/cli.ts eds2yaml ../eds/input.eds [output.yaml]
```

### Production (built)

```bash
npm run build
node dist/cli.js yaml2eds ../yaml/input.yaml
node dist/cli.js eds2yaml ../eds/input.eds
```

### As Library

```typescript
import { yamlToEds, edsToYaml } from 'eendraadschema-tools';

yamlToEds('input.yaml', 'output.eds');
edsToYaml('input.eds', 'output.yaml');
```

## Directory Structure

```
electric/
├── README.md           # This file
├── tools/              # Python scripts
│   ├── schema.yaml     # Element type defaults
│   ├── convert.py      # YAML to EDS
│   ├── eds_to_yaml.py  # EDS to YAML
│   └── eds_codec.py    # EDS file encoding
├── tools-ts/           # TypeScript version
│   ├── src/
│   └── package.json
├── yaml/               # Example YAML files
│   ├── new.yaml
│   └── new2.yaml
└── eds/                # Example EDS files
```
