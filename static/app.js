// State
let currentWord = null;
let isAnswered = false;
let autoAdvanceTimeout = null;
let currentStrictness = 'medium';
let allWords = [];
let localProgress = null;

const STORAGE_KEY = 'fearless_quail_progress';
const THEMES = ['spain', 'mexico', 'costa-rica', 'colombia', 'dominican-republic', 'uruguay'];

// DOM Elements
const englishWordEl = document.getElementById('english-word');
const answerInput = document.getElementById('answer-input');
const submitBtn = document.getElementById('submit-btn');
const feedbackEl = document.getElementById('feedback');
const feedbackIcon = document.getElementById('feedback-icon');
const feedbackText = document.getElementById('feedback-text');
const correctAnswersEl = document.getElementById('correct-answers');
const nextBtn = document.getElementById('next-btn');
const completionEl = document.getElementById('completion');
const completionTitleEl = document.getElementById('completion-title');
const completionMsgEl = document.getElementById('completion-msg');
const flashcardEl = document.getElementById('flashcard');
const progressFill = document.getElementById('progress-fill');
const masteredCount = document.getElementById('mastered-count');
const totalCount = document.getElementById('total-count');
const accuracyEl = document.getElementById('accuracy');
const resetBtn = document.getElementById('reset-btn');
const resetProgressBtn = document.getElementById('reset-progress-btn');
const answerSection = document.querySelector('.answer-section');
const strictnessHighBtn = document.getElementById('btn-strictness-high');
const strictnessMediumBtn = document.getElementById('btn-strictness-medium');
const strictnessLowBtn = document.getElementById('btn-strictness-low');
const accentMissNoteEl = document.getElementById('accent-miss-note');
const articleMissNoteEl = document.getElementById('article-miss-note');

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    initProgress();
    applyRandomTheme();
    loadWordsAndStart();
    loadSettings();
    setupEventListeners();
});

function initProgress() {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
        try {
            localProgress = JSON.parse(stored);
        } catch (e) {
            localProgress = null;
        }
    }
    if (!localProgress) {
        localProgress = {
            word_progress: {},
            user_stats: {
                total_practiced: 0,
                total_correct: 0,
                session_count: 1,
                last_session: new Date().toISOString()
            },
            settings: {}
        };
    }
    if (!localProgress.settings) localProgress.settings = {};
    // Levels were removed; drop the stale setting from older saved progress
    delete localProgress.settings.level;
}

// Pick a random theme on each visit, avoiding a repeat of the last one
function applyRandomTheme() {
    const lastTheme = localProgress.settings.theme;
    const choices = THEMES.filter(t => t !== lastTheme);
    const theme = choices[Math.floor(Math.random() * choices.length)];
    document.body.classList.add(`theme-${theme}`);
    localProgress.settings.theme = theme;
    saveLocalProgress();
}

function saveLocalProgress() {
    localProgress.user_stats.last_session = new Date().toISOString();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(localProgress));
}

// --- Mastery ---

function isMastered(wp) {
    const timesShown = wp.times_shown || 0;
    const timesCorrect = wp.times_correct || 0;
    const streak = wp.streak || 0;
    if (timesShown === 1 && timesCorrect === 1) return true;
    if (streak >= 3) return true;
    if (timesShown >= 5 && timesCorrect / timesShown >= 0.8) return true;
    return false;
}

// --- Word selection ---
//
// Each draw first picks between two pools, then picks a word within that pool:
//
// - Practice pool: every word the user has ever missed, mastered or not.
//   Weighted by frequency x need, where need rises with the miss rate (and if
//   the last answer was wrong) and falls as the streak of correct answers grows.
//   Words that were never missed (correct on the first try) drop out entirely.
// - New pool: the next few unseen words by rank, weighted by frequency.
//
// The practice pool's share of draws grows with the total need across it, so a
// history full of struggled words is reviewed most of the time, and the share
// shrinks on its own as those words are answered correctly.

