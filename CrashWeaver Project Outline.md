# Project Outline: AI-Enhanced Obsidian Knowledge App

This project is an **external desktop/web app** that manages an Obsidian-style note vault to support structured learning with AI assistance. The vault itself is a local folder of Markdown files (the “vault”), where each note is a `.md` file. Content is organized by Obsidian conventions: internal links (`[[Other Note]]`), tags (`#theorem`), etc.  Notably, Obsidian-style *tags* are just `#`-prefixed words in the text. For example, to label a note or block as a “math theorem,” the user would include `#theorem` in the Markdown【56†L1-L5】.  We will use this same convention for the “type of knowledge” field of each block.  In Markdown, **comments** (ignored in preview) are written with double-percent (`%%...%%`) markers【8†L167-L170】; we will store the memory-trick data and scheduling metadata inside such hidden comments in each note so it doesn’t affect normal rendering. 

**Vault Format & Comments:** An Obsidian vault is simply a folder of Markdown notes. Each knowledge item (theorem, fact, code snippet, etc.) will eventually reside as a section in a Markdown file. Memory aids and metadata will be embedded as `%%commented%%` blocks. Obsidian’s syntax guide shows that wrapping text in `%%…%%` hides it from preview【8†L167-L170】, which we leverage.  In practice, each knowledge block will have a visible part (the raw text and tags) and a hidden comment part with memory exercises and scheduling data. For example:

```md
Here is some knowledge about {{topic}}.  
%% METADATA: { "familiarity": 0.7, "next_review": "2026-05-20" } %%
```

## 1. Architecture Choice: External App vs Plugin

Rather than building an Obsidian *plugin*, we choose an **external application** (likely an Electron or web-based app). This insulates our code from Obsidian’s internal updates and allows us to manage the vault via file I/O ourselves. We will rely on the browser File System Access API (or a desktop wrapper) to open and edit the local vault. Modern Chromium browsers (Chrome, Edge, Brave) support the File System Access API: the user can **select the vault directory once** and then the app can read/write Markdown files in it【43†L259-L261】.  However, browser-based solutions have caveats: Firefox currently **does not support** this API (Mozilla decided not to implement it due to consent/privacy concerns【46†L152-L161】), and Safari’s support is limited. Because of this, a **desktop app (Electron)** may be preferable for consistency. Electron embeds Chromium, giving guaranteed FileSystem API support, and can package the app for Mac/Windows/Linux. 

Once the user selects (or configures) the vault folder, the app will maintain a handle to it (e.g. in IndexedDB【43†L259-L261】) so the user doesn’t have to re-select each time【43†L259-L261】. We must implement lazy-loading of files: the FileSystem API can handle thousands of files, but we should *not* load the entire vault tree into memory at once. Instead, follow best practice: load directory listings on demand, virtualize long lists of files, and cache recently-used notes【40†L202-L210】. (A Reddit-based analysis notes that performance bottlenecks are in rendering/DOM updates, not raw I/O【40†L202-L210】.) 

**Key Points on File Access:**  
- Use the File System Access API (via Electron) to **read/write Markdown** in the vault.  
- Store the directory handle persistently (IndexedDB) to avoid repeated prompts【43†L259-L261】.  
- Because Firefox/Safari lack this API, either restrict to Chromium or use a native fallback.  

## 2. LLM Integration Options

The app heavily relies on large language models (LLMs) for processing user input and guiding learning. We consider two categories: **local models** (run on-device) and **cloud APIs**. 

- **Local LLM (Ollama or similar):** Ollama is an open-source runner that can host models like LLaMA or Mistral on the user’s machine. It provides a local HTTP API (e.g. `http://localhost:11434/api/chat`) for chat-like prompts【19†L109-L118】. For example, the app’s backend (Node.js) can `fetch` the Ollama endpoint with `{model: 'llama3', messages: [...], stream: false}` to get a chat response【19†L109-L118】. This runs fully offline (no keys needed), giving privacy and no usage fees.  **Example:** a Node/React chatbot tutorial uses Ollama locally with no third-party keys【19†L48-L52】【19†L109-L118】. The drawback is that local models may be slower or weaker than cloud LLMs (depending on hardware), but newer models (7B+ parameters) can run on modern PCs (e.g. M-series Macs). 

