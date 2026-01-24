from flask import Flask, jsonify, request, render_template
import json
import os
import random
import psycopg2
from psycopg2.extras import RealDictCursor
from datetime import datetime

app = Flask(__name__)

WORDS_FILE = 'words.json'
DATABASE_URL = os.environ.get('DATABASE_URL')

def get_db_connection():
    """Get a database connection."""
    conn = psycopg2.connect(DATABASE_URL)
    return conn

def init_db():
    """Initialize database tables."""
    conn = get_db_connection()
    cur = conn.cursor()

    # Create user_stats table
    cur.execute('''
        CREATE TABLE IF NOT EXISTS user_stats (
            id INTEGER PRIMARY KEY DEFAULT 1,
            total_practiced INTEGER DEFAULT 0,
            total_correct INTEGER DEFAULT 0,
            session_count INTEGER DEFAULT 1,
            last_session TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    ''')

    # Create word_progress table
    cur.execute('''
        CREATE TABLE IF NOT EXISTS word_progress (
            word_id INTEGER PRIMARY KEY,
            times_shown INTEGER DEFAULT 0,
            times_correct INTEGER DEFAULT 0,
            streak INTEGER DEFAULT 0,
            mastered BOOLEAN DEFAULT FALSE
        )
    ''')

    # Insert default user_stats if not exists
    cur.execute('''
        INSERT INTO user_stats (id, total_practiced, total_correct, session_count)
        VALUES (1, 0, 0, 1)
        ON CONFLICT (id) DO NOTHING
    ''')

    conn.commit()
    cur.close()
    conn.close()

def load_words():
    with open(WORDS_FILE, 'r', encoding='utf-8') as f:
        return json.load(f)['words']

def load_progress():
    """Load progress from PostgreSQL."""
    conn = get_db_connection()
    cur = conn.cursor(cursor_factory=RealDictCursor)

    # Get user stats
    cur.execute('SELECT * FROM user_stats WHERE id = 1')
    stats_row = cur.fetchone()

    if not stats_row:
        user_stats = {
            'total_practiced': 0,
            'total_correct': 0,
            'session_count': 1,
            'last_session': datetime.now().isoformat()
        }
    else:
        user_stats = {
            'total_practiced': stats_row['total_practiced'],
            'total_correct': stats_row['total_correct'],
            'session_count': stats_row['session_count'],
            'last_session': stats_row['last_session'].isoformat() if stats_row['last_session'] else datetime.now().isoformat()
        }

    # Get word progress
    cur.execute('SELECT * FROM word_progress')
    word_rows = cur.fetchall()

    word_progress = {}
    for row in word_rows:
        word_progress[str(row['word_id'])] = {
            'times_shown': row['times_shown'],
            'times_correct': row['times_correct'],
            'streak': row['streak'],
            'mastered': row['mastered']
        }

    cur.close()
    conn.close()

    return {
        'user_stats': user_stats,
        'word_progress': word_progress
    }

def save_word_progress(word_id, wp):
    """Save progress for a single word."""
    conn = get_db_connection()
    cur = conn.cursor()

    cur.execute('''
        INSERT INTO word_progress (word_id, times_shown, times_correct, streak, mastered)
        VALUES (%s, %s, %s, %s, %s)
        ON CONFLICT (word_id) DO UPDATE SET
            times_shown = EXCLUDED.times_shown,
            times_correct = EXCLUDED.times_correct,
            streak = EXCLUDED.streak,
            mastered = EXCLUDED.mastered
    ''', (int(word_id), wp['times_shown'], wp['times_correct'], wp['streak'], wp['mastered']))

    conn.commit()
    cur.close()
    conn.close()

def update_user_stats(is_correct):
    """Update user stats after an answer."""
    conn = get_db_connection()
    cur = conn.cursor()

    if is_correct:
        cur.execute('''
            UPDATE user_stats
            SET total_practiced = total_practiced + 1,
                total_correct = total_correct + 1,
                last_session = CURRENT_TIMESTAMP
            WHERE id = 1
        ''')
    else:
        cur.execute('''
            UPDATE user_stats
            SET total_practiced = total_practiced + 1,
                last_session = CURRENT_TIMESTAMP
            WHERE id = 1
        ''')

    conn.commit()
    cur.close()
    conn.close()

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

def check_answer_match(user_answer, correct_answers):
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
    is_correct = check_answer_match(user_answer, word['spanish'])

    # Get current word progress
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

    # Save to database
    save_word_progress(word_id, wp)
    update_user_stats(is_correct)

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
    conn = get_db_connection()
    cur = conn.cursor()

    cur.execute('DELETE FROM word_progress')
    cur.execute('UPDATE user_stats SET total_practiced = 0, total_correct = 0, session_count = 1, last_session = CURRENT_TIMESTAMP WHERE id = 1')

    conn.commit()
    cur.close()
    conn.close()

    return jsonify({'success': True, 'message': 'Progress reset successfully'})

# Initialize database on startup
if DATABASE_URL:
    with app.app_context():
        init_db()

if __name__ == '__main__':
    app.run(debug=True, port=5000)
