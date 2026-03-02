from flask import Flask, jsonify, request, render_template
import json
import os
import random
import unicodedata
from datetime import datetime

app = Flask(__name__)

WORDS_FILE = 'words.json'
PROGRESS_FILE = 'user_progress.json'

def load_words():
    with open(WORDS_FILE, 'r', encoding='utf-8') as f:
        return json.load(f)['words']

# JSON-based progress functions for local development
def load_progress_json():
    if not os.path.exists(PROGRESS_FILE):
        return {
            'user_stats': {
                'total_practiced': 0,
                'total_correct': 0,
                'session_count': 1,
                'last_session': datetime.now().isoformat()
            },
            'word_progress': {},
            'settings': {'strictness': 'high'}
        }
    with open(PROGRESS_FILE, 'r', encoding='utf-8') as f:
        progress = json.load(f)
    if 'settings' not in progress:
        progress['settings'] = {'strictness': 'high'}
    if 'theme' not in progress['settings']:
        progress['settings']['theme'] = 'default'
    return progress

def save_progress_json(progress):
    with open(PROGRESS_FILE, 'w', encoding='utf-8') as f:
        json.dump(progress, f, indent=2, ensure_ascii=False)

def load_progress():
    return load_progress_json()

def save_progress(word_id, wp, is_correct):
    progress = load_progress_json()
    progress['word_progress'][word_id] = wp
    progress['user_stats']['total_practiced'] += 1
    if is_correct:
        progress['user_stats']['total_correct'] += 1
    progress['user_stats']['last_session'] = datetime.now().isoformat()
    save_progress_json(progress)

def reset_all_progress():
    if os.path.exists(PROGRESS_FILE):
        os.remove(PROGRESS_FILE)

def is_mastered(word_progress):
    """Check if a word is mastered based on the mastery rules."""
    times_shown = word_progress.get('times_shown', 0)
    times_correct = word_progress.get('times_correct', 0)
    streak = word_progress.get('streak', 0)

    # Rule 1: Correct on first attempt
    if times_shown == 1 and times_correct == 1:
        return True
    # Rule 2: Streak of 3 or more
    if streak >= 3:
        return True
    # Rule 3: Shown 5+ times with 80%+ accuracy
    if times_shown >= 5 and (times_correct / times_shown) >= 0.8:
        return True
    return False

def normalize_answer(answer):
    """Normalize answer for comparison."""
    return answer.strip().lower()

def remove_accents(text):
    """Remove accent marks from text for loose comparison."""
    nfkd = unicodedata.normalize('NFKD', text)
    return ''.join(c for c in nfkd if not unicodedata.combining(c))

def check_answer_match(user_answer, correct_answers, strictness='high'):
    """Check if user's answer matches any correct answer.

    Returns a dict: {'correct': bool, 'accent_only_miss': bool}.
    accent_only_miss is True when the answer would be correct if accents are ignored.
    """
    normalized_user = normalize_answer(user_answer)
    for correct in correct_answers:
        if normalize_answer(correct) == normalized_user:
            return {'correct': True, 'accent_only_miss': False}

    if strictness == 'low':
        user_no_accents = remove_accents(normalized_user)
        for correct in correct_answers:
            if remove_accents(normalize_answer(correct)) == user_no_accents:
                return {'correct': True, 'accent_only_miss': True}

    return {'correct': False, 'accent_only_miss': False}

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/api/next-word')
def get_next_word():
    words = load_words()
    progress = load_progress()
    word_progress = progress['word_progress']

    # Separate words into categories:
    # - active: shown at least once but not mastered (randomly select from these)
    # - new: never shown (introduce by frequency rank when no active words)
    # - review: mastered words that were initially gotten wrong (5% chance to review)

    active_words = []
    new_words = []
    review_words = []

    for word in words:
        word_id = str(word['id'])
        wp = word_progress.get(word_id, {})

        if wp.get('mastered', False):
            # Mastered word - check if it was initially gotten wrong for review pool
            if wp.get('first_attempt_correct') is False:
                review_words.append(word)
            continue

        times_shown = wp.get('times_shown', 0)

        if times_shown > 0:
            # Word has been shown but not mastered - add to active pool
            active_words.append(word)
        else:
            # New word - track for introduction by frequency
            new_words.append(word)

    # If no unmastered words remain, we're done
    if not active_words and not new_words:
        return jsonify({'done': True, 'message': 'All words mastered!'})

    # Selection logic:
    # 5% chance to review a mastered word that was initially gotten wrong
    # 80% new word by frequency rank, 20% random active word (if both available)
    if review_words and random.random() < 0.05:
        selected = random.choice(review_words)
    elif active_words and new_words:
        if random.random() < 0.2:
            selected = random.choice(active_words)
        else:
            new_words.sort(key=lambda x: x['rank'])
            selected = new_words[0]
    elif active_words:
        selected = random.choice(active_words)
    else:
        # Sort new words by rank and pick the most common (lowest rank)
        new_words.sort(key=lambda x: x['rank'])
        selected = new_words[0]

    return jsonify({
        'done': False,
        'word': {
            'id': selected['id'],
            'english': selected['english'],
            'category': selected['category'],
            'hint': selected.get('hint', ''),
            'rank': selected['rank']
        }
    })

