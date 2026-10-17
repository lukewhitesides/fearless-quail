from flask import Flask, jsonify, request, render_template
import json
import os
import unicodedata
from datetime import datetime

app = Flask(__name__)

WORDS_FILE = 'words.json'
EXAMPLES_FILE = 'examples.json'
PROGRESS_FILE = 'user_progress.json'

def load_words():
    with open(WORDS_FILE, 'r', encoding='utf-8') as f:
        return json.load(f)['words']

def load_examples():
    """Example sentences keyed by word id: {"es": ..., "en": ...}.

    In "es", the target word is wrapped in *asterisks* for highlighting.
    """
    if not os.path.exists(EXAMPLES_FILE):
        return {}
    with open(EXAMPLES_FILE, 'r', encoding='utf-8') as f:
        return json.load(f)

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
            'settings': {'strictness': 'medium'}
        }
    with open(PROGRESS_FILE, 'r', encoding='utf-8') as f:
        progress = json.load(f)
    if 'settings' not in progress:
        progress['settings'] = {'strictness': 'medium'}
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

def build_article_answers(correct_answers, article):
    """Return correct answers prefixed with the required article."""
    return [f"{article} {ans}" for ans in correct_answers]

def check_answer_match(user_answer, correct_answers, strictness='high', word=None):
    """Check if user's answer matches any correct answer.

    Returns a dict: {'correct': bool, 'accent_only_miss': bool, 'article_miss': bool}.
    accent_only_miss is True when the answer would be correct if accents are ignored.
    article_miss is True when the noun answer is correct but the article was missing/wrong.
    """
    normalized_user = normalize_answer(user_answer)

    # For high strictness on nouns: require correct article prefix
    if strictness == 'high' and word and word.get('category') == 'noun' and word.get('article'):
        article = word['article']
        article_answers = build_article_answers(correct_answers, article)

        for correct in article_answers:
            if normalize_answer(correct) == normalized_user:
                return {'correct': True, 'accent_only_miss': False, 'article_miss': False}

        # Check if they got the noun right but forgot the article
        for correct in correct_answers:
            if normalize_answer(correct) == normalized_user:
                return {'correct': False, 'accent_only_miss': False, 'article_miss': True}

        return {'correct': False, 'accent_only_miss': False, 'article_miss': False}

    # Medium and low strictness: standard matching without article requirement
    for correct in correct_answers:
        if normalize_answer(correct) == normalized_user:
            return {'correct': True, 'accent_only_miss': False, 'article_miss': False}

    if strictness == 'low':
        user_no_accents = remove_accents(normalized_user)
        for correct in correct_answers:
            if remove_accents(normalize_answer(correct)) == user_no_accents:
                return {'correct': True, 'accent_only_miss': True, 'article_miss': False}

    return {'correct': False, 'accent_only_miss': False, 'article_miss': False}

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/api/words')
def get_all_words():
    words = load_words()
    return jsonify({'words': [
        {
            'id': w['id'],
            'english': w['english'],
            'rank': w['rank'],
            'category': w['category'],
            'hint': w.get('hint', ''),
            'article': w.get('article'),
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

    result = check_answer_match(user_answer, word['spanish'], strictness, word)

    valid_answers = word['spanish']
    if strictness == 'high' and word.get('category') == 'noun' and word.get('article'):
        valid_answers = build_article_answers(word['spanish'], word['article'])

    return jsonify({
        'correct': result['correct'],
        'accent_only_miss': result['accent_only_miss'],
        'article_miss': result['article_miss'],
        'valid_answers': valid_answers,
        'article': word.get('article'),
        'example': load_examples().get(word_id),
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
        if 'strictness' in data and data['strictness'] in ('low', 'medium', 'high'):
            progress['settings']['strictness'] = data['strictness']
        save_progress_json(progress)
    return jsonify(progress['settings'])

@app.route('/api/reset', methods=['POST'])
def reset_progress():
    reset_all_progress()
    return jsonify({'success': True, 'message': 'Progress reset successfully'})

if __name__ == '__main__':
    app.run(debug=True, port=5000)
