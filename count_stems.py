#!/usr/bin/env python3
"""
count_stems.py
Uses Claude vision to count flower stems in product images and updates data/flowwow.xml.

Usage:
    ANTHROPIC_API_KEY=sk-ant-... python3 count_stems.py

Progress is saved to stem_count_progress.json after every product.
The script can be stopped and re-run — it resumes where it left off.
"""

import os, re, json, time, base64, ssl, csv, urllib.request
import xml.etree.ElementTree as ET
import anthropic

XML_PATH   = os.path.join(os.path.dirname(__file__), "data", "flowwow.xml")
PROGRESS   = os.path.join(os.path.dirname(__file__), "stem_count_progress.json")
CSV_PATH   = os.path.join(os.path.dirname(__file__), "stem_counts.csv")
MODEL      = "claude-haiku-4-5-20251001"
DELAY      = 1.5   # seconds between API calls

# SSL context that works with Shopify CDN on macOS
SSL_CTX = ssl.create_default_context()
SSL_CTX.check_hostname = False
SSL_CTX.verify_mode = ssl.CERT_NONE
MAX_STEMS  = 200   # sanity cap — nothing has >200 of one flower type

def download_image(url):
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=15, context=SSL_CTX) as r:
        return base64.standard_b64encode(r.read()).decode("utf-8")

def media_type(url):
    u = url.lower()
    if ".png" in u:  return "image/png"
    if ".webp" in u: return "image/webp"
    if ".gif" in u:  return "image/gif"
    return "image/jpeg"

def ask_claude(client, image_b64, mime, ingredients):
    ing_list = ", ".join(ingredients)
    prompt = (
        f"This is a product photo of a flower arrangement or floral gift.\n"
        f"Count the visible stems/heads of each: {ing_list}\n"
        f"Include flowers that are partially hidden behind others.\n"
        f"Reply ONLY in JSON: {{\"Rose\": 12, \"Hydrangea\": 3}}\n"
        f"Only include the ingredients I listed. Use your best estimate."
    )
    msg = client.messages.create(
        model=MODEL,
        max_tokens=256,
        messages=[{
            "role": "user",
            "content": [
                {"type": "image", "source": {"type": "base64", "media_type": mime, "data": image_b64}},
                {"type": "text",  "text": prompt}
            ]
        }]
    )
    return msg.content[0].text

def parse_counts(text, ingredients):
    m = re.search(r'\{[^}]+\}', text, re.DOTALL)
    if not m:
        return {}
    try:
        raw = json.loads(m.group())
    except Exception:
        return {}
    result = {}
    for ing in ingredients:
        for key, val in raw.items():
            if key.lower() == ing.lower() or ing.lower() in key.lower() or key.lower() in ing.lower():
                if isinstance(val, (int, float)) and 0 < int(val) <= MAX_STEMS:
                    result[ing] = int(val)
                break
    return result

