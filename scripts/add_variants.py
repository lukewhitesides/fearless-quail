"""
Script to add synonyms and gender variants to words.json

Usage:
    python scripts/add_variants.py [start_index] [end_index]

Examples:
    python scripts/add_variants.py 0 1000      # Process words 1-1000
    python scripts/add_variants.py 1000 2000   # Process words 1001-2000
    python scripts/add_variants.py             # Process ALL words

The script will:
1. Add masculine/feminine variants for adjectives (bueno -> bueno, buena)
2. Add common synonyms (empezar -> empezar, comenzar)
3. Add regional variants (carro -> carro, coche, auto)
"""

import json
import sys
import os

# Get the project root directory
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_DIR = os.path.dirname(SCRIPT_DIR)
WORDS_FILE = os.path.join(PROJECT_DIR, 'words.json')

# Common Spanish synonyms (bidirectional - if one appears, add the other)
synonyms = {
    # Verbs
    'empezar': ['comenzar'],
    'comenzar': ['empezar'],
    'terminar': ['acabar', 'finalizar'],
    'acabar': ['terminar', 'finalizar'],
    'finalizar': ['terminar', 'acabar'],
    'mirar': ['ver', 'observar'],
    'ver': ['mirar'],
    'hablar': ['conversar', 'platicar'],
    'conversar': ['hablar', 'platicar'],
    'platicar': ['hablar', 'conversar'],
    'responder': ['contestar'],
    'contestar': ['responder'],
    'obtener': ['conseguir', 'lograr'],
    'conseguir': ['obtener', 'lograr'],
    'lograr': ['obtener', 'conseguir'],
    'regresar': ['volver', 'retornar'],
    'volver': ['regresar', 'retornar'],
    'retornar': ['regresar', 'volver'],
    'pensar': ['creer'],
    'creer': ['pensar'],
    'comprender': ['entender'],
    'entender': ['comprender'],
    'mostrar': ['enseñar'],
    'enseñar': ['mostrar'],
    'coger': ['tomar', 'agarrar'],
    'tomar': ['coger', 'agarrar'],
    'agarrar': ['coger', 'tomar'],
    'tirar': ['lanzar', 'arrojar'],
    'lanzar': ['tirar', 'arrojar'],
    'arrojar': ['tirar', 'lanzar'],
    'enviar': ['mandar'],
    'mandar': ['enviar'],
    'hallar': ['encontrar'],
    'encontrar': ['hallar'],
    'andar': ['caminar'],
    'caminar': ['andar'],
    'subir': ['ascender'],
    'bajar': ['descender'],
    'ascender': ['subir'],
    'descender': ['bajar'],
    'morir': ['fallecer'],
    'fallecer': ['morir'],
    'enojar': ['enfadar'],
    'enfadar': ['enojar'],
    'asustar': ['espantar'],
    'espantar': ['asustar'],
    'sufrir': ['padecer'],
    'padecer': ['sufrir'],
    'elegir': ['escoger', 'seleccionar'],
    'escoger': ['elegir', 'seleccionar'],
    'seleccionar': ['elegir', 'escoger'],
    'utilizar': ['usar', 'emplear'],
    'usar': ['utilizar', 'emplear'],
    'emplear': ['utilizar', 'usar'],
    # Nouns with regional variants
    'carro': ['coche', 'auto'],
    'coche': ['carro', 'auto'],
    'auto': ['carro', 'coche'],
    'computadora': ['ordenador', 'computador'],
    'ordenador': ['computadora', 'computador'],
    'computador': ['computadora', 'ordenador'],
    'apartamento': ['piso', 'departamento'],
    'piso': ['apartamento', 'departamento'],
    'departamento': ['apartamento', 'piso'],
    'cuarto': ['habitación'],
    'habitación': ['cuarto'],
    'lentes': ['gafas', 'anteojos'],
    'gafas': ['lentes', 'anteojos'],
    'anteojos': ['lentes', 'gafas'],
    'dinero': ['plata'],
    'plata': ['dinero'],
    'película': ['filme'],
    'filme': ['película'],
    'celular': ['móvil'],
    'móvil': ['celular'],
    # Adjectives
    'bonito': ['lindo', 'hermoso', 'bello'],
    'lindo': ['bonito', 'hermoso', 'bello'],
    'hermoso': ['bonito', 'lindo', 'bello'],
    'bello': ['bonito', 'lindo', 'hermoso'],
    'grande': ['enorme'],
    'enorme': ['grande'],
    'pequeño': ['chico'],
    'chico': ['pequeño'],
    'rápido': ['veloz'],
    'veloz': ['rápido'],
    'difícil': ['complicado'],
    'complicado': ['difícil'],
    'fácil': ['sencillo', 'simple'],
    'sencillo': ['fácil', 'simple'],
    'simple': ['fácil', 'sencillo'],
    'antiguo': ['viejo'],
    'viejo': ['antiguo'],
    'contento': ['feliz', 'alegre'],
    'feliz': ['contento', 'alegre'],
    'alegre': ['contento', 'feliz'],
    'enojado': ['enfadado', 'molesto'],
    'enfadado': ['enojado', 'molesto'],
    'molesto': ['enojado', 'enfadado'],
    'cansado': ['agotado'],
    'agotado': ['cansado'],
    'cercano': ['próximo'],
    'próximo': ['cercano'],
    'lejano': ['distante', 'remoto'],
    'distante': ['lejano'],
    'remoto': ['lejano'],
    # Adverbs
    'nunca': ['jamás'],
    'jamás': ['nunca'],
    'también': ['además'],
    'además': ['también'],
    'quizás': ['tal vez', 'quizá'],
    'quizá': ['quizás', 'tal vez'],
}