// Only the next few unseen words (by rank) are eligible, so new words are
// introduced roughly in frequency order.
const NEW_WORD_POOL_SIZE = 10;
// Share of draws given to the practice pool per unit of total need, capped at
// MAX_PRACTICE_SHARE so new words keep coming.
const PRACTICE_SHARE_PER_NEED = 0.05;
const MAX_PRACTICE_SHARE = 0.8;
// Higher = stronger preference for common words.
const FREQUENCY_EXPONENT = 0.25;
const MISS_RATE_WEIGHT = 4;
const RECENT_MISS_BONUS = 2;

function frequencyWeight(word) {
    return 1 / Math.pow(word.rank, FREQUENCY_EXPONENT);
}

function needWeight(wordWp) {
    const timesShown = wordWp.times_shown || 0;
    const misses = timesShown - (wordWp.times_correct || 0);
    if (misses <= 0) return 0;
    const streak = wordWp.streak || 0;
    // A streak of 0 on a word that's been shown means the last answer was wrong
    const need = 1 + MISS_RATE_WEIGHT * misses / timesShown + (streak === 0 ? RECENT_MISS_BONUS : 0);
    // Each correct answer in a row makes the word less pressing; mastered
    // words (streak of 3+) still come back now and then
    return need / Math.pow(1 + streak, 2);
}

function weightedPick(candidates) {
    const total = candidates.reduce((sum, c) => sum + c.weight, 0);
    let r = Math.random() * total;
    for (const c of candidates) {
        r -= c.weight;
        if (r <= 0) return c.word;
    }
    return candidates[candidates.length - 1].word;
}

function selectNextWord() {
    const sortedWords = allWords.slice().sort((a, b) => a.rank - b.rank);
    const wp = localProgress.word_progress;
    const practice = [], newWords = [];
    let struggling = 0, totalNeed = 0;

    for (const word of sortedWords) {
        // Avoid showing the same word twice in a row
        if (currentWord && word.id === currentWord.id) continue;
        const wordWp = wp[String(word.id)] || {};
        if ((wordWp.times_shown || 0) === 0) {
            if (newWords.length < NEW_WORD_POOL_SIZE) {
                newWords.push({ word, weight: frequencyWeight(word) });
            }
            continue;
        }
        if (!wordWp.mastered) struggling++;
        const need = needWeight(wordWp);
        if (need > 0) {
            totalNeed += need;
            practice.push({ word, weight: frequencyWeight(word) * need });
        }
    }

    if (!newWords.length && !struggling) {
        // Everything is mastered, unless the only word left is the one just shown
        const currentWp = currentWord && wp[String(currentWord.id)];
        if (!currentWp || currentWp.mastered) return null;
        return currentWord;
    }

    const practiceShare = Math.min(MAX_PRACTICE_SHARE, PRACTICE_SHARE_PER_NEED * totalNeed);
    if (!newWords.length || (practice.length && Math.random() < practiceShare)) {
        return weightedPick(practice);
    }
    return weightedPick(newWords);
}

// --- Startup ---

async function loadWordsAndStart() {
    try {
        const response = await fetch('/api/words');
        const data = await response.json();
        allWords = data.words;
        displayProgress();
        loadNextWord();
    } catch (error) {
        console.error('Error loading words:', error);
        englishWordEl.textContent = 'Error loading words. Please refresh.';
    }
}

function setupEventListeners() {
    submitBtn.addEventListener('click', checkAnswer);
    nextBtn.addEventListener('click', loadNextWord);
    resetBtn.addEventListener('click', resetProgress);
    resetProgressBtn.addEventListener('click', confirmReset);

    strictnessHighBtn.addEventListener('click', () => setStrictness('high'));
    strictnessMediumBtn.addEventListener('click', () => setStrictness('medium'));
    strictnessLowBtn.addEventListener('click', () => setStrictness('low'));

    answerInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            if (isAnswered) {
                loadNextWord();
            } else {
                checkAnswer();
            }
        }
    });

    // Tap flashcard to focus input (helps on mobile)
    flashcardEl.addEventListener('click', () => {
        if (!isAnswered) {
            answerInput.focus();
            answerInput.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
    });

    // Special character buttons
    document.querySelectorAll('.char-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const char = btn.dataset.char;
            const input = answerInput;
            const start = input.selectionStart;
            const end = input.selectionEnd;
            const text = input.value;
            input.value = text.substring(0, start) + char + text.substring(end);
            input.selectionStart = input.selectionEnd = start + 1;
            input.focus();
        });
    });
}

