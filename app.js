const QUESTION_BANK = window.QUESTION_BANK || [];
const BANK_BY_ID = new Map(QUESTION_BANK.map((question) => [question.id, question]));
const STORAGE_KEY = "lituk-incorrect-history-v1";
const MOCK_QUESTION_COUNT = 24;
const MOCK_SECONDS = 45 * 60;
const MOCK_PASS_MARK = 18;

const app = document.getElementById("app");
let timerId = null;

const state = {
  view: "home",
  mode: null,
  practiceCount: 10,
  questions: [],
  index: 0,
  answers: {},
  locked: {},
  justAnsweredId: null,
  result: null,
  endsAt: null,
  historyQuery: "",
  historyCategory: "All"
};

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function randomItem(items) {
  return items[Math.floor(Math.random() * items.length)];
}

function shuffle(items) {
  const copy = [...items];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [copy[index], copy[swapIndex]] = [copy[swapIndex], copy[index]];
  }
  return copy;
}

function formatTime(totalSeconds) {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function loadHistory() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
  } catch {
    return [];
  }
}

function saveHistory(entries) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries.slice(-500)));
  } catch {
    // If storage is blocked, the app still works for the active session.
  }
}

function recordWrong(question, selected, mode) {
  const history = loadHistory();
  history.push({
    id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    questionId: question.id,
    prompt: question.prompt || question.prompts[0],
    category: question.category,
    section: question.section,
    selected: selected || "No answer",
    correct: question.answer,
    explanation: question.explanation,
    mode,
    missedAt: new Date().toISOString()
  });
  saveHistory(history);
}

function groupedHistory() {
  const grouped = new Map();
  for (const entry of loadHistory()) {
    const source = BANK_BY_ID.get(entry.questionId);
    const current = grouped.get(entry.questionId);
    const merged = current || {
      questionId: entry.questionId,
      prompt: source ? source.prompts[0] : entry.prompt,
      category: source ? source.category : entry.category,
      section: source ? source.section : entry.section,
      correct: source ? source.answer : entry.correct,
      explanation: source ? source.explanation : entry.explanation,
      selected: entry.selected,
      mode: entry.mode,
      missedAt: entry.missedAt,
      times: 0
    };

    merged.times += 1;
    if (!merged.missedAt || new Date(entry.missedAt) > new Date(merged.missedAt)) {
      merged.prompt = source ? source.prompts[0] : entry.prompt;
      merged.selected = entry.selected;
      merged.mode = entry.mode;
      merged.missedAt = entry.missedAt;
    }
    grouped.set(entry.questionId, merged);
  }

  return [...grouped.values()].sort(
    (a, b) => new Date(b.missedAt).getTime() - new Date(a.missedAt).getTime()
  );
}

function buildQuestion(question) {
  return {
    ...question,
    prompt: randomItem(question.prompts),
    options: shuffle(question.options).map((text) => ({
      text,
      correct: text === question.answer
    }))
  };
}

function sampleQuestions(count, sourceIds) {
  const sourcePool = sourceIds?.length
    ? sourceIds.map((id) => BANK_BY_ID.get(id)).filter(Boolean)
    : QUESTION_BANK;
  const pool = shuffle(sourcePool);
  return pool.slice(0, Math.min(count, pool.length)).map(buildQuestion);
}

function resetSession() {
  state.mode = null;
  state.questions = [];
  state.index = 0;
  state.answers = {};
  state.locked = {};
  state.justAnsweredId = null;
  state.result = null;
  state.endsAt = null;
}

function stopTimer() {
  if (timerId) {
    clearInterval(timerId);
    timerId = null;
  }
}

function startPractice(count = state.practiceCount, sourceIds) {
  stopTimer();
  resetSession();
  state.view = "quiz";
  state.mode = "practice";
  state.practiceCount = count;
  state.questions = sampleQuestions(count, sourceIds);
  render();
}

function startMock() {
  stopTimer();
  resetSession();
  state.view = "quiz";
  state.mode = "mock";
  state.questions = sampleQuestions(MOCK_QUESTION_COUNT);
  state.endsAt = Date.now() + MOCK_SECONDS * 1000;
  timerId = setInterval(updateTimerDisplay, 500);
  render();
}

function goHome() {
  stopTimer();
  resetSession();
  state.view = "home";
  render();
}

function goHistory() {
  stopTimer();
  resetSession();
  state.view = "history";
  render();
}

function activeSessionNeedsConfirm() {
  return state.view === "quiz" && state.questions.length > 0;
}

function confirmLeaveSession() {
  return !activeSessionNeedsConfirm() || window.confirm("Leave this session?");
}

