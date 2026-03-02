// State
let currentWord = null;
let isAnswered = false;
let autoAdvanceTimeout = null;
let reviewMode = false;
let reviewedWordIds = [];
let currentStrictness = 'high';
let currentTheme = 'default';
let allWords = [];
let localProgress = null;

const STORAGE_KEY = 'fearless_quail_progress';

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
const flashcardEl = document.getElementById('flashcard');
const progressFill = document.getElementById('progress-fill');
const masteredCount = document.getElementById('mastered-count');
const totalCount = document.getElementById('total-count');
const accuracyEl = document.getElementById('accuracy');
const resetBtn = document.getElementById('reset-btn');
const resetProgressBtn = document.getElementById('reset-progress-btn');
const answerSection = document.querySelector('.answer-section');
const reviewBtn = document.getElementById('review-btn');
const activeCountEl = document.getElementById('active-count');
const reviewModeIndicator = document.getElementById('review-mode-indicator');
const reviewRemainingEl = document.getElementById('review-remaining');
const exitReviewBtn = document.getElementById('exit-review-btn');
const strictnessHighBtn = document.getElementById('btn-strictness-high');
const strictnessLowBtn = document.getElementById('btn-strictness-low');
const accentMissNoteEl = document.getElementById('accent-miss-note');
const themeOpenBtn = document.getElementById('theme-open-btn');
const themeModalOverlay = document.getElementById('theme-modal-overlay');
const themeModalClose = document.getElementById('theme-modal-close');

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    initProgress();
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
            }
        };
    }
}

function saveLocalProgress() {
    localProgress.user_stats.last_session = new Date().toISOString();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(localProgress));
}

function isMastered(wp) {
    const timesShown = wp.times_shown || 0;
    const timesCorrect = wp.times_correct || 0;
    const streak = wp.streak || 0;
    if (timesShown === 1 && timesCorrect === 1) return true;
    if (streak >= 3) return true;
    if (timesShown >= 5 && timesCorrect / timesShown >= 0.8) return true;
    return false;
}

function selectNextWord() {
    const wp = localProgress.word_progress;
    const active = [], newWords = [], review = [];

    for (const word of allWords) {
        const wordWp = wp[String(word.id)] || {};
        if (wordWp.mastered) {
            if (wordWp.first_attempt_correct === false) review.push(word);
            continue;
        }
        if ((wordWp.times_shown || 0) > 0) active.push(word);
        else newWords.push(word);
    }

    if (!active.length && !newWords.length) return null;

    if (review.length && Math.random() < 0.05) {
        return review[Math.floor(Math.random() * review.length)];
    }
    if (active.length && newWords.length) {
        if (Math.random() < 0.2) return active[Math.floor(Math.random() * active.length)];
        newWords.sort((a, b) => a.rank - b.rank);
        return newWords[0];
    }
    if (active.length) return active[Math.floor(Math.random() * active.length)];
    newWords.sort((a, b) => a.rank - b.rank);
    return newWords[0];
}

function selectNextReviewWord(excludeIds) {
    const wp = localProgress.word_progress;
    const excludeSet = new Set(excludeIds.map(String));
    const active = [];

    for (const word of allWords) {
        const wordId = String(word.id);
        if (excludeSet.has(wordId)) continue;
        const wordWp = wp[wordId] || {};
        if (!wordWp.mastered && (wordWp.times_shown || 0) > 0) {
            active.push(word);
        }
    }

    if (!active.length) return null;
    return { word: active[Math.floor(Math.random() * active.length)], remaining: active.length };
}

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

    reviewBtn.addEventListener('click', enterReviewMode);
    exitReviewBtn.addEventListener('click', exitReviewMode);

    strictnessHighBtn.addEventListener('click', () => setStrictness('high'));
    strictnessLowBtn.addEventListener('click', () => setStrictness('low'));

    themeOpenBtn.addEventListener('click', openThemeModal);
    themeModalClose.addEventListener('click', closeThemeModal);
    themeModalOverlay.addEventListener('click', (e) => {
        if (e.target === themeModalOverlay) closeThemeModal();
    });
    document.querySelectorAll('.theme-option').forEach(btn => {
        btn.addEventListener('click', () => setTheme(btn.dataset.theme));
    });

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

            // Insert character at cursor position
            input.value = text.substring(0, start) + char + text.substring(end);

            // Move cursor after inserted character
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
    answerInput.value = '';
    answerInput.disabled = false;
    submitBtn.style.display = 'inline-block';
    answerSection.style.display = 'flex';
    flashcardEl.style.display = 'block';
    completionEl.style.display = 'none';

    if (!allWords.length) return; // Words not loaded yet

    let selected;
    if (reviewMode) {
        const result = selectNextReviewWord(reviewedWordIds);
        if (!result) {
            exitReviewMode();
            return;
        }
        selected = result.word;
        reviewedWordIds.push(String(selected.id));
        const remaining = result.remaining - 1;
        reviewRemainingEl.textContent = `${remaining} word${remaining !== 1 ? 's' : ''} remaining`;
    } else {
        selected = selectNextWord();
        if (!selected) {
            showCompletion();
            return;
        }
    }

    currentWord = selected;
    englishWordEl.textContent = currentWord.english;

    setTimeout(() => {
        answerInput.focus();
        answerInput.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 50);
}

