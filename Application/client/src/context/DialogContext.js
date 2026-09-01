import React, { createContext, useState, useCallback, useContext, useMemo } from 'react';

const DialogContext = createContext(null);

export function DialogProvider({ children }) {
  const [state, setState] = useState({
    visible: false,
    title: '',
    description: '',
    buttons: [],
  });

  const show = useCallback(({ title = '', description = '', buttons = [{ text: 'OK', onPress: () => {} }] }) => {
    setState({ visible: true, title, description, buttons });
  }, []);

  const hide = useCallback(() => {
    setState((s) => ({ ...s, visible: false }));
  }, []);

  const value = useMemo(
    () => ({ ...state, show, hide }),
    [state, show, hide]
  );

  return (
    <DialogContext.Provider value={value}>
      {children}
    </DialogContext.Provider>
  );
}

export function useDialog() {
  const ctx = useContext(DialogContext);
  if (!ctx) throw new Error('useDialog must be used within DialogProvider');
  return ctx;
}
