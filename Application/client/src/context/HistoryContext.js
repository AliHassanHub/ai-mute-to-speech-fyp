import React, { createContext, useCallback, useContext, useState } from 'react';
import { historyApi } from '../services/api';
import { formatHistoryDate, getErrorMessage } from '../utils/apiHelpers';
import { normalizeHistoryItem } from '../utils/sessionResult';
import { useAuth } from './AuthContext';

const HistoryContext = createContext(null);

export function HistoryProvider({ children }) {
  const { token } = useAuth();
  const [items, setItems] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);

  const fetchHistory = useCallback(async () => {
    if (!token) {
      setItems([]);
      setError(null);
      return;
    }
    setIsLoading(true);
    setError(null);
    try {
      const data = await historyApi.list(1, 50, token);
      setItems(
        (data.history ?? []).map((item) => ({
          ...normalizeHistoryItem(item),
          date: formatHistoryDate(item.createdAt ?? item.recordingDate),
        }))
      );
    } catch (err) {
      setItems([]);
      setError(getErrorMessage(err));
    } finally {
      setIsLoading(false);
    }
  }, [token]);

  const removeItem = useCallback(
    async (id) => {
      if (!token) {
        setItems((prev) => prev.filter((i) => i.id !== id));
        return;
      }
      await historyApi.delete(id, token);
      setItems((prev) => prev.filter((i) => i.id !== String(id)));
    },
    [token]
  );

  return (
    <HistoryContext.Provider value={{ items, isLoading, error, fetchHistory, removeItem }}>
      {children}
    </HistoryContext.Provider>
  );
}

export function useHistory() {
  const context = useContext(HistoryContext);
  if (!context) {
    throw new Error('useHistory must be used within HistoryProvider');
  }
  return context;
}
