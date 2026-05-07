"""
Repair adequacy-scores JSON where the judge produced unescaped double quotes
inside notes fields.

Strategy: for each field value in the JSON, find unescaped quotes that appear
mid-string (not terminating the string) and escape them. Uses a line-based
heuristic: in the judge's output, each JSON field is on its own line, so a
value ends at the last `"` before a `,` or `}` at line-end.
"""

import json
import re
import sys
from pathlib import Path

def repair_line(line: str) -> str:
    """
    A line like:
      "notes": "text with "inner" quotes and more",
    becomes:
      "notes": "text with \"inner\" quotes and more",

    We find the colon-space-quote pattern at start, and the closing quote
    before `,`/`}` at end, and escape all quotes between.
    """
    # Match: optional whitespace, "key": "value",
    m = re.match(r'^(\s*"[^"]+"\s*:\s*)"(.*)"(\s*[,}\]]?\s*)$', line)
    if not m:
        return line
    prefix, value, suffix = m.group(1), m.group(2), m.group(3)
    # Escape any unescaped quotes in value
    # A quote is already escaped if preceded by an odd number of backslashes
    fixed = []
    i = 0
    while i < len(value):
        c = value[i]
        if c == '"':
            # Count preceding backslashes
            j = i - 1
            bs = 0
            while j >= 0 and value[j] == '\\':
                bs += 1
                j -= 1
            if bs % 2 == 0:
                fixed.append('\\"')
            else:
                fixed.append('"')
        else:
            fixed.append(c)
        i += 1
    return f'{prefix}"{"".join(fixed)}"{suffix}'


def extract_json_content(raw: str) -> str:
    """Extract JSON content, handling preamble and ```json fences."""
    # Find the start of the JSON array or object — look for ```json fence first
    fence_start = raw.find('```json')
    if fence_start >= 0:
        s = raw[fence_start + len('```json'):]
        # Find closing fence
        end = s.find('```')
        if end >= 0:
            s = s[:end]
        return s.strip()
    # Fall back to finding first [ or {
    for ch in '[{':
        idx = raw.find(ch)
        if idx >= 0:
            return raw[idx:].rstrip().rstrip('`').rstrip()
    return raw.strip()


def truncate_to_last_complete_object(s: str) -> str:
    """If the JSON is truncated mid-object, find the last complete one and close the array."""
    # Walk backward looking for a `},` followed by either whitespace and `{` or no more content
    # Find all top-level `},` boundaries (we're inside an array of objects)
    depth = 0
    in_string = False
    escape = False
    last_complete_end = -1
    for i, ch in enumerate(s):
        if escape:
            escape = False
            continue
        if ch == '\\':
            escape = True
            continue
        if ch == '"':
            in_string = not in_string
            continue
        if in_string:
            continue
        if ch in '{[':
            depth += 1
        elif ch in '}]':
            depth -= 1
            if depth == 1:  # back to inside the outer array
                # We just closed a top-level object inside the array
                last_complete_end = i + 1
        elif depth == 0:
            # We finished the outer container — already complete
            return s
    if last_complete_end > 0:
        return s[:last_complete_end] + '\n]'
    return s


def repair_json(raw: str):
    content = extract_json_content(raw)
    # First, try parsing as-is
    try:
        return json.loads(content)
    except json.JSONDecodeError:
        pass

    # Line-by-line repair (escape unescaped quotes in string values)
    lines = content.split('\n')
    repaired = [repair_line(ln) for ln in lines]
    fixed_content = '\n'.join(repaired)
    try:
        return json.loads(fixed_content)
    except json.JSONDecodeError:
        pass

    # Truncation repair — drop the incomplete trailing object and close the array
    truncated = truncate_to_last_complete_object(fixed_content)
    return json.loads(truncated)


def main():
    path = Path(sys.argv[1])
    data = json.loads(path.read_text())

    recovered_reps = []
    for rep in data.get('scores', []):
        if rep.get('scores'):
            recovered_reps.append(rep)
            continue
        raw = rep.get('raw', '')
        if not raw:
            recovered_reps.append(rep)
            continue
        try:
            parsed = repair_json(raw)
            print(f"Rep {rep['replicate']}: repaired — {len(parsed)} session scores")
            recovered_reps.append({
                'replicate': rep['replicate'],
                'scores': parsed,
                'repaired': True,
            })
        except Exception as e:
            print(f"Rep {rep['replicate']}: repair failed — {e}")
            recovered_reps.append(rep)

    data['scores'] = recovered_reps
    path.write_text(json.dumps(data, indent=2))
    valid = sum(1 for r in recovered_reps if r.get('scores'))
    print(f"\nSaved: {valid}/{len(recovered_reps)} valid reps in {path}")


if __name__ == '__main__':
    main()