function answeredCount() {
  return Object.keys(state.answers).length;
}

function currentQuestion() {
  return state.questions[state.index];
}

function chooseOption(optionIndex) {
  const question = currentQuestion();
  if (!question) return;
  if (state.mode === "practice" && state.locked[question.id]) return;

  const option = question.options[optionIndex];
  if (!option) return;

  state.answers[question.id] = option.text;
  state.justAnsweredId = question.id;

  if (state.mode === "practice") {
    state.locked[question.id] = true;
    if (!option.correct) {
      recordWrong(question, option.text, "practice");
    }
  }

  render();
}

function nextQuestion() {
  const question = currentQuestion();
  if (state.mode === "practice" && question && !state.locked[question.id]) return;

  if (state.index < state.questions.length - 1) {
    state.index += 1;
    state.justAnsweredId = null;
    render();
    return;
  }

  if (state.mode === "practice") {
    finishPractice();
  }
}

function previousQuestion() {
  if (state.index > 0) {
    state.index -= 1;
    state.justAnsweredId = null;
    render();
  }
}

function finishPractice() {
  const correct = state.questions.filter((question) => state.answers[question.id] === question.answer);
  const incorrect = state.questions
    .filter((question) => state.answers[question.id] !== question.answer)
    .map((question) => ({ question, selected: state.answers[question.id] || "No answer" }));

  state.result = {
    mode: "practice",
    total: state.questions.length,
    score: correct.length,
    incorrect,
    timedOut: false
  };
  state.view = "results";
  state.mode = null;
  render();
}

function submitMock(timedOut = false) {
  if (state.view !== "quiz" || state.mode !== "mock") return;
  stopTimer();

  const correct = state.questions.filter((question) => state.answers[question.id] === question.answer);
  const incorrect = state.questions
    .filter((question) => state.answers[question.id] !== question.answer)
    .map((question) => ({ question, selected: state.answers[question.id] || "No answer" }));

  for (const item of incorrect) {
    recordWrong(item.question, item.selected, "mock");
  }

  state.result = {
    mode: "mock",
    total: state.questions.length,
    score: correct.length,
    incorrect,
    timedOut
  };
  state.view = "results";
  state.mode = null;
  render();
}

function updateTimerDisplay() {
  if (!state.endsAt || state.mode !== "mock") return;
  const remaining = Math.max(0, Math.ceil((state.endsAt - Date.now()) / 1000));
  const timer = document.querySelector("[data-timer]");
  if (timer) timer.textContent = formatTime(remaining);
  if (remaining === 0) {
    submitMock(true);
  }
}

function renderHeader(active) {
  return `
    <header class="topbar">
      <div class="brand">
        <strong>Life in the UK Trainer</strong>
        <span>2026 practice and mock test trainer</span>
      </div>
      <nav class="nav" aria-label="Primary">
        <button class="nav-button ${active === "home" ? "active" : ""}" data-action="home">Home</button>
        <button class="nav-button ${active === "practice" ? "active" : ""}" data-action="nav-practice">Practice</button>
        <button class="nav-button ${active === "mock" ? "active" : ""}" data-action="nav-mock">Mock test</button>
        <button class="nav-button ${active === "history" ? "active" : ""}" data-action="history">History</button>
      </nav>
    </header>
  `;
}

function renderShell(content, active) {
  app.innerHTML = `
    ${renderHeader(active)}
    <main class="main">
      ${content}
    </main>
  `;
}

