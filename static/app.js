// State
let currentWord = null;
let isAnswered = false;
let autoAdvanceTimeout = null;
let currentStrictness = 'medium';
let allWords = [];
let localProgress = null;

// Correct answers auto-advance; give the user time to read the example sentence
const EXAMPLE_READ_DELAY = 4500;

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
const exampleEl = document.getElementById('example');
const exampleEsEl = document.getElementById('example-es');
const exampleEnEl = document.getElementById('example-en');
const nextBtn = document.getElementById('next-btn');
const flashcardEl = document.getElementById('flashcard');
const progressFill = document.getElementById('progress-fill');
const practicedCount = document.getElementById('practiced-count');
const totalCount = document.getElementById('total-count');
const accuracyEl = document.getElementById('accuracy');
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

// --- Word selection ---
//
// Every word the user has seen is weighted by frequency x need, and the next
// word is a weighted random draw:
//
// - Frequency: more common words (lower rank) are more likely to appear.
// - Need: ((misses + 1) / (successes + 1)) ^ SUCCESS_EXPONENT. Words missed
//   more often than answered correctly weigh more; each correct answer lowers
//   the weight, but it never reaches zero, so every word keeps coming back now
//   and then.
//
// Unseen words are introduced from the next few by rank. The share of new
// words follows recent accuracy: the more of the last few answers were right,
// the more new words appear. A word can't come back until COOLDOWN other cards
// have been shown.

// Only the next few unseen words (by rank) are eligible, so new words are
// introduced roughly in frequency order.
const NEW_WORD_POOL_SIZE = 10;
// Share of new words: MIN_NEW_SHARE at RECENT_ACCURACY_FLOOR accuracy or below,
// rising linearly to MAX_NEW_SHARE at 100% accuracy.
const MIN_NEW_SHARE = 0.1;
const MAX_NEW_SHARE = 0.5;
const RECENT_ACCURACY_FLOOR = 0.5;
// Number of recent answers used to measure accuracy.
const RECENT_ANSWERS = 20;
// Higher = stronger preference for common words.
const FREQUENCY_EXPONENT = 0.25;
// Higher = stronger preference for words with a poor success record.
const SUCCESS_EXPONENT = 2;
// Number of cards before the same word can be shown again.
const COOLDOWN = 10;

// Ids of the most recently shown words, newest last
let recentWordIds = [];
// Results (true = correct) of the most recent answers, newest last
let recentResults = [];

function recordResult(correct) {
    recentResults.push(correct);
    if (recentResults.length > RECENT_ANSWERS) recentResults.shift();
}

function newWordShare() {
    // Before any answers this session, fall back to overall accuracy
    const stats = localProgress.user_stats;
    const accuracy = recentResults.length
        ? recentResults.filter(Boolean).length / recentResults.length
        : (stats.total_practiced ? stats.total_correct / stats.total_practiced : 1);
    const t = Math.max(0, (accuracy - RECENT_ACCURACY_FLOOR) / (1 - RECENT_ACCURACY_FLOOR));
    return MIN_NEW_SHARE + (MAX_NEW_SHARE - MIN_NEW_SHARE) * t;
}

function frequencyWeight(word) {
    return 1 / Math.pow(word.rank, FREQUENCY_EXPONENT);
}