# Words that should NOT get gender variants (common words ending in -o/-a that don't change)
no_gender_variant = {
    # Common invariable words
    'para', 'como', 'cosa', 'cada', 'otra', 'esta', 'ella', 'era', 'toda',
    'nada', 'nunca', 'siempre', 'ahora', 'forma', 'manera', 'hora', 'vida',
    'agua', 'casa', 'cama', 'mesa', 'silla', 'tierra', 'guerra', 'puerta',
    'cuenta', 'fuerza', 'lengua', 'letra', 'regla', 'idea', 'fecha', 'fiesta',
    'historia', 'persona', 'palabra', 'pregunta', 'respuesta', 'semana',
    'ventana', 'comida', 'bebida', 'familia', 'iglesia', 'escuela', 'empresa',
    'cuando', 'mientras', 'aunque', 'porque', 'hacia', 'contra', 'entre',
    'sobre', 'desde', 'hasta', 'según', 'durante', 'mediante',
    # Nouns that don't change gender
    'tiempo', 'año', 'día', 'momento', 'modo', 'punto', 'caso', 'hecho',
    'mundo', 'país', 'pueblo', 'gobierno', 'estado', 'grupo', 'centro',
    'cuerpo', 'libro', 'cuarto', 'camino', 'medio', 'lado', 'fondo',
    'principio', 'trabajo', 'dinero', 'viento', 'fuego', 'cielo', 'suelo',
    'pelo', 'dedo', 'brazo', 'cuello', 'pecho', 'hueso', 'ojo',
    # Verbs and verb forms
    'quiero', 'tengo', 'puedo', 'debo', 'veo', 'creo', 'siento', 'pienso',
    'hago', 'digo', 'vengo', 'salgo', 'pongo', 'llevo', 'paso', 'llamo',
    'busco', 'encuentro', 'espero', 'necesito', 'conozco', 'parece',
    # Other
    'esto', 'eso', 'algo', 'nuestro', 'vuestro', 'cuyo',
}


def add_gender_variants(spanish_list, category):
    """Add masculine/feminine variants for adjectives only"""
    # Only apply to adjectives
    if category != 'adjective':
        return spanish_list

    new_list = list(spanish_list)
    for word in spanish_list:
        word_lower = word.lower()

        # Skip if in the no-change list
        if word_lower in no_gender_variant:
            continue

        if word_lower.endswith('o') and len(word) > 2:
            feminine = word[:-1] + 'a'
            if feminine not in new_list and feminine.lower() not in [w.lower() for w in new_list]:
                new_list.append(feminine)
        elif word_lower.endswith('a') and len(word) > 2:
            masculine = word[:-1] + 'o'
            if masculine not in new_list and masculine.lower() not in [w.lower() for w in new_list]:
                new_list.append(masculine)
    return new_list


def add_synonyms(spanish_list):
    """Add synonyms for known words"""
    new_list = list(spanish_list)
    for word in spanish_list:
        word_lower = word.lower()
        if word_lower in synonyms:
            for syn in synonyms[word_lower]:
                if syn not in new_list and syn.lower() not in [w.lower() for w in new_list]:
                    new_list.append(syn)
    return new_list


def main():
    # Parse arguments
    if len(sys.argv) == 3:
        start_idx = int(sys.argv[1])
        end_idx = int(sys.argv[2])
    elif len(sys.argv) == 1:
        start_idx = 0
        end_idx = None  # Process all
    else:
        print(__doc__)
        sys.exit(1)

    # Load the words
    print(f"Loading {WORDS_FILE}...")
    with open(WORDS_FILE, 'r', encoding='utf-8') as f:
        data = json.load(f)

    total_words = len(data['words'])
    if end_idx is None:
        end_idx = total_words

    print(f"Processing words {start_idx + 1} to {end_idx} (of {total_words} total)...")

    # Process specified range
    count_modified = 0
    for i in range(start_idx, min(end_idx, total_words)):
        word = data['words'][i]
        spanish_original = list(word['spanish'])
        spanish = list(word['spanish'])
        category = word.get('category', '')

        # Add gender variants (adjectives only)
        spanish = add_gender_variants(spanish, category)

        # Add synonyms
        spanish = add_synonyms(spanish)

        # Update the word
        data['words'][i]['spanish'] = spanish

        if len(spanish) > len(spanish_original):
            count_modified += 1

    # Save the updated file
    with open(WORDS_FILE, 'w', encoding='utf-8') as f:
        json.dump(data, f, indent=2, ensure_ascii=False)

    print(f"Done! Modified {count_modified} entries.")

    # Show some examples of what changed
    print("\nExamples of modified words:")
    shown = 0
    for i in range(start_idx, min(end_idx, total_words)):
        word = data['words'][i]
        if len(word['spanish']) > 1:
            print(f"  [{word.get('category', 'unknown')}] {word['english']}: {word['spanish']}")
            shown += 1
            if shown >= 20:
                print("  ...")
                break


if __name__ == '__main__':
    main()