async function checkAnswer() {
    const userAnswer = answerInput.value.trim();

    if (!userAnswer) {
        answerInput.focus();
        return;
    }

    if (!currentWord) return;

    try {
        const response = await fetch('/api/check-answer', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
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

        if (wp.times_shown === 0) {
            wp.first_attempt_correct = data.correct;
        }
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

            // Show accent-miss note if the only mistake was a missing accent
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

            // Show other accepted answers (synonyms) if there are any
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
                // Give more time to read synonyms / accent note
                autoAdvanceTimeout = setTimeout(() => loadNextWord(), 2500);
            } else if (data.accent_only_miss) {
                correctAnswersEl.innerHTML = '';
                // Give time to read the accent miss note
                autoAdvanceTimeout = setTimeout(() => loadNextWord(), 2500);
            } else {
                correctAnswersEl.innerHTML = '';
                // Auto-advance after 1 second for correct answers with no synonyms
                autoAdvanceTimeout = setTimeout(() => loadNextWord(), 1000);
            }
        } else {
            feedbackEl.classList.add('incorrect');
            feedbackIcon.textContent = '✗';
            feedbackText.textContent = 'Not quite right';
            accentMissNoteEl.style.display = 'none';

            correctAnswersEl.innerHTML = '<strong>Correct answers:</strong>';
            data.valid_answers.forEach(answer => {
                const span = document.createElement('span');
                span.textContent = answer;
                correctAnswersEl.appendChild(span);
            });
        }

        // Update progress display
        displayProgress();

        nextBtn.focus();
    } catch (error) {
        console.error('Error checking answer:', error);
    }
}

function displayProgress() {
    if (!localProgress || !allWords.length) return;

    const wp = localProgress.word_progress;
    const masteredCountVal = Object.values(wp).filter(w => w.mastered).length;
    masteredCount.textContent = masteredCountVal;
    totalCount.textContent = allWords.length;

    const { total_practiced, total_correct } = localProgress.user_stats;
    const accuracy = total_practiced > 0
        ? Math.round(total_correct / total_practiced * 1000) / 10
        : 0;
    accuracyEl.textContent = accuracy;

    const percentage = allWords.length > 0 ? (masteredCountVal / allWords.length) * 100 : 0;
    progressFill.style.width = `${percentage}%`;

    // Update active word count and review button
    let activeCount = 0;
    for (const word of allWords) {
        const wordWp = wp[String(word.id)] || {};
        if (!wordWp.mastered && (wordWp.times_shown || 0) > 0) activeCount++;
    }
    activeCountEl.textContent = activeCount;
    reviewBtn.style.display = activeCount > 0 ? 'inline-block' : 'none';
}

// Kept for compatibility — now delegates to displayProgress
function loadProgress() {
    displayProgress();
}

function loadActiveWordCount() {
    displayProgress();
}

function enterReviewMode() {
    reviewMode = true;
    reviewedWordIds = [];
    reviewBtn.style.display = 'none';
    reviewModeIndicator.style.display = 'flex';
    loadNextWord();
}

function exitReviewMode() {
    reviewMode = false;
    reviewedWordIds = [];
    reviewModeIndicator.style.display = 'none';
    displayProgress();
    loadNextWord();
}

async function loadSettings() {
    try {
        const response = await fetch('/api/settings');
        const data = await response.json();
        currentStrictness = data.strictness;
        currentTheme = data.theme || 'default';
        updateStrictnessUI();
        applyTheme(currentTheme);
        updateThemeUI();
    } catch (error) {
        console.error('Error loading settings:', error);
    }
}

function updateStrictnessUI() {
    strictnessHighBtn.classList.toggle('active', currentStrictness === 'high');
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
    } catch (error) {
        console.error('Error saving settings:', error);
    }
}

function openThemeModal() {
    themeModalOverlay.style.display = 'flex';
}

function closeThemeModal() {
    themeModalOverlay.style.display = 'none';
}

function applyTheme(theme) {
    const themes = ['spain', 'mexico', 'costa-rica', 'colombia', 'dominican-republic'];
    themes.forEach(t => document.body.classList.remove(`theme-${t}`));
    if (theme !== 'default') {
        document.body.classList.add(`theme-${theme}`);
    }
}

function updateThemeUI() {
    document.querySelectorAll('.theme-option').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.theme === currentTheme);
    });
}

async function setTheme(theme) {
    try {
        await fetch('/api/settings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ theme })
        });
        currentTheme = theme;
        applyTheme(theme);
        updateThemeUI();
        closeThemeModal();
    } catch (error) {
        console.error('Error saving theme:', error);
    }
}

function showCompletion() {
    flashcardEl.style.display = 'none';
    answerSection.style.display = 'none';
    feedbackEl.style.display = 'none';
    completionEl.style.display = 'block';
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
