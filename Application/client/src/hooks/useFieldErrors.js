import { useState, useCallback } from 'react';

export function useFieldErrors(initial = {}) {
  const [errors, setErrors] = useState(initial);

  const clearFieldError = useCallback((field) => {
    setErrors((prev) => {
      if (!prev[field]) return prev;
      const next = { ...prev };
      delete next[field];
      return next;
    });
  }, []);

  const setMultiple = useCallback((errorMap) => {
    const cleaned = Object.fromEntries(
      Object.entries(errorMap).filter(([, message]) => Boolean(message))
    );
    setErrors(cleaned);
  }, []);

  return { errors, clearFieldError, setMultiple };
}
