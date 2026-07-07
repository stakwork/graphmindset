import json

# Injected vars: text_candidates, seed_ref_id

def _parse_list(val):
    """Parse input to a list, handling JSON strings and None gracefully."""
    if val is None:
        return []
    if isinstance(val, list):
        return val
    if isinstance(val, str):
        stripped = val.strip()
        if not stripped or stripped in ('null', 'None', '[]', ''):
            return []
        try:
            parsed = json.loads(stripped)
            return parsed if isinstance(parsed, list) else []
        except (ValueError, TypeError):
            return []
    return []

text_list = _parse_list(text_candidates)

seed = str(seed_ref_id).strip() if seed_ref_id else ''

# Deduplicate by ref_id, excluding the seed node itself
seen_refs = set()
merged = []
for item in text_list:
    if not isinstance(item, dict):
        continue
    ref = str(item.get('ref_id', '')).strip()
    if not ref or ref == seed or ref in seen_refs:
        continue
    seen_refs.add(ref)
    merged.append(item)

print("merged_candidates: {}".format(json.dumps(merged)))