async function loadNextWord() {
    if (autoAdvanceTimeout) {
        clearTimeout(autoAdvanceTimeout);
        autoAdvanceTimeout = null;
    }

    // Reset UI
    isAnswered = false;
    feedbackEl.style.display = 'none';
    feedbackEl.classList.remove('correct', 'incorrect', 'show');
    accentMissNoteEl.style.display = 'none';
    articleMissNoteEl.style.display = 'none';
    answerInput.value = '';
    answerInput.disabled = false;
    submitBtn.style.display = 'inline-block';
    answerSection.style.display = 'flex';
    flashcardEl.style.display = 'block';
    completionEl.style.display = 'none';

    if (!allWords.length) return;

    const selected = selectNextWord();
    if (!selected) {
        showCompletion();
        return;
    }

    currentWord = selected;
    englishWordEl.textContent = currentWord.english;

    // Update placeholder hint for high strictness nouns
    if (currentStrictness === 'high' && currentWord.category === 'noun' && currentWord.article) {
        answerInput.placeholder = `Type "${currentWord.article} ..."`;
    } else {
        answerInput.placeholder = 'Type Spanish translation...';
    }

    setTimeout(() => {
        answerInput.focus();
        answerInput.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 50);
}

async function checkAnswer() {
    const userAnswer = answerInput.value.trim();
    if (!userAnswer) { answerInput.focus(); return; }
    if (!currentWord) return;

    try {
        const response = await fetch('/api/check-answer', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                word_id: currentWord.id,
                answer: userAnswer,
                strictness: currentStrictness
            })
        });

        const data = await response.json();
        isAnswered = true;

        // Update local progress
        const wordId = String(currentWord.id);
        const wp = localProgress.word_progress[wordId] || {
            times_shown: 0,
            times_correct: 0,
            streak: 0,
            mastered: false,
            first_attempt_correct: null
        };

        if (wp.times_shown === 0) wp.first_attempt_correct = data.correct;
        wp.times_shown += 1;
        if (data.correct) {
            wp.times_correct += 1;
            wp.streak += 1;
        } else {
            wp.streak = 0;
        }
        wp.mastered = isMastered(wp);

        localProgress.word_progress[wordId] = wp;
        localProgress.user_stats.total_practiced += 1;
        if (data.correct) localProgress.user_stats.total_correct += 1;
        saveLocalProgress();

        // Show feedback
        feedbackEl.style.display = 'block';
        feedbackEl.classList.add('show');
        answerInput.disabled = true;
        submitBtn.style.display = 'none';

        if (data.correct) {
            feedbackEl.classList.add('correct');
            feedbackIcon.textContent = '✓';

            let text = 'Correct!';
            if (wp.mastered) {
                text += ' Word mastered!';
            } else if (wp.streak > 1) {
                text += ` Streak: ${wp.streak}`;
            }
            feedbackText.textContent = text;

            if (data.accent_only_miss) {
                const correctForm = data.valid_answers.find(
                    a => a.toLowerCase().replace(/[^\w\s]/g, '') !== a.toLowerCase() ||
                         a !== userAnswer
                ) || data.valid_answers[0];
                accentMissNoteEl.textContent =
                    `Heads up: you missed an accent mark (correct: "${correctForm}") — but you still get credit on Low Strictness!`;
                accentMissNoteEl.style.display = 'block';
            } else {
                accentMissNoteEl.style.display = 'none';
            }
            articleMissNoteEl.style.display = 'none';

            const otherAnswers = data.valid_answers.filter(
                a => a.toLowerCase() !== userAnswer.toLowerCase()
            );
            if (otherAnswers.length > 0) {
                correctAnswersEl.innerHTML = '<strong>Other ways to say it:</strong>';
                otherAnswers.forEach(answer => {
                    const span = document.createElement('span');
                    span.textContent = answer;
                    correctAnswersEl.appendChild(span);
                });
                autoAdvanceTimeout = setTimeout(() => loadNextWord(), 2500);
            } else if (data.accent_only_miss) {
                correctAnswersEl.innerHTML = '';
                autoAdvanceTimeout = setTimeout(() => loadNextWord(), 2500);
            } else {
                correctAnswersEl.innerHTML = '';
                autoAdvanceTimeout = setTimeout(() => loadNextWord(), 1000);
            }
        } else {
            feedbackEl.classList.add('incorrect');
            feedbackIcon.textContent = '✗';
            accentMissNoteEl.style.display = 'none';

            if (data.article_miss) {
                feedbackText.textContent = 'Missing article!';
                articleMissNoteEl.textContent =
                    `Don't forget the article! High Strictness requires "el" or "la" before nouns. Correct: "${data.valid_answers[0]}"`;
                articleMissNoteEl.style.display = 'block';
            } else {
                feedbackText.textContent = 'Not quite right';
                articleMissNoteEl.style.display = 'none';
            }

            correctAnswersEl.innerHTML = '<strong>Correct answers:</strong>';
            data.valid_answers.forEach(answer => {
                const span = document.createElement('span');
                span.textContent = answer;
                correctAnswersEl.appendChild(span);
            });
        }

        displayProgress();
        nextBtn.focus();
    } catch (error) {
        console.error('Error checking answer:', error);
    }
}

