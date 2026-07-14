#!/usr/bin/env python3
"""
fix_consist_counts.py

Priority for each consist ingredient count:
  1. Explicit count in product NAME (variant title like "12 Stems", "24 Roses")
  2. Explicit count in product DESCRIPTION - variant-specific section first (STANDARD/DELUXE),
     then full description fallback
  3. Vision count (already in XML as "stems count")
  4. Estimated default (already in XML as "stems count atleast")

Handles patterns:
  - "x5 Roses", "x5 Pink Roses", "x5 Emerald Green Hydrangeas"
  - "5 Roses", "5 pink roses"
  - "Roses x 5", "Roses 5"
  - STANDARD: ... | DELUXE: ... sections matched by variant name
"""

import re, os
import xml.etree.ElementTree as ET

XML_PATH = os.path.join(os.path.dirname(__file__), "data", "flowwow.xml")
MAX_COUNT = 200

SYNONYMS = {
    "roses": "Rose", "rose": "Rose",
    "peonies": "Peony", "peony": "Peony",
    "tulips": "Tulip", "tulip": "Tulip",
    "hydrangeas": "Hydrangea", "hydrangea": "Hydrangea",
    "lilies": "Lily", "lily": "Lily",
    "sunflowers": "Sunflower", "sunflower": "Sunflower",
    "orchids": "Orchid", "orchid": "Orchid",
    "dahlias": "Dahlia", "dahlia": "Dahlia",
    "carnations": "Carnation", "carnation": "Carnation",
    "chrysanthemums": "Chrysanthemum", "chrysanthemum": "Chrysanthemum",
    "delphiniums": "Delphinium", "delphinium": "Delphinium",
    "lisianthus": "Lisianthus",
    "stocks": "Stock", "stock": "Stock",
    "snapdragons": "Snapdragons", "snapdragon": "Snapdragons",
    "alstroemeria": "Alstroemeria", "alstroemerias": "Alstroemeria",
    "freesias": "Freesia", "freesia": "Freesia",
    "anthuriums": "Anthurium", "anthurium": "Anthurium",
    "gerberas": "Gerbera", "gerbera": "Gerbera",
    "lavender": "Lavender",
    "eucalyptus": "Eucalyptus",
    "gypsophila": "Gypsophila",
    "waxflower": "Waxflower", "waxflowers": "Waxflower",
    "wax": "Waxflower",
    "trachelium": "Trachelium",
    "bouvardia": "Bouvardia",
    "hypericum": "Hypericum",
    "limonium": "Limonium",
    "statice": "Limonium",
    "eustoma": "Eustoma",
    "mimosa": "Mimosa",
    "foliage": "Foliage",
    "greenery": "Foliage",
    "ruscus": "Foliage",
    "greenbell": "Foliage",
    "green bell": "Foliage",
    "berry": "Berry", "berries": "Berry",
    "thistle": "Thistle",
    "geranium": "Geranium",
    "astrantia": "Astrantia",
    "dianthus": "Carnation",
    "tuberoses": "Tuberoses", "tuberose": "Tuberoses",
    "limoniums": "Limonium",
    "hypericons": "Hypericum",
}


def normalise(word):
    w = word.lower().strip(" ,.|:;()-'\"")
    return SYNONYMS.get(w)


def fuzzy_match(word, consist_names):
    canon = normalise(word)
    # Direct canonical hit
    if canon and canon in consist_names:
        return canon
    # Reverse canonical: "carnation" → "Carnation" canonical, consist may be "Dianthus"
    if canon:
        for cname in consist_names:
            if SYNONYMS.get(cname.lower()) == canon:
                return cname
    # Prefix fuzzy match
    w = word.lower().strip(" ,.|:;()-'\"")
    for name in consist_names:
        if len(w) >= 5 and name.lower().startswith(w[:5]):
            return name
        if len(w) >= 5 and w.startswith(name.lower()[:5]):
            return name
    return None


def extract_variant_section(desc, variant_name):
    """
    If description contains STANDARD: / DELUXE: sections, return the
    section that matches the variant name. Falls back to full desc.
    """
    name_lower = variant_name.lower()

    # Determine which section to look for
    if "standard" in name_lower:
        target = "standard"
    elif "deluxe" in name_lower:
        target = "deluxe"
    else:
        return desc   # no variant section known

    # Split on STANDARD: or DELUXE: markers
    pattern = re.compile(r'(STANDARD|DELUXE)\s*:', re.IGNORECASE)
    parts = pattern.split(desc)
    # parts = [before, 'STANDARD', content, 'DELUXE', content, ...]

    sections = {}
    i = 1
    while i < len(parts) - 1:
        key = parts[i].lower()
        content = parts[i + 1]
        sections[key] = content
        i += 2

    if target in sections:
        return sections[target]
    return desc