def main():
    api_key = os.environ.get("ANTHROPIC_API_KEY", "")
    if not api_key:
        print("ERROR: Set ANTHROPIC_API_KEY environment variable first.")
        print("  Example: ANTHROPIC_API_KEY=sk-ant-... python3 count_stems.py")
        return

    client = anthropic.Anthropic(api_key=api_key)

    # Load progress
    progress = {}
    if os.path.exists(PROGRESS):
        with open(PROGRESS) as f:
            progress = json.load(f)
        print(f"Resuming — {len(progress)} already done.")

    # Parse XML
    tree = ET.parse(XML_PATH)
    root = tree.getroot()
    offers = root.findall(".//offer")

    # Build work list: unique (image_url, ingredients_tuple) → list of offer elements
    image_groups = {}
    for o in offers:
        consists = o.findall("consist")
        atleast = [c for c in consists if c.get("unit") == "stems count atleast"]
        if not atleast: continue
        pic = o.find("picture")
        if pic is None or not pic.text: continue
        ings = tuple(sorted(c.get("name", "") for c in atleast))
        key  = (pic.text, ings)
        image_groups.setdefault(key, []).append(o)

    todo = [(k, v) for k, v in image_groups.items() if json.dumps(k) not in progress]
    total = len(image_groups)
    done  = total - len(todo)

    print(f"\nTotal unique image+ingredient combos : {total}")
    print(f"Already processed                    : {done}")
    print(f"Remaining                            : {len(todo)}")
    print(f"Estimated time                       : ~{round(len(todo)*DELAY/60, 1)} minutes\n")

    updated_exact = 0
    errors        = 0

    for idx, ((img_url, ings), offer_list) in enumerate(todo, 1):
        name = (offer_list[0].find("name").text or "") if offer_list[0].find("name") is not None else ""
        pkey = json.dumps((img_url, list(ings)))
        print(f"[{idx+done}/{total}] {name[:55]}")
        print(f"  Counting: {list(ings)}")

        # Download image
        try:
            img_b64 = download_image(img_url)
        except Exception as e:
            print(f"  ❌ Download failed: {e}")
            progress[pkey] = {"error": f"download: {e}"}
            errors += 1
            _save_progress(progress)
            continue

        # Ask Claude
        try:
            raw_response = ask_claude(client, img_b64, media_type(img_url), list(ings))
            print(f"  Claude: {raw_response.strip()}")
        except Exception as e:
            print(f"  ❌ API error: {e}")
            progress[pkey] = {"error": f"api: {e}"}
            errors += 1
            _save_progress(progress)
            time.sleep(DELAY)
            continue

        counts = parse_counts(raw_response, list(ings))
        progress[pkey] = {"counts": counts, "ok": True}

        # Apply counts to ALL offers sharing this image+ingredients
        for o in offer_list:
            for c in o.findall("consist"):
                if c.get("unit") != "stems count atleast":
                    continue
                ing = c.get("name", "")
                if ing in counts:
                    c.set("unit", "stems count")
                    c.text = str(counts[ing])
                    updated_exact += 1
                    print(f"  ✅ {ing} → {counts[ing]} stems count")
                else:
                    print(f"  ➖ {ing} → not found in response, keeping atleast")

        _save_progress(progress)

        # Save XML checkpoint every 50 calls
        if idx % 50 == 0:
            _write_xml(tree, root, XML_PATH)
            print(f"  💾 XML checkpoint saved ({idx+done}/{total} done)")

        time.sleep(DELAY)

    # Final XML write
    _write_xml(tree, root, XML_PATH)

    # Summary
    atleast_remaining = sum(
        1 for o in root.findall(".//offer")
        for c in o.findall("consist")
        if c.get("unit") == "stems count atleast"
    )
    exact_total = sum(
        1 for o in root.findall(".//offer")
        for c in o.findall("consist")
        if c.get("unit") == "stems count"
    )

    print(f"\n{'='*60}")
    print(f"Done!")
    print(f"  ✅ Total exact counts in file   : {exact_total}")
    print(f"  ➖ Still atleast (vision missed) : {atleast_remaining}")
    print(f"  ❌ Errors this run               : {errors}")
    # Write CSV with all counts
    _write_csv(root)
    print(f"\nUpdated XML saved to  : {XML_PATH}")
    print(f"Stem counts CSV saved : {CSV_PATH}")
    print(f"Progress log saved to : {PROGRESS}")

def _save_progress(progress):
    with open(PROGRESS, "w") as f:
        json.dump(progress, f, indent=2)

def _write_xml(tree, root, path):
    ET.indent(root, space="  ")
    tree.write(path, encoding="utf-8", xml_declaration=True)

def _write_csv(root):
    rows = []
    for o in root.findall(".//offer"):
        offer_id = o.get("id", "")
        name_el  = o.find("name")
        name     = (name_el.text or "") if name_el is not None else ""
        cat_el   = o.find("categoryId")
        cat      = (cat_el.text or "") if cat_el is not None else ""
        for c in o.findall("consist"):
            rows.append({
                "offer_id":   offer_id,
                "product":    name,
                "category":   cat,
                "ingredient": c.get("name", ""),
                "count":      c.text or "1",
                "type":       c.get("unit", ""),
            })
    with open(CSV_PATH, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=["offer_id","product","category","ingredient","count","type"])
        writer.writeheader()
        writer.writerows(rows)
    print(f"  {len(rows)} rows written to CSV.")

if __name__ == "__main__":
    main()
