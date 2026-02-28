// State
let currentWord = null;
let isAnswered = false;
let autoAdvanceTimeout = null;
let reviewMode = false;
let reviewedWordIds = [];
let currentStrictness = 'high';

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

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    loadNextWord();
    loadProgress();
    loadActiveWordCount();
    loadSettings();
    setupEventListeners();
});

function setupEventListeners() {
    submitBtn.addEventListener('click', checkAnswer);
    nextBtn.addEventListener('click', loadNextWord);
    resetBtn.addEventListener('click', resetProgress);
    resetProgressBtn.addEventListener('click', confirmReset);

    reviewBtn.addEventListener('click', enterReviewMode);
    exitReviewBtn.addEventListener('click', exitReviewMode);

    strictnessHighBtn.addEventListener('click', () => setStrictness('high'));
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

            // Insert character at cursor position
            input.value = text.substring(0, start) + char + text.substring(end);

            // Move cursor after inserted character
            input.selectionStart = input.selectionEnd = start + 1;
            input.focus();
        });
    });
}

async function loadNextWord() {
    // Clear any pending auto-advance timeout
    if (autoAdvanceTimeout) {
        clearTimeout(autoAdvanceTimeout);
        autoAdvanceTimeout = null;
    }

    try {
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

        let url;
        if (reviewMode) {
            const excludeParam = reviewedWordIds.length > 0 ? `?exclude=${reviewedWordIds.join(',')}` : '';
            url = `/api/next-review-word${excludeParam}`;
        } else {
            url = '/api/next-word';
        }

        const response = await fetch(url);
        const data = await response.json();

        if (data.done) {
            if (reviewMode) {
                exitReviewMode();
                return;
            }
            showCompletion();
            return;
        }

        if (reviewMode) {
            reviewRemainingEl.textContent = `${data.remaining} word${data.remaining !== 1 ? 's' : ''} remaining`;
        }

        currentWord = data.word;
        if (reviewMode) {
            reviewedWordIds.push(String(currentWord.id));
        }
        englishWordEl.textContent = currentWord.english;

        // Ensure focus on input (with delay for reliability)
        setTimeout(() => {
            answerInput.focus();
            // Scroll input into view on mobile when keyboard opens
            answerInput.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }, 50);
    } catch (error) {
        console.error('Error loading word:', error);
        englishWordEl.textContent = 'Error loading word. Please refresh.';
    }
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
                answer: userAnswer
            })
        });

        const data = await response.json();
        isAnswered = true;

        // Show feedback
        feedbackEl.style.display = 'block';
        feedbackEl.classList.add('show');
        answerInput.disabled = true;
        submitBtn.style.display = 'none';

        if (data.correct) {
            feedbackEl.classList.add('correct');
            feedbackIcon.textContent = '✓';

            let text = 'Correct!';
            if (data.mastered) {
                text += ' Word mastered!';
            } else if (data.streak > 1) {
                text += ` Streak: ${data.streak}`;
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

        // Update progress
        loadProgress();

        nextBtn.focus();
    } catch (error) {
        console.error('Error checking answer:', error);
    }
}

async function loadProgress() {
    try {
        const response = await fetch('/api/progress');
        const data = await response.json();

        masteredCount.textContent = data.mastered;
        totalCount.textContent = data.total_words;
        accuracyEl.textContent = data.accuracy;

        const percentage = (data.mastered / data.total_words) * 100;
        progressFill.style.width = `${percentage}%`;

        loadActiveWordCount();
    } catch (error) {
        console.error('Error loading progress:', error);
    }
}

async function loadActiveWordCount() {
    try {
        const response = await fetch('/api/active-words');
        const data = await response.json();
        activeCountEl.textContent = data.active_count;
        reviewBtn.style.display = data.active_count > 0 ? 'inline-block' : 'none';
    } catch (error) {
        console.error('Error loading active word count:', error);
    }
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
    loadActiveWordCount();
    loadNextWord();
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
        await fetch('/api/reset', { method: 'POST' });
        loadProgress();
        loadNextWord();
    } catch (error) {
        console.error('Error resetting progress:', error);
    }
}