- **Cloud LLM APIs:** Well-known APIs like OpenAI’s GPT-4 or GPT-3.5, Google’s PaLM2/Vertex, or others can be used by calling their endpoints. For instance, OpenAI provides a Node.js SDK (`npm install openai`) and sample code for chat completions【16†L280-L289】. Hugging Face also offers inference endpoints for many models: the `@huggingface/inference` JavaScript library can call any hosted model by name, across providers【21†L190-L199】.  Using cloud APIs requires API keys and incurs cost per request. It can provide more powerful models and ensures up-to-date knowledge, but requires internet and key management. 

In our design, the user could choose to point to an Ollama server (local) or supply a cloud API key. The code will be modular: for example, a **LLM service layer** that can call either `ollama` (via HTTP) or `openai` (via their SDK/REST) or other. 

**Citing Examples:** The OpenAI Node quickstart repo demonstrates calling the chat endpoint using their SDK【16†L280-L289】. The Ollama tutorial shows a Node backend doing `fetch('http://localhost:11434/api/chat', {model: 'llama3', messages})`【19†L109-L118】. The Hugging Face JS docs list an `inference.chatCompletion({model, provider, messages})` method that can route requests to many model hosts【21†L190-L199】. We will likely use existing NPM libraries (e.g. `openai`, `@huggingface/inference`) or simple `fetch/axios` calls, depending on technology choice.  

## 3. Data Model: Knowledge Blocks & Metadata

Each **knowledge block** represents one item of information the user learned (e.g. a theorem, a code snippet, a fact). We define a data model with fields:

- **ID / UID:** A unique identifier for the block (could be generated or based on timestamp).  
- **Type/Tags:** Obsidian-style tags (e.g. `#calculus`, `#nutrition`) indicating the category or type of knowledge【56†L1-L5】.  
- **Raw Content:** The factual text or explanation of the knowledge.  
- **Memory Tricks:** A sub-structure holding three parts:  
  1. **Q&A pairs:** One or more question-answer prompts based on the knowledge (e.g. “Q: What is the derivative of sin(x)? A: cos(x)”).  
  2. **Hint / Short Reminder:** A brief mnemonic phrase or keyword.  
  3. **Cloze/FIB Exercise:** A sentence with a blank, e.g. “The capital of France is [Paris].”  

- **Scheduling Metadata:** Data for spaced repetition, including: “last reviewed date,” “familiarity score,” and “next review due.”  

In practice, when writing to a Markdown note, the *visible part* will include the tags and raw content. The **Memory Tricks and Metadata** will go into a hidden comment block (`%% … %%`) or as YAML frontmatter (but we prefer comment so it stays attached to the text). For example:

```md
### #calculus Theorem
**Fundamental Theorem of Calculus:** If f is continuous on [a,b], then ∫_a^b f(x) dx = F(b) – F(a), where F’=f.  
  
%%MEMORY 
Q: What does the Fundamental Theorem of Calculus relate? | A: Integral of f equals F(b)-F(a).  
Hint: ∫ and F'.  
Fill: ∫_a^b f(x) dx = F(__) – F(__).  
%%META {"last": "2026-05-01","familiarity":0.8,"next":"2026-06-01"}%%
```

This way, the Markdown renders the theorem normally, but our app can parse the `%%…%%` comment to extract the Q/A, hint, cloze, and meta JSON.

**Global Index (JSON):** In addition to in-note comments, we maintain an external JSON database mapping block IDs to file paths and core metadata. This is similar to some Obsidian plugins that store flashcard schedules in JSON. For example, the *obsidian-spaced-repetition-recall* plugin uses a separate JSON file to hold review data (it “uses separate json data file” for scheduling)【29†L386-L389】. We will keep, say, `index.json` in a fixed location in the vault. Each entry might look like: 
```json
{
  "block_id": "20260515-1",
  "file": "Calculus.md",
  "line": 42,
  "tags": ["calculus","theorem"],
  "last_review": "2026-05-01",
  "familiarity": 0.8,
  "next_review": "2026-06-01"
}
```
This makes it easy to quickly find all scheduled reviews without scanning every note.

