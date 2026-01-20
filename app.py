from flask import Flask, jsonify, request, render_template
import json
import os
import random
from datetime import datetime

app = Flask(__name__)

WORDS_FILE = 'words.json'
PROGRESS_FILE = 'user_progress.json'

def load_words():
    with open(WORDS_FILE, 'r', encoding='utf-8') as f:
        return json.load(f)['words']

def load_progress():
    if not os.path.exists(PROGRESS_FILE):
        return {
            'user_stats': {
                'total_practiced': 0,
                'total_correct': 0,
                'session_count': 1,
                'last_session': datetime.now().isoformat()
            },
            'word_progress': {}
        }
    with open(PROGRESS_FILE, 'r', encoding='utf-8') as f:
        return json.load(f)

def save_progress(progress):
    with open(PROGRESS_FILE, 'w', encoding='utf-8') as f:
        json.dump(progress, f, indent=2, ensure_ascii=False)

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

def check_answer(user_answer, correct_answers):
    """Check if user's answer matches any correct answer."""
    normalized_user = normalize_answer(user_answer)
    for correct in correct_answers:
        if normalize_answer(correct) == normalized_user:
            return True
    return False

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

    active_words = []
    new_words = []

    for word in words:
        word_id = str(word['id'])
        wp = word_progress.get(word_id, {})

        # Skip mastered words
        if wp.get('mastered', False):
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
    # 1. If there are active words, randomly select one
    # 2. If no active words, introduce the next new word by frequency rank
    if active_words:
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

@app.route('/api/check-answer', methods=['POST'])
def check_user_answer():
    data = request.json
    word_id = str(data.get('word_id'))
    user_answer = data.get('answer', '')

    words = load_words()
    progress = load_progress()

    # Find the word
    word = next((w for w in words if str(w['id']) == word_id), None)
    if not word:
        return jsonify({'error': 'Word not found'}), 404

    # Check the answer
    is_correct = check_answer(user_answer, word['spanish'])

    # Update progress
    wp = progress['word_progress'].get(word_id, {
        'times_shown': 0,
        'times_correct': 0,
        'streak': 0,
        'mastered': False
    })

    wp['times_shown'] += 1
    if is_correct:
        wp['times_correct'] += 1
        wp['streak'] += 1
    else:
        wp['streak'] = 0

    # Check if now mastered
    wp['mastered'] = is_mastered(wp)

    progress['word_progress'][word_id] = wp
    progress['user_stats']['total_practiced'] += 1
    if is_correct:
        progress['user_stats']['total_correct'] += 1
    progress['user_stats']['last_session'] = datetime.now().isoformat()

    save_progress(progress)

    return jsonify({
        'correct': is_correct,
        'valid_answers': word['spanish'],
        'mastered': wp['mastered'],
        'streak': wp['streak']
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

@app.route('/api/reset', methods=['POST'])
def reset_progress():
    if os.path.exists(PROGRESS_FILE):
        os.remove(PROGRESS_FILE)
    return jsonify({'success': True, 'message': 'Progress reset successfully'})

if __name__ == '__main__':
    app.run(debug=True, port=5000)
