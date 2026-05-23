const templates = [
  { id: "template-1", label: "Template 1", hint: "Segmented tabs", navClass: "tab-style-segmented" },
  { id: "template-2", label: "Template 2", hint: "Sidebar tabs", navClass: "tab-style-sidebar" },
  { id: "template-3", label: "Template 3", hint: "Pill tabs", navClass: "tab-style-pills" },
  { id: "template-4", label: "Template 4", hint: "Underline tabs", navClass: "tab-style-underline" },
  { id: "template-5", label: "Template 5", hint: "Card tabs", navClass: "tab-style-cards" },
  { id: "template-6", label: "Template 6", hint: "Step tabs", navClass: "tab-style-steps" },
  { id: "template-7", label: "Template 7", hint: "Icon tabs", navClass: "tab-style-icons" },
  { id: "template-8", label: "Template 8", hint: "Split nav", navClass: "tab-style-split" },
  { id: "template-9", label: "Template 9", hint: "Compact tabs", navClass: "tab-style-compact" },
  { id: "template-10", label: "Template 10", hint: "Dense tabs", navClass: "tab-style-dense" },
];

const views = [
  { id: "content", label: "Content", icon: "C" },
  { id: "memory", label: "Memory Technique", icon: "T" },
  { id: "qna", label: "QnA", icon: "Q" },
  { id: "fiib", label: "Fill-in-the-blanks", icon: "F" },
  { id: "meta", label: "Meta data", icon: "M" },
];

const card = {
  uid: "CW-MOCK-UNIVERSAL-301",
  topic: "Adaptive Retry Budgeting",
  type: ["systems", "reliability", "decision-model"],
  raw_content: [
    "### Why adaptive retry budgets matter",
    "",
    "When services fail transiently, clients often retry too aggressively.",
    "Adaptive retry budgeting prevents collapse by tuning retry behavior to observed error rates.",
    "",
    "- Maintain a **global retry budget** per request family.",
    "- Spend budget only when confidence of transient failure is high.",
    "- Pair retries with **jitter** and bounded queues.",
    "",
    "Reference architecture image:",
    "",
    "![Retry Budget Diagram](https://images.unsplash.com/photo-1518770660439-4636190af475?auto=format&fit=crop&w=1000&q=80)",
    "",
    "Further reading: [Google SRE Book](https://sre.google/sre-book/handling-overload/) and [AWS retry guidelines](https://docs.aws.amazon.com/general/latest/gr/api-retries.html).",
  ].join("\n"),
  metadata: {
    familiarity: 2,
    last_reviewed: "2026-05-20",
    next_review: "2026-05-29",
    created_at: "2026-05-21T10:14:00Z",
    updated_at: "2026-05-22T07:31:00Z",
  },
  referenced_in: [
    { note_path: "notes/systems/retry-budget.md", start_line: 41, end_line: 129 },
    { note_path: "notes/architecture/traffic-guardrails.md", start_line: 12, end_line: 58 },
  ],
  memory_tricks: {
    memory_technique: "Remember 'RBC': Retry Budget, Backoff, Circuit-breaker.",
    qa_pairs: [
      {
        question: "Why is jitter mandatory when many clients retry simultaneously?",
        answer: "Jitter de-synchronizes retries and prevents coordinated retry storms.",
      },
      {
        question: "What does a retry budget protect against?",
        answer: "It caps retry amplification and preserves upstream availability.",
      },
      {
        question: "When should retries be skipped entirely?",
        answer: "On permanent failures or when idempotency cannot be guaranteed.",
      },
    ],
    fill_in_the_blanks: [
      {
        prompt: "Use exponential ____ plus random ____ to reduce retry synchronization.",
        answer: "backoff, jitter",
      },
      {
        prompt: "A shared retry ____ ensures clients cannot endlessly amplify traffic.",
        answer: "budget",
      },
    ],
  },
};

const picker = document.getElementById("templatePicker");
const canvas = document.getElementById("templateCanvas");
const llmTemplate = document.getElementById("llmTemplate");
const llmScope = document.getElementById("llmScope");
const llmElement = document.getElementById("llmElement");
const llmHint = document.getElementById("llmHint");

let currentTemplate = templates[0].id;
let currentView = "content";