function needWeight(wordWp) {
    const correct = wordWp.times_correct || 0;
    const misses = (wordWp.times_shown || 0) - correct;
    return Math.pow((misses + 1) / (correct + 1), SUCCESS_EXPONENT);
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

function buildPools(sortedWords, recent) {
    const wp = localProgress.word_progress;
    const practice = [], newWords = [];

    for (const word of sortedWords) {
        if (recent.has(word.id)) continue;
        const wordWp = wp[String(word.id)] || {};
        if ((wordWp.times_shown || 0) === 0) {
            if (newWords.length < NEW_WORD_POOL_SIZE) {
                newWords.push({ word, weight: frequencyWeight(word) });
            }
            continue;
        }
        practice.push({ word, weight: frequencyWeight(word) * needWeight(wordWp) });
    }
    return { practice, newWords };
}

function selectNextWord() {
    const sortedWords = allWords.slice().sort((a, b) => a.rank - b.rank);
    let pools = buildPools(sortedWords, new Set(recentWordIds));
    if (!pools.practice.length && !pools.newWords.length) {
        // Every word was shown recently (tiny word list); ignore the cooldown
        pools = buildPools(sortedWords, new Set());
    }
    const { practice, newWords } = pools;

    const word = (!newWords.length || (practice.length && Math.random() >= newWordShare()))
        ? weightedPick(practice)
        : weightedPick(newWords);

    recentWordIds.push(word.id);
    if (recentWordIds.length > COOLDOWN) recentWordIds.shift();
    return word;
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
    exampleEl.style.display = 'none';
    answerInput.value = '';
    answerInput.disabled = false;
    submitBtn.style.display = 'inline-block';
    answerSection.style.display = 'flex';
    flashcardEl.style.display = 'block';

    if (!allWords.length) return;

    currentWord = selectNextWord();
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
    // An empty answer is allowed and counts as incorrect
    const userAnswer = answerInput.value.trim();
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
            streak: 0
        };

        wp.times_shown += 1;
        if (data.correct) {
            wp.times_correct += 1;
            wp.streak += 1;
        } else {
            wp.streak = 0;
        }

        localProgress.word_progress[wordId] = wp;
        recordResult(data.correct);
        localProgress.user_stats.total_practiced += 1;
        if (data.correct) localProgress.user_stats.total_correct += 1;
        saveLocalProgress();

        // Show feedback
        feedbackEl.style.display = 'block';
        feedbackEl.classList.add('show');
        answerInput.disabled = true;
        submitBtn.style.display = 'none';
        const hasExample = showExample(data.example);

        if (data.correct) {
            feedbackEl.classList.add('correct');
            feedbackIcon.textContent = '✓';

            let text = 'Correct!';
            if (wp.streak > 1) {
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
            let delay;
            if (otherAnswers.length > 0) {
                correctAnswersEl.innerHTML = '<strong>Other ways to say it:</strong>';
                otherAnswers.forEach(answer => {
                    const span = document.createElement('span');
                    span.textContent = answer;
                    correctAnswersEl.appendChild(span);
                });
                delay = 2500;
            } else if (data.accent_only_miss) {
                correctAnswersEl.innerHTML = '';
                delay = 2500;
            } else {
                correctAnswersEl.innerHTML = '';
                delay = 1000;
            }
            if (hasExample) delay = Math.max(delay, EXAMPLE_READ_DELAY);
            autoAdvanceTimeout = setTimeout(() => loadNextWord(), delay);
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

// Render an example sentence, bolding the *marked* target word. Returns
// whether an example was shown.
function showExample(example) {
    if (!example) {
        exampleEl.style.display = 'none';
        return false;
    }
    exampleEsEl.textContent = '';
    example.es.split('*').forEach((part, i) => {
        if (!part) return;
        if (i % 2 === 1) {
            const strong = document.createElement('strong');
            strong.textContent = part;
            exampleEsEl.appendChild(strong);
        } else {
            exampleEsEl.appendChild(document.createTextNode(part));
        }
    });
    exampleEnEl.textContent = example.en;
    exampleEl.style.display = 'block';
    return true;
}

function displayProgress() {
    if (!localProgress || !allWords.length) return;

    const wp = localProgress.word_progress;

    const practicedCountVal = allWords.filter(w => (wp[String(w.id)]?.times_shown || 0) > 0).length;
    practicedCount.textContent = practicedCountVal;
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

    const percentage = (practicedCountVal / allWords.length) * 100;
    progressFill.style.width = `${percentage}%`;
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