## 4. UI/UX Flows

### 4.1 Daily Note Entry
- **Screen:** The app shows a “Daily Note” editor (like Obsidian’s daily note). The user picks a date (default today) and enters all new knowledge from that day. For each knowledge item, we present a **form** with fields: (a) *Tags* (user types or selects one or more tags), (b) *Content* (raw text), and (c) *Memory Tricks*, which can be broken into sub-fields (Question / Answer, Hint text, Cloze statement). The interface encourages the user to fill each part but the LLM can assist (see next).
- **LLM Assistance:** Beside or below each field, a button “Refine with AI” can invoke the LLM. For example, after the user writes a draft theorem, clicking “Refine” sends it to an LLM prompt: “Check correctness and clarity, and help create a question-answer pair and mnemonic hint.” The LLM’s response populates or improves the Q/A, hint, etc. This ensures consistency: each block ends up in the proper format. (This mimics how tools like NotebookLM turn notes into structured content【57†L5-L8】, but here it’s user-triggered refinement.) We don’t need a specific citation here, but the idea is similar to Google’s NotebookLM summarizing user notes.

### 4.2 Saving Daily Note → Splitting Blocks
- When the user saves the daily note, the app **parses** the Markdown, identifies each knowledge entry (we can mark them with a delimiter or heading), and splits them into blocks. Each block is then saved as follows: 
  - The block content is appended (or inserted via LLM guidance) into an existing topic file or a new file. For example, a #calculus theorem might go into `Calculus.md`. We could use an LLM or keyword match to pick an existing file (e.g. if `#calculus` tag is new, create `Calculus.md`).  
  - The memory-trick fields are written as hidden comments in that file as shown above.  
  - Metadata JSON is updated accordingly.  
  - In effect, the daily note is both a working area and a feeder that distributes new blocks into the vault. This could be implemented with a Markdown parser and editor component on the frontend, and a Node.js script to update files.  

### 4.3 Knowledge Block Viewer
- **Screen:** When viewing any note, a side-pane or separate window (“Knowledge Block Viewer”) lists all knowledge blocks in the current note. It pulls out the blocks (including their memory content) and displays them in a quiz-like interface. For each block, the UI shows the question(s) or fill-in prompt (with answers hidden until needed), and an input area for the user’s attempt.
- **Interactive Review:** The user can attempt each memory trick: e.g., answer the question or fill in the blank. Upon submission, the app checks the answer using the underlying data (or again, using an LLM for leniency/spell-check). For example, if the block has “Q: What is 2+2? A: 4”, the user input “four” would be marked correct. We might use a simple string match or an LLM (ChatGPT) to allow synonyms or handle minor typos. The app then reveals the correct answer and can optionally explain it using the LLM if the user struggled. This gives immediate feedback and clarifies misunderstandings.
- **Progress Tracking:** After each attempt, we update the block’s `familiarity` score and set a new `last_review` date. The UI highlights blocks due for review (see spaced repetition below).  

_No explicit citations here:_ this flow is based on standard flashcard app UX (e.g. Anki, Quizlet), combined with AI assistance. It fulfills the requirement “LLM should follow the memory trick arguments and help assess the user’s understanding.”

## 5. Spaced-Repetition Scheduling

We will implement a spaced-repetition algorithm to schedule reviews of each block. Each block’s metadata (in the comment and JSON) includes a **familiarity** score (0–1) and history of reviews. A proven approach is to use an adaptive scheduling algorithm like **FSRS** (Free Spaced Repetition System), which several Obsidian tools now use【29†L386-L393】. For simplicity, we can start with the classic SM-2 algorithm (as in Anki) or a basic Leitner approach, then migrate to FSRS-based formula for smarter timing. 

**Workflow:** Each day, the app consults all blocks’ metadata and uses the scheduling algorithm to mark which blocks are due for review. For example, any block whose `next_review` ≤ today’s date will be listed in the daily review queue. The main interface or a notification prompts the user with “Review X blocks for today.” In the Knowledge Block Viewer, these blocks are highlighted or pre-sorted for practice. 