function escapeHtml(text) {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function focusHintFor(scope, elementKey) {
  if (!scope || !elementKey) {
    return "Focus card body for general conversation, or select a specific exercise item for targeted testing.";
  }

  if (scope === "qna") {
    return `LLM should quiz user on ${elementKey} within this card.`;
  }

  if (scope === "fiib") {
    return `LLM should test fill-in-the-blanks for ${elementKey}.`;
  }

  if (scope === "raw-content") {
    return "LLM should discuss markdown content and linked references in the raw text.";
  }

  return "LLM should converse in the context of this current card.";
}

function setFocusContext(scope, elementKey) {
  llmScope.textContent = scope || "card";
  llmElement.textContent = elementKey || "card.general";
  llmHint.textContent = focusHintFor(scope, elementKey);
}

function getViewNavigationMarkup(template) {
  const navButtons = views
    .map((view, index) => {
      const isActive = view.id === currentView;
      return `
        <button
          type="button"
          class="tab-button card-focusable ${isActive ? "active" : ""}"
          data-view="${view.id}"
          data-scope="view-tab"
          data-element-key="view.${view.id}"
          tabindex="0"
        >
          <span class="tab-icon">${view.icon}</span>
          <span class="tab-label">${view.label}</span>
          ${template.navClass === "tab-style-steps" ? `<span class="tab-step">${index + 1}</span>` : ""}
        </button>
      `;
    })
    .join("");

  return `
    <nav class="tab-nav ${template.navClass}" aria-label="Card views">
      ${navButtons}
    </nav>
  `;
}

function getContentViewMarkup() {
  return `
    <section class="tab-panel card-focusable" tabindex="0" data-scope="raw-content" data-element-key="raw_content.markdown">
      <h4>Content View (raw_content as markdown)</h4>
      <div class="raw-content"><div id="markdownMount"></div></div>
    </section>
  `;
}

function getQnaViewMarkup() {
  const qnaRows = card.memory_tricks.qa_pairs
    .map((pair, index) => {
      const key = `qna.${index + 1}`;
      return `
        <article class="exercise-row card-focusable" tabindex="0" data-scope="qna" data-element-key="${key}">
          <p><strong>Q${index + 1}.</strong> ${escapeHtml(pair.question)}</p>
          <p class="qa-answer answer-hidden" data-answer="${key}">${escapeHtml(pair.answer)}</p>
          <button type="button" class="button reveal-btn" data-target-answer="${key}">Reveal Answer</button>
        </article>
      `;
    })
    .join("");

  return `
    <section class="tab-panel card-focusable" tabindex="0" data-scope="qna" data-element-key="memory_tricks.qa_pairs">
      <h4>QnA View</h4>
      <div class="exercise-list">${qnaRows}</div>
    </section>
  `;
}

function getMemoryViewMarkup() {
  return `
    <section class="tab-panel card-focusable" tabindex="0" data-scope="memory-technique" data-element-key="memory_tricks.memory_technique">
      <h4>Memory Technique View</h4>
      <div class="memory-technique">
        <p>${escapeHtml(card.memory_tricks.memory_technique)}</p>
      </div>
    </section>
  `;
}

function getFiibViewMarkup() {
  const fiibRows = card.memory_tricks.fill_in_the_blanks
    .map((entry, index) => {
      const key = `fiib.${index + 1}`;
      return `
        <article class="exercise-row card-focusable" tabindex="0" data-scope="fiib" data-element-key="${key}">
          <p><strong>FIIB ${index + 1}.</strong> ${escapeHtml(entry.prompt)}</p>
          <p class="qa-answer answer-hidden" data-answer="${key}">${escapeHtml(entry.answer)}</p>
          <button type="button" class="button reveal-btn" data-target-answer="${key}">Reveal Answer</button>
        </article>
      `;
    })
    .join("");

  return `
    <section class="tab-panel card-focusable" tabindex="0" data-scope="fiib" data-element-key="memory_tricks.fill_in_the_blanks">
      <h4>Fill-in-the-blanks View</h4>
      <div class="exercise-list">${fiibRows}</div>
    </section>
  `;
}

function getMetaViewMarkup() {
  const refs = card.referenced_in
    .map((entry, index) => {
      const key = `reference.${index + 1}`;
      return `
        <li class="meta-item card-focusable" tabindex="0" data-scope="reference" data-element-key="${key}">
          <p class="meta-key">Ref ${index + 1}</p>
          <p class="meta-value">${escapeHtml(entry.note_path)}:${entry.start_line}-${entry.end_line}</p>
        </li>
      `;
    })
    .join("");

  return `
    <section class="tab-panel card-focusable" tabindex="0" data-scope="meta" data-element-key="card.metadata">
      <h4>Meta data View</h4>

      <div class="meta-grid">
        <div class="meta-item card-focusable" tabindex="0" data-scope="metadata" data-element-key="metadata.familiarity">
          <p class="meta-key">familiarity</p>
          <p class="meta-value">${card.metadata.familiarity}/5</p>
        </div>
        <div class="meta-item card-focusable" tabindex="0" data-scope="metadata" data-element-key="metadata.last_reviewed">
          <p class="meta-key">last_reviewed</p>
          <p class="meta-value">${escapeHtml(card.metadata.last_reviewed)}</p>
        </div>
        <div class="meta-item card-focusable" tabindex="0" data-scope="metadata" data-element-key="metadata.next_review">
          <p class="meta-key">next_review</p>
          <p class="meta-value">${escapeHtml(card.metadata.next_review)}</p>
        </div>
        <div class="meta-item card-focusable" tabindex="0" data-scope="metadata" data-element-key="metadata.created_at">
          <p class="meta-key">created_at</p>
          <p class="meta-value">${escapeHtml(card.metadata.created_at)}</p>
        </div>
        <div class="meta-item card-focusable" tabindex="0" data-scope="metadata" data-element-key="metadata.updated_at">
          <p class="meta-key">updated_at</p>
          <p class="meta-value">${escapeHtml(card.metadata.updated_at)}</p>
        </div>
      </div>

      <section class="reference-list card-focusable" tabindex="0" data-scope="reference" data-element-key="referenced_in">
        <h4>referenced_in</h4>
        <ul class="meta-grid">${refs}</ul>
      </section>
    </section>
  `;
}

function getActiveViewMarkup() {
  if (currentView === "memory") {
    return getMemoryViewMarkup();
  }

  if (currentView === "qna") {
    return getQnaViewMarkup();
  }

  if (currentView === "fiib") {
    return getFiibViewMarkup();
  }

  if (currentView === "meta") {
    return getMetaViewMarkup();
  }

  return getContentViewMarkup();
}

function getCardMarkup(templateId) {
  const template = templates.find((entry) => entry.id === templateId);

  return `
    <section class="template-root ${template.navClass}">
      <header class="template-header">
        <div>
          <h2>${template.label}</h2>
          <p class="muted">Universal card renderer with 5 card views and focus-aware exercise context.</p>
        </div>
        <span class="template-badge">${template.hint}</span>
      </header>

      <article class="card-frame card-focusable" tabindex="0" data-scope="card" data-element-key="card.general">
        <div class="card-toolbar card-focusable" tabindex="0" data-scope="header" data-element-key="card.header">
          <h3>${escapeHtml(card.topic)}</h3>
          <div class="chips">
            <span class="chip">UID ${escapeHtml(card.uid)}</span>
            ${card.type.map((entry) => `<span class="chip">${escapeHtml(entry)}</span>`).join("")}
          </div>
        </div>

        ${getViewNavigationMarkup(template)}

        <div class="card-main">
          ${getActiveViewMarkup()}
        </div>
      </article>
    </section>
  `;
}

function clearFocused() {
  for (const item of canvas.querySelectorAll(".focus-active")) {
    item.classList.remove("focus-active");
  }
}

function wireInteractions() {
  const markdownMount = document.getElementById("markdownMount");
  if (markdownMount) {
    markdownMount.innerHTML = marked.parse(card.raw_content, { breaks: true });
  }

  for (const tabButton of canvas.querySelectorAll(".tab-button")) {
    tabButton.addEventListener("click", (event) => {
      currentView = event.currentTarget.getAttribute("data-view");
      renderTemplate(currentTemplate);
      setFocusContext("view-tab", `view.${currentView}`);
    });
  }

  for (const revealButton of canvas.querySelectorAll(".reveal-btn")) {
    revealButton.addEventListener("click", (event) => {
      const targetKey = event.currentTarget.getAttribute("data-target-answer");
      const answerNode = canvas.querySelector(`[data-answer="${targetKey}"]`);
      const isHidden = answerNode.classList.contains("answer-hidden");
      answerNode.classList.toggle("answer-hidden", !isHidden);
      event.currentTarget.textContent = isHidden ? "Hide Answer" : "Reveal Answer";
    });
  }

  for (const focusable of canvas.querySelectorAll(".card-focusable")) {
    const handler = () => {
      clearFocused();
      focusable.classList.add("focus-active");
      const scope = focusable.getAttribute("data-scope");
      const elementKey = focusable.getAttribute("data-element-key");
      setFocusContext(scope, elementKey);
    };

    focusable.addEventListener("click", handler);
    focusable.addEventListener("focus", handler);
  }
}

function renderTemplate(templateId) {
  currentTemplate = templateId;
  llmTemplate.textContent = templates.find((entry) => entry.id === templateId).label;
  canvas.innerHTML = getCardMarkup(templateId);
  setFocusContext("view-tab", `view.${currentView}`);
  wireInteractions();

  for (const button of picker.querySelectorAll(".pick")) {
    button.classList.toggle("active", button.dataset.template === templateId);
  }
}

function initPicker() {
  for (const entry of templates) {
    const button = document.createElement("button");
    button.className = "pick";
    button.dataset.template = entry.id;
    button.innerHTML = `${entry.label}<span>${entry.hint}</span>`;
    button.addEventListener("click", () => renderTemplate(entry.id));
    picker.appendChild(button);
  }
}

initPicker();
renderTemplate(currentTemplate);