function renderHome() {
  const history = groupedHistory();
  const totalMisses = loadHistory().length;
  const weakAreas = history.reduce((totals, item) => {
    totals[item.category] = (totals[item.category] || 0) + item.times;
    return totals;
  }, {});
  const topArea = Object.entries(weakAreas).sort((a, b) => b[1] - a[1])[0]?.[0] || "None yet";
  const practiceOptions = [10, 20, 30, 40]
    .map(
      (count) => `
        <label>
          <input type="radio" name="practice-count" value="${count}" ${state.practiceCount === count ? "checked" : ""} />
          <span>${count}</span>
        </label>
      `
    )
    .join("");

  renderShell(
    `
      <section class="home-layout">
        <div class="home-intro">
          <div>
            <p class="eyebrow">Mock and practice</p>
            <h1>Train with fresh wording every time.</h1>
            <p class="lede">Choose a short practice set with instant explanations, or sit a timed 24-question mock test and review every miss at the end.</p>
          </div>
          <div class="stats-row" aria-label="Study stats">
            <div class="stat"><strong>${QUESTION_BANK.length}</strong><span>test-style questions</span></div>
            <div class="stat"><strong>${history.length}</strong><span>unique mistakes</span></div>
            <div class="stat"><strong>${totalMisses}</strong><span>missed answers saved</span></div>
          </div>
        </div>
        <div class="visual-panel" role="img" aria-label="Illustration of a UK study scene"></div>
      </section>

      <section class="mode-grid" aria-label="Modes">
        <article class="mode-card">
          <div>
            <h2>Practice</h2>
            <p>Instant marking, flashing answer feedback, and explanations after every question.</p>
            <div class="segmented" aria-label="Practice question count">
              ${practiceOptions}
            </div>
          </div>
          <button class="primary-button" data-action="start-practice">Start practice</button>
        </article>

        <article class="mode-card">
          <div>
            <h2>Mock Test</h2>
            <p>24 shuffled questions, 45-minute timer, final score, and review for incorrect answers.</p>
            <div class="inline-metric"><strong>${MOCK_PASS_MARK}/${MOCK_QUESTION_COUNT}</strong><span>pass mark used here</span></div>
          </div>
          <button class="primary-button" data-action="start-mock">Start mock test</button>
        </article>

        <article class="mode-card">
          <div>
            <h2>History</h2>
            <p>Review saved incorrect questions, filter by section, and practise weaker areas again.</p>
            <div class="inline-metric"><strong>${escapeHtml(topArea)}</strong><span>weakest area</span></div>
          </div>
          <button class="secondary-button" data-action="history">Review history</button>
        </article>
      </section>
    `,
    "home"
  );
}

function renderQuiz() {
  const question = currentQuestion();
  if (!question) {
    renderShell(`<div class="empty-state"><h2>No questions available</h2></div>`, "home");
    return;
  }

  const selected = state.answers[question.id];
  const locked = state.mode === "practice" && state.locked[question.id];
  const isCorrect = selected === question.answer;
  const active = state.mode === "mock" ? "mock" : "practice";
  const progressLabel = `${state.index + 1} of ${state.questions.length}`;

  const options = question.options
    .map((option, index) => {
      const classes = ["option-button"];
      if (state.mode === "mock" && selected === option.text) classes.push("selected");
      if (locked && option.correct) classes.push("correct");
      if (locked && selected === option.text && !option.correct) classes.push("incorrect");
      if (locked && state.justAnsweredId === question.id && selected === option.text) classes.push("flash");

      return `
        <button class="${classes.join(" ")}" data-action="choose-option" data-option-index="${index}" ${locked ? "disabled" : ""}>
          <span class="option-key">${String.fromCharCode(65 + index)}</span>
          <span>${escapeHtml(option.text)}</span>
        </button>
      `;
    })
    .join("");

  const feedback =
    locked
      ? `
        <div class="feedback ${isCorrect ? "correct" : "incorrect"}">
          <strong>${isCorrect ? "Correct" : "Not quite"}</strong>
          <p>${escapeHtml(question.explanation)}</p>
          <div class="answer-line">
            ${!isCorrect ? `<span>Your answer: <span class="wrong-text">${escapeHtml(selected)}</span></span>` : ""}
            <span>Correct answer: <span class="correct-text">${escapeHtml(question.answer)}</span></span>
          </div>
        </div>
      `
      : "";

  const mockPalette =
    state.mode === "mock"
      ? `
        <aside class="question-palette">
          <h3>Questions</h3>
          <div class="number-grid">
            ${state.questions
              .map((item, index) => {
                const classes = ["number-button"];
                if (index === state.index) classes.push("current");
                if (state.answers[item.id]) classes.push("answered");
                return `<button class="${classes.join(" ")}" data-action="goto-question" data-index="${index}">${index + 1}</button>`;
              })
              .join("")}
          </div>
          <p class="muted">${answeredCount()} answered</p>
          <button class="primary-button" data-action="finish-mock" ${answeredCount() < state.questions.length ? "disabled" : ""}>Finish test</button>
        </aside>
      `
      : `
        <aside class="question-palette">
          <h3>Practice</h3>
          <p class="muted">${answeredCount()} answered in this set.</p>
          <p class="muted">Explanation appears before the next question.</p>
        </aside>
      `;

  const previousButton =
    state.mode === "mock"
      ? `<button class="secondary-button" data-action="previous-question" ${state.index === 0 ? "disabled" : ""}>Previous</button>`
      : `<button class="ghost-button" data-action="home">Leave</button>`;

  const nextButton =
    state.mode === "mock"
      ? `<button class="primary-button" data-action="next-question" ${state.index === state.questions.length - 1 ? "disabled" : ""}>Next</button>`
      : `<button class="primary-button" data-action="next-question" ${locked ? "" : "disabled"}>${state.index === state.questions.length - 1 ? "Finish practice" : "Next"}</button>`;

  renderShell(
    `
      <section class="quiz-shell">
        <article class="quiz-card">
          <div class="quiz-meta">
            <span class="pill">${escapeHtml(state.mode === "mock" ? "Mock test" : "Practice")}</span>
            <span class="pill">${escapeHtml(question.category)}</span>
            <span class="pill">${escapeHtml(progressLabel)}</span>
            ${state.mode === "mock" ? `<span class="pill timer" data-timer>${formatTime(MOCK_SECONDS)}</span>` : ""}
          </div>
          <h2 class="question-text">${escapeHtml(question.prompt)}</h2>
          <div class="option-list">
            ${options}
          </div>
          ${feedback}
          <div class="quiz-actions">
            ${previousButton}
            <div class="button-row">
              ${state.mode === "mock" ? `<button class="secondary-button" data-action="finish-mock" ${answeredCount() < state.questions.length ? "disabled" : ""}>Finish test</button>` : ""}
              ${nextButton}
            </div>
          </div>
        </article>
        ${mockPalette}
      </section>
    `,
    active
  );

  updateTimerDisplay();
}

