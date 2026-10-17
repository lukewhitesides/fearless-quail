"""
Validate examples.json against words.json.

Usage:
    python scripts/check_examples.py

Checks that each example has a Spanish sentence with exactly one *marked*
target word, an English translation, and that the marked word plausibly is a
form of the word's Spanish answer (shares its beginning or its leading
consonants, ignoring accents). Marked words that don't look like a form of the
answer (e.g. irregular verbs: ir -> voy) are listed as warnings to review.
"""

import json
import os
import sys
import unicodedata

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_DIR = os.path.dirname(SCRIPT_DIR)


def strip_accents(text):
    nfkd = unicodedata.normalize('NFKD', text.lower())
    return ''.join(c for c in nfkd if not unicodedata.combining(c))


def consonants(text):
    return ''.join(c for c in text if c.isalpha() and c not in 'aeiou')


def plausible_form(marked, answers):
    m = strip_accents(marked)
    for ans in answers:
        for part in strip_accents(ans).replace('(', ' ').replace(')', ' ').split():
            stem = part[:max(1, min(4, len(part) - 2))]
            if part in m or m.startswith(stem) or stem in m:
                return True
            # Stem-changing verbs: pensar -> pienso, contar -> cuenta
            skeleton = consonants(part)[:3]
            if len(skeleton) >= 2 and consonants(m).startswith(skeleton):
                return True
    return False


def main():
    with open(os.path.join(PROJECT_DIR, 'words.json'), encoding='utf-8') as f:
        words = {str(w['id']): w for w in json.load(f)['words']}
    with open(os.path.join(PROJECT_DIR, 'examples.json'), encoding='utf-8') as f:
        examples = json.load(f)

    problems, warnings = [], []
    for word_id, ex in examples.items():
        word = words.get(word_id)
        if not word:
            problems.append(f'{word_id}: no such word')
            continue
        es, en = ex.get('es', ''), ex.get('en', '')
        parts = es.split('*')
        if len(parts) != 3 or not parts[1].strip():
            problems.append(f'{word_id}: needs exactly one *marked* word: {es}')
        elif not plausible_form(parts[1], word['spanish']):
            warnings.append(f'{word_id}: marked "{parts[1]}" vs {word["spanish"]}: {es}')
        if not en.strip():
            problems.append(f'{word_id}: missing English translation')

    missing = [i for i in words if i not in examples]
    for w in warnings:
        print('warning:', w)
    for p in problems:
        print('problem:', p)
    print(f'{len(examples)} examples, {len(missing)} words without one, '
          f'{len(warnings)} warnings, {len(problems)} problems')
    sys.exit(1 if problems else 0)


if __name__ == '__main__':
    main()