def parse_counts_from_text(text, consist_names):
    """
    Extract {ingredient: count} from a block of text.
    Handles:
      - xN word / x N word  (e.g. x5 Roses, x 5 Pink Roses)
      - N word              (e.g. 5 Roses, 5 Pink Roses)
      - word x N / word N  (e.g. Roses x 5)
      - ranges like x3-5 → use lower bound
    """
    counts = {}
    if not text:
        return counts

    segments = re.split(r'[|,\n]+', text)

    for seg in segments:
        seg = seg.strip()
        if not seg:
            continue

        # Pattern A: x<N> or x <N> followed by optional descriptors then flower
        # Also handles N x word (e.g. "5 x Pink Floyd roses", "7x burgandy carnation")
        # Matches: x5 Roses, x5 Pink Roses, 5 x Pink Floyd roses, 7x carnation
        for m in re.finditer(
            r'(?:x\s*(\d+)|(\d+)\s*x)\s*(?:-\d+)?\s+'  # x5 or 5x or 5 x
            r'(?:\w+\s+){0,3}'                           # up to 3 descriptor words
            r'(\w+)',                                     # flower name
            seg, re.IGNORECASE
        ):
            n = int(m.group(1) or m.group(2))
            word = m.group(3)
            if 0 < n <= MAX_COUNT and "/" not in word:
                match = fuzzy_match(word, consist_names)
                if match and match not in counts:
                    counts[match] = n

        # Same pattern without x (pure xN)
        for m in re.finditer(
            r'x\s*(\d+)(?:-\d+)?\s+'           # x5 or x5-7
            r'(?:\w+\s+){0,3}'                  # up to 3 descriptor words
            r'(\w+)',                            # flower name
            seg, re.IGNORECASE
        ):
            n = int(m.group(1))
            word = m.group(2)
            if 0 < n <= MAX_COUNT and "/" not in word:
                match = fuzzy_match(word, consist_names)
                if match and match not in counts:
                    counts[match] = n

        # Pattern B: N followed by optional descriptors then flower
        # Matches: 5 pink roses, 10 red african roses
        for m in re.finditer(
            r'\b(\d+)\s+'
            r'(?:\w+\s+){0,2}'
            r'(\w+)',
            seg, re.IGNORECASE
        ):
            n = int(m.group(1))
            word = m.group(2)
            if 0 < n <= MAX_COUNT and "/" not in word:
                match = fuzzy_match(word, consist_names)
                if match and match not in counts:
                    counts[match] = n

        # Pattern C: flower x N or flower N at end
        for m in re.finditer(r'(\w+)\s+x?\s*(\d+)\b', seg, re.IGNORECASE):
            word = m.group(1)
            n = int(m.group(2))
            if 0 < n <= MAX_COUNT and "/" not in word:
                match = fuzzy_match(word, consist_names)
                if match and match not in counts:
                    counts[match] = n

    return counts


def counts_from_name(name, consist_names):
    """
    Extract counts from the variant portion of the product name.
    - "Pink Roses - 12 Stems"       → {Rose: 12}  (single consist only)
    - "Pink Roses - 24 Roses"       → {Rose: 24}
    - "Roses - 36 Stems"            → {Rose: 36}
    """
    counts = {}
    parts = name.rsplit(" - ", 1)
    if len(parts) < 2:
        return counts
    variant = parts[1].strip()

    # "N Stems" → assign to single ingredient only
    m = re.match(r'^(\d+)\s+stems?$', variant, re.IGNORECASE)
    if m:
        n = int(m.group(1))
        if 0 < n <= MAX_COUNT and len(consist_names) == 1:
            counts[list(consist_names)[0]] = n
        return counts

    # "N FlowerWord" e.g. "12 Roses", "24 Pink Roses"
    m2 = re.match(r'^(\d+)\s+(?:\w+\s+){0,2}(\w+)$', variant, re.IGNORECASE)
    if m2:
        n = int(m2.group(1))
        word = m2.group(2)
        if 0 < n <= MAX_COUNT:
            match = fuzzy_match(word, consist_names)
            if match:
                counts[match] = n

    return counts


def main():
    tree = ET.parse(XML_PATH)
    root = tree.getroot()
    offers = root.findall(".//offer")

    updated_from_name = 0
    updated_from_desc = 0
    kept_vision       = 0
    kept_atleast      = 0

    for o in offers:
        name_el = o.find("name")
        desc_el = o.find("description")
        name = (name_el.text or "") if name_el is not None else ""
        desc = (desc_el.text or "") if desc_el is not None else ""

        consists = o.findall("consist")
        if not consists:
            continue

        consist_names = {c.get("name", "") for c in consists}

        # Parse name
        name_counts = counts_from_name(name, consist_names)

        # Parse description — variant section first, then full desc fallback
        variant_section = extract_variant_section(desc, name)
        desc_counts = parse_counts_from_text(variant_section, consist_names)
        # Fill in any misses from full description
        full_desc_counts = parse_counts_from_text(desc, consist_names)
        for k, v in full_desc_counts.items():
            if k not in desc_counts:
                desc_counts[k] = v

        for c in consists:
            ing  = c.get("name", "")
            unit = c.get("unit", "")

            # Priority 1: name
            if ing in name_counts:
                new = name_counts[ing]
                if str(new) != c.text or unit != "stems count":
                    c.text = str(new)
                    c.set("unit", "stems count")
                    updated_from_name += 1
                else:
                    kept_vision += 1
                continue

            # Priority 2: description
            if ing in desc_counts:
                new = desc_counts[ing]
                if str(new) != c.text or unit != "stems count":
                    c.text = str(new)
                    c.set("unit", "stems count")
                    updated_from_desc += 1
                else:
                    kept_vision += 1
                continue

            # Priority 3 & 4: keep existing
            if unit == "stems count atleast":
                kept_atleast += 1
            else:
                kept_vision += 1

    total = updated_from_name + updated_from_desc + kept_vision + kept_atleast
    print(f"Updated from name        : {updated_from_name}")
    print(f"Updated from description : {updated_from_desc}")
    print(f"Kept vision count        : {kept_vision}")
    print(f"Kept atleast estimate    : {kept_atleast}")
    print(f"Total consists           : {total}")

    ET.indent(root, space="  ")
    tree.write(XML_PATH, encoding="utf-8", xml_declaration=True)
    print(f"\nSaved to {XML_PATH}")


if __name__ == "__main__":
    main()
