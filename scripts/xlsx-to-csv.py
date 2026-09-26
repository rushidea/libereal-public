#!/usr/bin/env python3
"""Convert Biosharp xlsx → CSV (called by TS import scripts)."""
import sys
import pandas as pd

xlsx = sys.argv[1]
csv_out = sys.argv[2]
# arg may contain spaces; glob expand
import glob
candidates = glob.glob(xlsx) if '*' in xlsx else [xlsx]
if not candidates or not __import__('os').path.exists(candidates[0]):
    # try matching the prefix in Desktop
    import os
    desktop = os.path.expanduser('~/Desktop')
    matches = [f for f in os.listdir(desktop) if f.startswith(os.path.basename(xlsx))]
    if matches:
        xlsx = os.path.join(desktop, matches[0])
    else:
        xlsx = candidates[0]
else:
    xlsx = candidates[0]
print(f'Reading: {xlsx}', file=sys.stderr)
df = pd.read_excel(xlsx, engine='openpyxl')
df = df.fillna('')
df.to_csv(csv_out, index=False, encoding='utf-8')
print(len(df))
