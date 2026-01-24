// State
let currentWord = null;
let isAnswered = false;

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

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    loadNextWord();
    loadProgress();
    setupEventListeners();
});

function setupEventListeners() {
    submitBtn.addEventListener('click', checkAnswer);
    nextBtn.addEventListener('click', loadNextWord);
    resetBtn.addEventListener('click', resetProgress);
    resetProgressBtn.addEventListener('click', confirmReset);

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
    try {
        // Reset UI
        isAnswered = false;
        feedbackEl.style.display = 'none';
        feedbackEl.classList.remove('correct', 'incorrect', 'show');
        answerInput.value = '';
        answerInput.disabled = false;
        submitBtn.style.display = 'inline-block';
        answerSection.style.display = 'flex';
        flashcardEl.style.display = 'block';
        completionEl.style.display = 'none';

        const response = await fetch('/api/next-word');
        const data = await response.json();

        if (data.done) {
            showCompletion();
            return;
        }

        currentWord = data.word;
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
            correctAnswersEl.innerHTML = '';

            // Auto-advance after 1 second for correct answers
            setTimeout(() => loadNextWord(), 1000);
        } else {
            feedbackEl.classList.add('incorrect');
            feedbackIcon.textContent = '✗';
            feedbackText.textContent = 'Not quite right';

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
    } catch (error) {
        console.error('Error loading progress:', error);
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
