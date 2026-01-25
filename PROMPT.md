# Prompt: Create YAML Format Tools for Eendraadschema

Use this prompt with your AI assistant to create conversion tools between YAML and EDS formats for the Eendraadschema application.

---

## The Prompt

I need you to help me create a human-readable YAML format for "Eendraadschema" (single-line electrical diagrams), a Belgian/Dutch electrical schema application. The native EDS file format is compressed binary (zlib + base64), which is hard to edit, diff, or version control.

### Requirements

1. **Analyze the EDS format**: The EDS file structure is:
   - Header: `EDS0040000` followed by base64-encoded zlib-compressed JSON
   - The JSON contains a tree of electrical elements with parent-child relationships

2. **Create a YAML format** that:
   - Is human-readable and editable
   - Only requires non-default values to be specified (compact)
   - Supports hierarchical element structure via `children` key
   - Auto-generates circuit names (A, B, C, ... Z, AA, AB, ...)
   - Auto-numbers children within circuits (1, 2, 3, ...)
   - Includes document metadata (owner, installer, control authority)
   - Supports multi-page documents via `newPage: true`
   - Optionally includes sitplan (floor plan element positioning)

3. **Create conversion tools** in both Python and TypeScript:
   - `yaml2eds`: Convert YAML to EDS format
   - `eds2yaml`: Convert EDS to YAML format
   - Include a schema file defining element types and their default values

4. **Element types to support**:
   - Infrastructure: `Zekering/differentieel`, `Elektriciteitsmeter`, `Aansluiting`, `Bord`, `Kring`
   - Loads: `Contactdoos`, `Lichtcircuit`, `Lichtpunt`, `Schakelaars`, `Drukknop`
   - Appliances: `Motor`, `Wasmachine`, `Droogkast`, `Kookfornuis`, `Elektrische oven`, `Ketel`
   - Text: `Verbruiker`, `Vrije tekst`

5. **Add metadata** to generated YAML files:
   ```yaml
   metadata:
     schema_version: "1.0.0"
     tool_version: "1.0.0"
     generated_at: "ISO-8601 timestamp"
   ```

### Example YAML Structure

```yaml
properties:
  owner: |
    Owner Name
    Street Address
    City
  installer: Electrician Name
  control: Certification Authority

elements:
- Zekering/differentieel:
    amperage: '63'
    kortsluitvermogen: '10'

- Elektriciteitsmeter:
    children:
    - Zekering/differentieel:
        bescherming: differentieelautomaat
        amperage: '40'
        differentieel_delta_amperage: '30'
        children:
        - Aansluiting:
            children:
            - Bord:
                children:
                - Kring:
                    amperage: '20'
                    type_kabel: VOB 3G2,5
                    tekst: Kitchen
                    children:
                    - Contactdoos: {aantal: '3'}
                    - Contactdoos: {aantal: '2'}

                - Kring:
                    children:
                    - Lichtcircuit: {aantal_schakelaars: '2'}
                    - Schakelaars:
                        children:
                        - Lichtpunt: {aantal: '6', type_lamp: spot}

# Page 2
- Aansluiting:
    newPage: true
    children:
    - Bord:
        children:
        - Kring:
            amperage: '20'
            type_kabel: VOB 3G2,5
            children:
            - Contactdoos:
                children:
                - Wasmachine
```

### Key Properties Reference

**Kring (Circuit)**:
- `amperage`: '16', '20', '32' (default: '16')
- `type_kabel`: 'VOB 3G1,5', 'VOB 3G2,5', 'VOB 3G6', 'XVB CCa 3G1,5'
- `kabel_locatie`: 'standaard', 'In wand', 'Op wand'
- `tekst`: Circuit description

**Zekering/differentieel (Breaker)**:
- `bescherming`: 'geen', 'automatisch', 'differentieelautomaat'
- `amperage`: Current rating
- `differentieel_delta_amperage`: '30', '300' (mA)
- `kortsluitvermogen`: Short-circuit capacity (kA)

**Contactdoos (Socket)**:
- `aantal`: Number of sockets
- `is_halfwaterdicht`: true/false (splash-proof)

**Lichtcircuit / Schakelaars**:
- `aantal_schakelaars`: '1', '2', '3' (for multi-way switching)
- `type_schakelaar`: 'enkelpolig', 'tweepools', 'teleruptor'

**Lichtpunt (Light)**:
- `aantal`: Number of fixtures
- `type_lamp`: 'standaard', 'TL', 'spot', 'LED'

### Deliverables

1. **Documentation**: README.md with format specification and CLI usage
2. **Python tools**: convert.py, eds_to_yaml.py, eds_codec.py, schema.yaml
3. **TypeScript tools**: Full npm package with CLI
4. **Example file**: Comprehensive multi-page example demonstrating all element types

### Testing

After creating the tools, verify round-trip conversion:
1. Convert a YAML file to EDS
2. Convert that EDS back to YAML
3. Convert that YAML to EDS again
4. Compare: the two YAML files should be identical (except timestamps)

---

## Tips for Your AI Assistant

- Start by asking for a sample EDS file to analyze the JSON structure
- Extract default values by examining multiple EDS files
- The element hierarchy uses `parent` IDs in the flat JSON; convert to nested `children` in YAML
- Circuit names (Kring) are auto-generated alphabetically, don't store them
- Child numbering within Kring is auto-generated, don't store it
- Strip default values when converting EDS to YAML (keeps files compact)
- Apply defaults when converting YAML to EDS

---

## Expected Directory Structure

```
electric/
├── README.md              # Format specification & CLI docs
├── PROMPT.md              # This file
├── tools/                 # Python implementation
│   ├── schema.yaml        # Element defaults
│   ├── convert.py         # YAML → EDS
│   ├── eds_to_yaml.py     # EDS → YAML
│   └── eds_codec.py       # EDS encode/decode
├── tools-ts/              # TypeScript implementation
│   ├── package.json
│   ├── tsconfig.json
│   └── src/
│       ├── cli.ts
│       ├── convert.ts
│       ├── eds-to-yaml.ts
│       ├── eds-codec.ts
│       ├── schema.ts
│       └── index.ts
└── yaml/
    └── example.yaml       # Comprehensive example
```
