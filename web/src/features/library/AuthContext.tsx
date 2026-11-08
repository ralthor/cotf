import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, backendEnabled, getToken, setToken, type Me } from './api';

type AuthValue = {
  me: Me | null;
  loading: boolean;
  login: (username: string, password: string) => Promise<void>;
  register: (username: string, password: string, email?: string) => Promise<void>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
};

const Ctx = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(backendEnabled && !!getToken());

  const refresh = useCallback(async () => {
    if (!backendEnabled || !getToken()) {
      setMe(null);
      setLoading(false);
      return;
    }
    try {
      setMe(await api<Me>('auth/me/'));
    } catch {
      setMe(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!backendEnabled || !getToken()) return;
    let live = true;
    api<Me>('auth/me/')
      .then((m) => live && setMe(m), () => live && setMe(null))
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, []);

  const login = useCallback(async (username: string, password: string) => {
    const r = await api<{ token: string; user: Me }>('auth/login/', { method: 'POST', body: { username, password } });
    setToken(r.token);
    setMe(r.user);
  }, []);

  const register = useCallback(async (username: string, password: string, email?: string) => {
    const r = await api<{ token: string; user: Me }>('auth/register/', { method: 'POST', body: { username, password, email } });
    setToken(r.token);
    setMe(r.user);
  }, []);

  const logout = useCallback(async () => {
    await api('auth/logout/', { method: 'POST' }).catch(() => undefined);
    setToken(null);
    setMe(null);
  }, []);

  const value = useMemo(() => ({ me, loading, login, register, logout, refresh }), [me, loading, login, register, logout, refresh]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('useAuth must be used inside AuthProvider');
  return v;
}