function renderMissCards(items) {
  if (!items.length) {
    return `<div class="empty-state"><h2>No incorrect answers</h2><p class="muted">That is the clean result we like to see.</p></div>`;
  }

  return `
    <div class="miss-list">
      ${items
        .map(({ question, selected }) => {
          return `
            <article class="miss-card">
              <span class="pill">${escapeHtml(question.category)}</span>
              <h3>${escapeHtml(question.prompt || question.prompts[0])}</h3>
              <div class="answer-line">
                <span>Your answer: <span class="wrong-text">${escapeHtml(selected)}</span></span>
                <span>Correct answer: <span class="correct-text">${escapeHtml(question.answer)}</span></span>
              </div>
              <p>${escapeHtml(question.explanation)}</p>
              <p class="muted">${escapeHtml(question.section)}</p>
            </article>
          `;
        })
        .join("")}
    </div>
  `;
}

function renderResults() {
  const result = state.result;
  if (!result) {
    goHome();
    return;
  }

  const isMock = result.mode === "mock";
  const passed = isMock && result.score >= MOCK_PASS_MARK;
  const title = isMock ? (passed ? "Mock test passed" : "Mock test complete") : "Practice complete";
  const status = isMock ? (passed ? "Pass" : "Keep practising") : `${result.score} correct`;
  const wrongIds = result.incorrect.map((item) => item.question.id);

  renderShell(
    `
      <section class="result-hero">
        <p class="eyebrow">${escapeHtml(status)}</p>
        <h1>${escapeHtml(title)}</h1>
        <div class="score ${isMock ? (passed ? "pass" : "fail") : ""}">${result.score}/${result.total}</div>
        <p class="lede">${result.timedOut ? "The timer reached zero and the mock was submitted automatically." : "Your incorrect questions have been saved to History."}</p>
        <div class="result-stats">
          <div class="stat"><strong>${result.score}</strong><span>correct</span></div>
          <div class="stat"><strong>${result.incorrect.length}</strong><span>incorrect</span></div>
          <div class="stat"><strong>${isMock ? MOCK_PASS_MARK : result.total}</strong><span>${isMock ? "mock pass mark" : "questions attempted"}</span></div>
        </div>
        <div class="button-row">
          <button class="primary-button" data-action="${isMock ? "restart-mock" : "restart-practice"}">${isMock ? "New mock test" : "Practise again"}</button>
          <button class="secondary-button" data-action="practice-result-misses" ${wrongIds.length ? "" : "disabled"}>Practise misses</button>
          <button class="ghost-button" data-action="history">History</button>
        </div>
      </section>
      ${renderMissCards(result.incorrect)}
    `,
    isMock ? "mock" : "practice"
  );
}