function displayProgress() {
    if (!localProgress || !allWords.length) return;

    const wp = localProgress.word_progress;

    const masteredCountVal = allWords.filter(w => wp[String(w.id)]?.mastered).length;
    masteredCount.textContent = masteredCountVal;
    totalCount.textContent = allWords.length;

    // Accuracy from word_progress totals
    let practiced = 0, correct = 0;
    for (const word of allWords) {
        const wordWp = wp[String(word.id)] || {};
        practiced += wordWp.times_shown || 0;
        correct += wordWp.times_correct || 0;
    }
    const accuracy = practiced > 0
        ? Math.round(correct / practiced * 1000) / 10
        : 0;
    accuracyEl.textContent = accuracy;

    const percentage = (masteredCountVal / allWords.length) * 100;
    progressFill.style.width = `${percentage}%`;
}

function showCompletion() {
    flashcardEl.style.display = 'none';
    answerSection.style.display = 'none';
    feedbackEl.style.display = 'none';

    completionTitleEl.textContent = 'Amazing!';
    completionMsgEl.textContent = `You've mastered all ${allWords.length.toLocaleString()} Spanish words!`;

    completionEl.style.display = 'block';
}

async function loadSettings() {
    try {
        const response = await fetch('/api/settings');
        const data = await response.json();
        currentStrictness = data.strictness;
        updateStrictnessUI();
    } catch (error) {
        console.error('Error loading settings:', error);
    }
}

function updateStrictnessUI() {
    strictnessHighBtn.classList.toggle('active', currentStrictness === 'high');
    strictnessMediumBtn.classList.toggle('active', currentStrictness === 'medium');
    strictnessLowBtn.classList.toggle('active', currentStrictness === 'low');
}

async function setStrictness(value) {
    try {
        await fetch('/api/settings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ strictness: value })
        });
        currentStrictness = value;
        updateStrictnessUI();
        // Update placeholder if a noun is currently shown
        if (currentWord && currentWord.category === 'noun' && currentWord.article) {
            if (value === 'high') {
                answerInput.placeholder = `Type "${currentWord.article} ..."`;
            } else {
                answerInput.placeholder = 'Type Spanish translation...';
            }
        }
    } catch (error) {
        console.error('Error saving settings:', error);
    }
}

function confirmReset() {
    if (confirm('Are you sure you want to reset all progress? This cannot be undone.')) {
        resetProgress();
    }
}

async function resetProgress() {
    try {
        localStorage.removeItem(STORAGE_KEY);
        initProgress();
        await fetch('/api/reset', { method: 'POST' });
        displayProgress();
        loadNextWord();
    } catch (error) {
        console.error('Error resetting progress:', error);
        localStorage.removeItem(STORAGE_KEY);
        initProgress();
        displayProgress();
        loadNextWord();
    }
}
