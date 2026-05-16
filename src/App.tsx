import { useState } from 'react';

const stageOneChecklist = [
  'Electron shell starts on Windows and hosts the renderer.',
  'Vault selection flow is available from the first screen.',
  'Renderer, main, and preload layers are isolated for later Stage 2 work.',
  'Architecture and setup docs are captured in the repo.',
];

export default function App() {
  const [vaultPath, setVaultPath] = useState<string | null>(null);
  const [isPicking, setIsPicking] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  async function handleSelectVault() {
    setIsPicking(true);
    setErrorMessage(null);

    try {
      const selectedPath = await window.crashWeaver.selectVaultFolder();
      setVaultPath(selectedPath);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unexpected vault selection error.';
      setErrorMessage(message);
    } finally {
      setIsPicking(false);
    }
  }

  return (
    <main className="shell">
      <section className="hero">
        <p className="eyebrow">Stage 1 / Planning & Setup</p>
        <h1>CrashWeaver</h1>
        <p className="summary">
          Electron desktop shell for an AI-assisted Obsidian knowledge workflow. This Stage 1 build
          proves the core app boot path and the vault-folder entry point required for later file I/O.
        </p>

        <div className="actions">
          <button className="primaryButton" onClick={handleSelectVault} disabled={isPicking}>
            {isPicking ? 'Opening folder picker...' : 'Select Vault Folder'}
          </button>
          <span className="statusPill">Windows-ready dev scaffold</span>
        </div>

        <div className="vaultCard">
          <p className="label">Selected vault</p>
          <p className="pathValue">{vaultPath ?? 'No vault selected yet.'}</p>
          {errorMessage ? <p className="errorText">{errorMessage}</p> : null}
        </div>
      </section>

      <section className="contentGrid">
        <article className="panel">
          <h2>Architecture Slice</h2>
          <ul>
            <li>Electron main process owns native windowing and folder selection.</li>
            <li>Preload exposes a minimal IPC bridge into the renderer.</li>
            <li>React renderer becomes the landing area for Stage 2 vault workflows.</li>
          </ul>
        </article>

        <article className="panel">
          <h2>Stage 1 Acceptance</h2>
          <ul>
            {stageOneChecklist.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </article>
      </section>
    </main>
  );
}
