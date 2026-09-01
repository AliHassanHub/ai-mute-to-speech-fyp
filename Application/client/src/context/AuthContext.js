import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import * as SecureStore from 'expo-secure-store';
import { authApi, profileApi } from '../services/api';
import { initApiConfig } from '../services/apiConfig';
import { getErrorMessage } from '../utils/apiHelpers';
import { resetNotificationSessionState } from '../services/notificationService';

const TOKEN_KEY = 'auth_token';
const USER_KEY = 'auth_user';

const AuthContext = createContext(null);

async function readStoredAuth() {
  try {
    const [token, userJson] = await Promise.all([
      SecureStore.getItemAsync(TOKEN_KEY),
      SecureStore.getItemAsync(USER_KEY),
    ]);
    if (!token) return { token: null, user: null };
    const user = userJson ? JSON.parse(userJson) : null;
    return { token, user };
  } catch {
    return { token: null, user: null };
  }
}

async function persistAuth(token, user) {
  await SecureStore.setItemAsync(TOKEN_KEY, token);
  await SecureStore.setItemAsync(USER_KEY, JSON.stringify(user));
}

async function clearStoredAuth() {
  await Promise.all([
    SecureStore.deleteItemAsync(TOKEN_KEY),
    SecureStore.deleteItemAsync(USER_KEY),
  ]);
}

export function AuthProvider({ children }) {
  const [token, setToken] = useState(null);
  const [user, setUser] = useState(null);
  const [isBootstrapping, setIsBootstrapping] = useState(true);

  useEffect(() => {
    let mounted = true;
    (async () => {
      await initApiConfig();
      const stored = await readStoredAuth();
      if (!mounted) return;
      if (stored.token) {
        try {
          const data = await authApi.me(stored.token);
          setToken(stored.token);
          setUser(data.user ?? stored.user);
        } catch {
          await clearStoredAuth();
        }
      }
      if (mounted) setIsBootstrapping(false);
    })();
    return () => {
      mounted = false;
    };
  }, []);

  const applyAuth = useCallback(async (nextToken, nextUser) => {
    setToken(nextToken);
    setUser(nextUser);
    await persistAuth(nextToken, nextUser);
  }, []);

  const login = useCallback(async (email, password) => {
    const data = await authApi.login(email, password);
    await applyAuth(data.token, data.user);
    return data;
  }, [applyAuth]);

  const completeSignup = useCallback(
    async (email, otp, password) => {
      await authApi.verifyEmail(email, otp);
      if (password) {
        return login(email, password);
      }
      return { success: true, message: 'Account created successfully.' };
    },
    [login]
  );

  const refreshUser = useCallback(async () => {
    if (!token) return null;
    const data = await profileApi.get(token);
    const nextUser = data.user ?? data;
    setUser(nextUser);
    await SecureStore.setItemAsync(USER_KEY, JSON.stringify(nextUser));
    return nextUser;
  }, [token]);

  const updateUser = useCallback(async (partial) => {
    setUser((prev) => {
      const next = { ...prev, ...partial };
      SecureStore.setItemAsync(USER_KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  const logout = useCallback(async () => {
    try {
      if (token) await profileApi.logout(token);
    } catch {
    } finally {
      setToken(null);
      setUser(null);
      resetNotificationSessionState();
      await clearStoredAuth();
    }
  }, [token]);

  const value = useMemo(
    () => ({
      token,
      user,
      isAuthenticated: Boolean(token),
      isBootstrapping,
      login,
      completeSignup,
      refreshUser,
      updateUser,
      logout,
      getErrorMessage,
    }),
    [token, user, isBootstrapping, login, completeSignup, refreshUser, updateUser, logout]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return context;
}
