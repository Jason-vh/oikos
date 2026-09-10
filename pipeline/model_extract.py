"""
Read the original's balance tables into src/sim/model.json.

    python3 pipeline/model_extract.py

The game ships with Model/Zeus_Model_<difficulty>.txt, a plain-text table the
player is invited to edit. Each file holds one row per building and one per
housing level, in the same order, and documents its own columns. This reads all
five difficulties, checks they agree wherever the original does not vary them,
and writes the numbers the simulation needs.
"""

import json
import os
import re
import sys

MODEL_DIR = os.path.join('reference', 'og', 'Model')
OUT = os.path.join('src', 'sim', 'model.json')

DIFFICULTIES = ['VeryEasy', 'Easy', 'Normal', 'Hard', 'Impossible']

BUILDING_COLUMNS = [
    'cost',
    'appealInitial',
    'appealBandSize',
    'appealStep',
    'appealRange',
    'workers',
    'fireRisk',
    'damageRisk',
    'resource',
    'riskReducer',
]

HOUSE_COLUMNS = [
    'devolveAppeal',
    'evolveAppeal',
    'culture',
    'water',
    'education',
    'soldierShare',
    'maxHorses',
    'horses',
    'foodTypes',
    'fleece',
    'oil',
    'wine',
    'arms',
    'maxArms',
    'crimeRisk',
    'crimeBase',
    'unused16',
    'capacity',
    'taxRate',
    'unused19',
    'diseaseRisk',
]

VARYING_BUILDING_COLUMNS = {'cost', 'fireRisk', 'damageRisk'}

BUILDING_ROW = re.compile(r'^\s*\d+,(.*?),\{,(.*?),\},')
HOUSE_ROW = re.compile(r'^\s*(?:\d+|Elite(?: \d+)?):\s*(.*?),\{,(.*)$')


class ParseError(Exception):
    pass


def read_model(difficulty):
    path = os.path.join(MODEL_DIR, f'Zeus_Model_{difficulty}.txt')
    with open(path, encoding='latin-1') as f:
        text = f.read()

    buildings_text, _, houses_text = text.partition('ALL HOUSES')
    if not houses_text:
        raise ParseError(f'{path}: no housing table')

    buildings = {}
    for line in buildings_text.splitlines():
        match = BUILDING_ROW.match(line)
        if not match:
            continue
        name = clean_name(match.group(1))
        values = numbers(match.group(2))
        if len(values) != len(BUILDING_COLUMNS):
            raise ParseError(f'{path}: {name} has {len(values)} values')
        if name == 'UNUSED' or not any(values):
            continue
        if name in buildings:
            raise ParseError(f'{path}: {name} appears twice')
        buildings[name] = values

    houses = {}
    for line in houses_text.splitlines():
        match = HOUSE_ROW.match(line)
        if not match:
            continue
        name = clean_name(match.group(1))
        values = numbers(match.group(2))[: len(HOUSE_COLUMNS)]
        if len(values) != len(HOUSE_COLUMNS):
            raise ParseError(f'{path}: house {name} has {len(values)} values')
        houses[name] = values

    return buildings, houses


def clean_name(raw):
    return raw.strip().strip('"').split('//')[0].strip().rstrip(',').strip()


def numbers(raw):
    return [int(field) for field in raw.split(',') if re.fullmatch(r'-?\d+', field.strip())]


def merge(tables, columns, varying):
    names = list(tables[DIFFICULTIES[0]])
    for difficulty in DIFFICULTIES:
        if list(tables[difficulty]) != names:
            raise ParseError(f'{difficulty} lists different rows')

    merged = {}
    for name in names:
        rows = [tables[difficulty][name] for difficulty in DIFFICULTIES]
        entry = {}
        for index, column in enumerate(columns):
            values = [row[index] for row in rows]
            if column in varying:
                entry[column] = values
                continue
            if len(set(values)) != 1:
                raise ParseError(f'{name}.{column} varies by difficulty: {values}')
            entry[column] = values[0]
        merged[name] = entry
    return merged


def main():
    if not os.path.isdir(MODEL_DIR):
        print(f'{MODEL_DIR} is missing — see the Reference section of the README', file=sys.stderr)
        return 1

    models = {difficulty: read_model(difficulty) for difficulty in DIFFICULTIES}
    buildings = merge({d: models[d][0] for d in DIFFICULTIES}, BUILDING_COLUMNS, VARYING_BUILDING_COLUMNS)
    houses = merge({d: models[d][1] for d in DIFFICULTIES}, HOUSE_COLUMNS, set(HOUSE_COLUMNS))

    with open(OUT, 'w', encoding='utf-8') as f:
        f.write('{\n')
        f.write(f'  "difficulties": {json.dumps(DIFFICULTIES)},\n')
        f.write('  "buildings": {\n')
        f.write(',\n'.join(f'    {json.dumps(name)}: {json.dumps(entry)}' for name, entry in buildings.items()))
        f.write('\n  },\n  "houses": {\n')
        f.write(',\n'.join(f'    {json.dumps(name)}: {json.dumps(entry)}' for name, entry in houses.items()))
        f.write('\n  }\n}\n')

    print(f'{OUT}: {len(buildings)} buildings, {len(houses)} housing levels')
    return 0


if __name__ == '__main__':
    sys.exit(main())
