import React, { createContext, useState, useCallback, useContext, useRef } from 'react';

const ToastContext = createContext(null);

const DEFAULT_DURATION = 3000;

export function ToastProvider({ children }) {
  const [state, setState] = useState({ visible: false, message: '' });
  const timerRef = useRef(null);

  const hide = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    setState((s) => ({ ...s, visible: false }));
  }, []);

  const showToast = useCallback(
    (message, duration = DEFAULT_DURATION) => {
      if (timerRef.current) clearTimeout(timerRef.current);
      setState({ visible: true, message });
      timerRef.current = setTimeout(hide, duration);
    },
    [hide]
  );

  return (
    <ToastContext.Provider value={{ ...state, showToast, hideToast: hide }}>
      {children}
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within ToastProvider');
  return ctx;
}