@app.route('/api/words')
def get_all_words():
    words = load_words()
    return jsonify({'words': [
        {
            'id': w['id'],
            'english': w['english'],
            'rank': w['rank'],
            'category': w['category'],
            'hint': w.get('hint', '')
        }
        for w in words
    ]})

@app.route('/api/check-answer', methods=['POST'])
def check_user_answer():
    data = request.json
    word_id = str(data.get('word_id'))
    user_answer = data.get('answer', '')
    strictness = data.get('strictness', 'high')

    words = load_words()

    # Find the word
    word = next((w for w in words if str(w['id']) == word_id), None)
    if not word:
        return jsonify({'error': 'Word not found'}), 404

    result = check_answer_match(user_answer, word['spanish'], strictness)

    return jsonify({
        'correct': result['correct'],
        'accent_only_miss': result['accent_only_miss'],
        'valid_answers': word['spanish'],
    })

@app.route('/api/active-words')
def get_active_words():
    """Return count of active words (shown but not mastered)."""
    words = load_words()
    progress = load_progress()
    word_progress = progress['word_progress']

    count = 0
    for word in words:
        word_id = str(word['id'])
        wp = word_progress.get(word_id, {})
        if not wp.get('mastered', False) and wp.get('times_shown', 0) > 0:
            count += 1

    return jsonify({'active_count': count})

@app.route('/api/next-review-word')
def get_next_review_word():
    """Return a random active word for review mode.

    Accepts an optional 'exclude' query parameter with comma-separated
    word IDs to exclude (words already reviewed this session).
    """
    words = load_words()
    progress = load_progress()
    word_progress = progress['word_progress']

    exclude_param = request.args.get('exclude', '')
    excluded_ids = set(exclude_param.split(',')) if exclude_param else set()

    active_words = []
    for word in words:
        word_id = str(word['id'])
        wp = word_progress.get(word_id, {})
        if not wp.get('mastered', False) and wp.get('times_shown', 0) > 0:
            if word_id not in excluded_ids:
                active_words.append(word)

    if not active_words:
        return jsonify({'done': True, 'message': 'No active words to review!'})

    selected = random.choice(active_words)

    return jsonify({
        'done': False,
        'word': {
            'id': selected['id'],
            'english': selected['english'],
            'category': selected['category'],
            'hint': selected.get('hint', ''),
            'rank': selected['rank']
        },
        'remaining': len(active_words)
    })

@app.route('/api/progress')
def get_progress():
    words = load_words()
    progress = load_progress()

    total_words = len(words)
    mastered_count = sum(1 for wp in progress['word_progress'].values() if wp.get('mastered', False))

    return jsonify({
        'total_words': total_words,
        'mastered': mastered_count,
        'total_practiced': progress['user_stats']['total_practiced'],
        'total_correct': progress['user_stats']['total_correct'],
        'accuracy': round(progress['user_stats']['total_correct'] / max(1, progress['user_stats']['total_practiced']) * 100, 1),
        'session_count': progress['user_stats']['session_count'],
        'last_session': progress['user_stats']['last_session']
    })

@app.route('/api/settings', methods=['GET', 'POST'])
def handle_settings():
    progress = load_progress_json()
    if request.method == 'POST':
        data = request.get_json()
        if 'strictness' in data and data['strictness'] in ('low', 'high'):
            progress['settings']['strictness'] = data['strictness']
        valid_themes = ('default', 'spain', 'mexico', 'costa-rica', 'colombia', 'dominican-republic')
        if 'theme' in data and data['theme'] in valid_themes:
            progress['settings']['theme'] = data['theme']
        save_progress_json(progress)
    return jsonify(progress['settings'])

@app.route('/api/reset', methods=['POST'])
def reset_progress():
    reset_all_progress()
    return jsonify({'success': True, 'message': 'Progress reset successfully'})

if __name__ == '__main__':
    app.run(debug=True, port=5000)
