import { useEffect, useState } from 'react';

export type Route = 'analyse' | 'research' | 'library' | 'stats' | 'about';
const ROUTES: Route[] = ['analyse', 'research', 'library', 'stats', 'about'];

function parse(): Route {
  const h = window.location.hash.replace(/^#\/?/, '').split('?')[0] as Route;
  return ROUTES.includes(h) ? h : 'analyse';
}

export function useHashRoute(): Route {
  const [route, setRoute] = useState<Route>(parse);
  useEffect(() => {
    const on = () => setRoute(parse());
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return route;
}