**Data Storage:** We keep scheduling data both in the Markdown comments (for context) and in our `index.json`. As seen in existing solutions, storing review logs in a separate JSON is feasible【29†L386-L393】. After each review session, we update the familiarity and compute the next interval. For instance, if a user recalls a block easily, its next-review date moves farther out; if they struggle, it’s scheduled sooner. All this state is saved so that across sessions the algorithm adapts. 

By managing this metadata in comments and a central JSON, the app can both present cues in-note and efficiently find due items for scheduling, just as some Obsidian flashcard plugins do【29†L386-L393】.

## 6. Implementation Plan & Project Structure

- **Tech Stack:** We recommend **Electron** (Chromium + Node) with a React or Vue frontend in TypeScript. Electron provides cross-platform GUI with direct file system access. TypeScript ensures type safety for complex data models. Alternatively, a web-based PWA could be built, but as noted, only Chromium browsers fully support file I/O【46†L152-L161】. 

- **Directories:** A possible repo structure:
  - `src/`: main source code  
    - `electronMain.ts` – sets up the Electron app, menus, native dialogs.  
    - `renderer/` – React components and views.  
      - `DailyNoteEditor.tsx` – UI for entering daily knowledge.  
      - `BlockViewer.tsx` – UI for reviewing blocks.  
      - `Settings.tsx` – choose vault path, LLM settings.  
    - `backend/` – Node modules for file/LLM logic.  
      - `vault.ts` – functions to read/write Markdown in the vault (using Node FS or FileSystem API).  
      - `parser.ts` – split daily note into blocks and merge into topic files.  
      - `llmService.ts` – wrapper to call selected LLM (Ollama or API).  
      - `srs.ts` – scheduling algorithm (e.g. FSRS implementation).  
      - `dataModel.ts` – TypeScript interfaces for Block, Metadata, JSON index.  
  - `public/` – static files, icons, etc.  
  - `index.json` – the knowledge-index (could be auto-generated on first run).  

- **Workflow Summary:** On startup, prompt the user to **select the vault folder** (or load from settings). Then display the main screen (Daily Note) with date picker. The user inputs knowledge and uses AI refinement as needed. On save, the app processes the note, updates files and index. The user can then click “Review” to open the block viewer, practice the due items, and the app updates the schedule. 

- **Build/Deployment:** Package with Electron builder to create desktop installers. Include a simple updater. No server is needed; the app is offline-first except when using cloud LLMs. Ensure proper error handling if vault path is moved or LLM calls fail. 

- **Testing:** Automated tests for the parser (making sure blocks split correctly) and for the scheduling logic. Integration tests to verify that entering a daily note results in correct file updates.  

## 7. Additional Features

Beyond the core functions, other useful features might include:

- **Search/Navigation:** Ability to search tags or topics within the app and jump to notes.  
- **Markdown Preview:** A pane to preview the formatted note (like Obsidian’s preview).  
- **Tag and File Management:** GUI to create new topic files or reorganize blocks between notes.  
- **Analytics:** Simple stats (e.g. review streak, total cards learned).  
- **Sync Integration:** If the vault is on Dropbox/Obsidian Sync, ensure file locking or merging is handled gracefully.  
- **Customization:** Settings for the LLM model, review intervals, or themes (dark/light).  

These are optional extensions that enhance usability but can be added iteratively.

## 8. Sources

This outline uses Obsidian’s own documentation and community resources.  For instance, Obsidian’s help confirms that wrapping text in `%%…%%` creates hidden comments【8†L167-L170】, and tags are entered with a leading `#`【56†L1-L5】.  Details of the File System Access API (including storing directory handles in IndexedDB) come from MDN Web Docs【43†L259-L261】, and browser support concerns (Firefox stance) are documented in Mozilla discussion【46†L152-L161】.  LLM integration approaches are guided by tutorials and docs: Ollama’s local API example【19†L109-L118】, OpenAI’s Node SDK examples【16†L280-L289】, and Hugging Face’s JS inference library【21†L190-L199】. Finally, the spaced-repetition plugin ecosystem (e.g. *obsidian-spaced-repetition-recall*) shows that keeping a separate JSON for scheduling is a viable strategy【29†L386-L393】.

