import { useEffect, useState } from 'react';
import { useRegisterSW } from 'virtual:pwa-register/react';
import { t } from '../i18n';
import { useT } from '../i18n/react';

/** How often an open app checks for a new version (ms). */
const CHECK_EVERY = 60 * 60 * 1000;

/**
 * Registers the service worker (production builds only) and tells the user when the app can work
 * offline, or when a new version is ready (it waits for a click, so training is never interrupted).
 */
export function AppUpdate() {
  useT();
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    offlineReady: [offlineReady, setOfflineReady],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(_url, reg) {
      if (reg) window.setInterval(() => void reg.update().catch(() => undefined), CHECK_EVERY);
    },
  });

  useEffect(() => {
    if (!offlineReady) return;
    const id = window.setTimeout(() => setOfflineReady(false), 6000);
    return () => window.clearTimeout(id);
  }, [offlineReady, setOfflineReady]);

  if (!needRefresh && !offlineReady) return null;
  return (
    <div className="toast" role="status">
      <span>{needRefresh ? t('pwa.update') : t('pwa.offline')}</span>
      {needRefresh && (
        <button type="button" onClick={() => void updateServiceWorker(true)}>
          {t('pwa.reload')}
        </button>
      )}
      <button
        type="button"
        className="toast-close"
        aria-label={t('common.dismiss')}
        onClick={() => {
          setNeedRefresh(false);
          setOfflineReady(false);
        }}
      >
        ✕
      </button>
    </div>
  );
}

type InstallPrompt = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }> };

/** "Install" in the header, where the browser offers installing the app (Chrome, Edge, Android). */
export function InstallButton() {
  useT();
  const [prompt, setPrompt] = useState<InstallPrompt | null>(null);
  useEffect(() => {
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setPrompt(e as InstallPrompt);
    };
    const onInstalled = () => setPrompt(null);
    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);
  if (!prompt) return null;
  return (
    <button
      type="button"
      className="small"
      title={t('pwa.installHelp')}
      onClick={async () => {
        await prompt.prompt();
        await prompt.userChoice;
        setPrompt(null);
      }}
    >
      {t('pwa.install')}
    </button>
  );
}
