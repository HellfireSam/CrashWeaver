/**
 * WelcomeSurface — what the editor pane shows before a vault is opened.
 *
 * The app used to open onto a leftover scratch note when no vault was loaded,
 * which read as stale test data. This surface replaces it with the one action
 * that matters (open a vault), a secondary route to settings, and a short
 * explanation of the three things the app does.
 */
import { AppIcon } from './AppIcon';

type WelcomeSurfaceProps = {
  onOpenVault: () => void;
  onOpenSettings: () => void;
  isOpening: boolean;
};

const FEATURES = [
  {
    icon: 'layers',
    title: 'Crashpad',
    body: 'Compose Crash Cards and arrange them before they land in a note.',
  },
  {
    icon: 'sparkles',
    title: 'Vault',
    body: 'Edit notes; the Weaver proposes changes you review before anything is written.',
  },
  {
    icon: 'repeat',
    title: 'Review',
    body: 'Rate due cards; the next review date is scheduled from your answer.',
  },
] as const;

export function WelcomeSurface({ onOpenVault, onOpenSettings, isOpening }: WelcomeSurfaceProps) {
  return (
    <div className="welcomeSurface">
      <div className="welcomeCard">
        <div className="welcomeMark" aria-hidden="true">
          <AppIcon name="book" />
        </div>
        <h1 className="welcomeTitle">CrashWeaver</h1>
        <p className="welcomeTagline">
          Turn an Obsidian vault into a knowledge base of Crash Cards: author them, weave them into
          notes, and review them when they are due.
        </p>

        <div className="welcomeActions">
          <button
            type="button"
            className="actionButton primary welcomeOpenButton"
            onClick={onOpenVault}
            disabled={isOpening}
          >
            {isOpening ? 'Choosing folder…' : 'Open a vault'}
          </button>
          <button type="button" className="actionButton" onClick={onOpenSettings}>
            Settings
          </button>
        </div>

        <ul className="welcomeFeatures">
          {FEATURES.map((feature) => (
            <li className="welcomeFeature" key={feature.title}>
              <span className="welcomeFeatureIcon" aria-hidden="true">
                <AppIcon name={feature.icon} />
              </span>
              <span className="welcomeFeatureBody">
                <strong>{feature.title}</strong>
                <span>{feature.body}</span>
              </span>
            </li>
          ))}
        </ul>

        <p className="welcomeHint">
          A vault is a folder of markdown notes. CrashWeaver reads and writes only inside it, and
          nothing is written without your approval.
        </p>
      </div>
    </div>
  );
}
