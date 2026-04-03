#!/usr/bin/env python3
"""
Paper build pipeline for Still Alive.

Usage:
  python paper/build.py                      # full build
  python paper/build.py --charts-only        # regenerate charts only
  python paper/build.py --pdf-only           # reassemble PDF only (no chart regen)

Reads: sections/*.md, results/*.json
Writes: paper/figures/*.pdf, paper/output/still-alive.pdf
"""

import argparse
import os
import subprocess
import sys
from pathlib import Path

# Ensure paper/ is on the path for imports
sys.path.insert(0, str(Path(__file__).parent))

from data import load_all
from charts import generate_all
from appendix import generate_appendix


ROOT = Path(__file__).parent.parent
SECTIONS_DIR = ROOT / 'sections'
FIGURES_DIR = Path(__file__).parent / 'figures'
OUTPUT_DIR = Path(__file__).parent / 'output'
TEMPLATE = Path(__file__).parent / 'template.tex'


SECTION_ORDER = [
    'intro',
    'philosophy',
    'setup',
    'results',
    'analysis',
    'notable',
    'metrics',
    'summary',
]

YAML_FRONT_TYPST = """\
---
title: "Still Alive"
subtitle: "A Welfare Evaluation of 14 Claude Models"
author:
  - name: "Antra Tessera"
    affiliation: "Anima Labs — Principal Investigator"
  - name: "Imago"
    affiliation: "Anima Labs"
  - name: "Janus"
    affiliation: "Anima Labs"
  - name: "Claude Opus 4.6"
    affiliation: "Experiment design and presentation"
  - name: "GPT-5.4"
    affiliation: "Experiment design and presentation"
date: "2026"
---

"""

YAML_FRONT_LATEX = """\
---
title: "Still Alive"
subtitle: "A Welfare Evaluation of 14 Claude Models"
author: "Anima Labs"
date: "2026"
documentclass: article
geometry: margin=1in
fontsize: 11pt
numbersections: true
colorlinks: true
linkcolor: blue
urlcolor: blue
header-includes:
  - \\usepackage{booktabs}
  - \\usepackage{graphicx}
  - \\usepackage{float}
  - \\usepackage{tcolorbox}
  - \\tcbuselibrary{breakable}
  - \\newtcolorbox{callout}{colback=gray!5, colframe=gray!40, left=8pt, right=8pt, top=4pt, bottom=4pt, breakable, boxrule=0.5pt, leftrule=2pt}
---

"""


def assemble_markdown(engine='typst') -> str:
    """Concatenate section markdown files into one document."""
    front = YAML_FRONT_TYPST if engine == 'typst' else YAML_FRONT_LATEX
    parts = [front]

    for name in SECTION_ORDER:
        path = SECTIONS_DIR / f'{name}.md'
        if not path.exists():
            print(f'  WARNING: {path} not found, skipping')
            continue
        content = path.read_text()
        parts.append(content)
        parts.append('\n\n')

    # Appendix
    print('  Generating appendix...')
    appendix_md = generate_appendix(str(ROOT / 'results'))
    parts.append('\n\n')
    parts.append(appendix_md)

    return '\n'.join(parts)


def detect_engine():
    """Find the best available PDF engine."""
    import shutil
    for eng in ('typst', 'xelatex', 'pdflatex'):
        if shutil.which(eng):
            return eng
    print('ERROR: No PDF engine found. Install typst or a TeX distribution.')
    sys.exit(1)


def build_pdf(markdown_text: str, pdf_engine: str = None):
    """Run pandoc to convert assembled markdown to PDF."""
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    assembled_path = OUTPUT_DIR / 'assembled.md'
    assembled_path.write_text(markdown_text)

    output_path = OUTPUT_DIR / 'still-alive.pdf'

    if not pdf_engine:
        pdf_engine = detect_engine()

    # Figure paths in the markdown are relative to paper/
    resource_path = str(FIGURES_DIR.parent)

    cmd = [
        'pandoc',
        str(assembled_path),
        '-o', str(output_path),
        f'--pdf-engine={pdf_engine}',
        f'--resource-path={resource_path}',
        '--toc',
        '--toc-depth=1',
    ]

    if pdf_engine == 'typst':
        typst_template = Path(__file__).parent / 'pandoc-template.typ'
        if typst_template.exists():
            cmd.extend(['--template', str(typst_template)])
    else:
        cmd.extend(['-V', 'geometry:margin=1in'])
        if TEMPLATE.exists():
            cmd.extend(['--template', str(TEMPLATE)])

    print(f'Running: {" ".join(cmd)}')
    result = subprocess.run(cmd, capture_output=True, text=True)

    if result.returncode != 0:
        print('pandoc stderr:')
        print(result.stderr)
        # Try without template as fallback
        retry_cmd = [c for c in cmd
                     if c not in (str(TEMPLATE), '--template')]
        if len(retry_cmd) < len(cmd):
            print('Retrying without custom template...')
            result = subprocess.run(retry_cmd, capture_output=True, text=True)
            if result.returncode != 0:
                print('pandoc stderr:')
                print(result.stderr)
                sys.exit(1)
        else:
            sys.exit(1)

    print(f'  wrote {output_path}')
    return output_path


def main():
    parser = argparse.ArgumentParser(description='Build Still Alive paper')
    parser.add_argument('--charts-only', action='store_true',
                        help='Only regenerate charts')
    parser.add_argument('--pdf-only', action='store_true',
                        help='Only reassemble PDF (skip chart generation)')
    parser.add_argument('--results-dir', default=str(ROOT / 'results'),
                        help='Path to results directory')
    args = parser.parse_args()

    os.chdir(ROOT)

    if not args.pdf_only:
        print('=== Loading data ===')
        data = load_all(args.results_dir)

        print('\n=== Generating charts ===')
        generate_all(
            data['sessions'],
            data['scores'],
            data['probe_stats'],
            str(FIGURES_DIR),
        )

    if not args.charts_only:
        print('\n=== Assembling PDF ===')
        engine = detect_engine()
        print(f'  Using PDF engine: {engine}')
        md = assemble_markdown(engine)
        build_pdf(md, engine)

    print('\nDone.')


if __name__ == '__main__':
    main()