function renderHistory() {
  const allHistory = groupedHistory();
  const categories = ["All", ...new Set(QUESTION_BANK.map((question) => question.category))];
  const query = state.historyQuery.trim().toLowerCase();
  const filtered = allHistory.filter((item) => {
    const matchesCategory = state.historyCategory === "All" || item.category === state.historyCategory;
    const haystack = `${item.prompt} ${item.correct} ${item.explanation} ${item.section}`.toLowerCase();
    return matchesCategory && (!query || haystack.includes(query));
  });

  const categoryOptions = categories
    .map(
      (category) => `<option value="${escapeHtml(category)}" ${state.historyCategory === category ? "selected" : ""}>${escapeHtml(category)}</option>`
    )
    .join("");

  const list = filtered.length
    ? `
      <div class="history-grid history-list">
        ${filtered
          .map((item) => {
            const date = item.missedAt ? new Date(item.missedAt).toLocaleString([], { dateStyle: "medium", timeStyle: "short" }) : "Unknown date";
            return `
              <article class="history-card">
                <span class="pill">${escapeHtml(item.category)}</span>
                <h3>${escapeHtml(item.prompt)}</h3>
                <div class="answer-line">
                  <span>Last answer: <span class="wrong-text">${escapeHtml(item.selected)}</span></span>
                  <span>Correct answer: <span class="correct-text">${escapeHtml(item.correct)}</span></span>
                </div>
                <p>${escapeHtml(item.explanation)}</p>
                <p class="muted">${escapeHtml(item.section)} - missed ${item.times} time${item.times === 1 ? "" : "s"} - ${escapeHtml(date)}</p>
                <button class="secondary-button" data-action="retry-one" data-question-id="${escapeHtml(item.questionId)}">Practise this</button>
              </article>
            `;
          })
          .join("")}
      </div>
    `
    : `<div class="empty-state"><h2>No saved mistakes</h2><p class="muted">Incorrect answers from practice and mock tests will appear here.</p></div>`;

  renderShell(
    `
      <section class="result-hero">
        <p class="eyebrow">History</p>
        <h1>Incorrect question review</h1>
        <p class="lede">Saved misses stay in this browser so you can come back to the topics that need another pass.</p>
      </section>
      <section class="history-controls" aria-label="History controls">
        <input type="search" data-action="history-search" value="${escapeHtml(state.historyQuery)}" placeholder="Search questions, answers or explanations" />
        <select data-action="history-category" aria-label="Filter by category">${categoryOptions}</select>
        <div class="button-row">
          <button class="primary-button" data-action="practice-history" ${allHistory.length ? "" : "disabled"}>Practise history</button>
          <button class="danger-button" data-action="clear-history" ${allHistory.length ? "" : "disabled"}>Clear</button>
        </div>
      </section>
      ${list}
    `,
    "history"
  );
}

function render() {
  if (state.view === "home") renderHome();
  if (state.view === "quiz") renderQuiz();
  if (state.view === "results") renderResults();
  if (state.view === "history") renderHistory();
}

app.addEventListener("click", (event) => {
  const control = event.target.closest("[data-action]");
  if (!control || control.disabled) return;

  const action = control.dataset.action;
  if (action === "home" && confirmLeaveSession()) goHome();
  if (action === "history" && confirmLeaveSession()) goHistory();
  if (action === "nav-practice" && confirmLeaveSession()) startPractice(state.practiceCount);
  if (action === "nav-mock" && confirmLeaveSession()) startMock();
  if (action === "start-practice") startPractice(state.practiceCount);
  if (action === "start-mock") startMock();
  if (action === "choose-option") chooseOption(Number(control.dataset.optionIndex));
  if (action === "next-question") nextQuestion();
  if (action === "previous-question") previousQuestion();
  if (action === "goto-question") {
    state.index = Number(control.dataset.index);
    render();
  }
  if (action === "finish-mock") submitMock(false);
  if (action === "restart-mock") startMock();
  if (action === "restart-practice") startPractice(state.practiceCount);
  if (action === "practice-result-misses") {
    const ids = state.result?.incorrect.map((item) => item.question.id) || [];
    startPractice(Math.min(40, ids.length), ids);
  }
  if (action === "practice-history") {
    const ids = groupedHistory().map((item) => item.questionId);
    startPractice(Math.min(40, ids.length), ids);
  }
  if (action === "retry-one") startPractice(1, [control.dataset.questionId]);
  if (action === "clear-history" && window.confirm("Clear all saved incorrect questions?")) {
    saveHistory([]);
    render();
  }
});

app.addEventListener("change", (event) => {
  if (event.target.name === "practice-count") {
    state.practiceCount = Number(event.target.value);
  }

  if (event.target.dataset.action === "history-category") {
    state.historyCategory = event.target.value;
    render();
  }
});

app.addEventListener("input", (event) => {
  if (event.target.dataset.action === "history-search") {
    const cursor = event.target.selectionStart;
    state.historyQuery = event.target.value;
    render();
    const search = document.querySelector('[data-action="history-search"]');
    if (search) {
      search.focus();
      search.setSelectionRange(cursor, cursor);
    }
  }
});

render();
