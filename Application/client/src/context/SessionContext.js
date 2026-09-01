import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { inferenceApi, recordingApi, sessionApi, ApiError } from '../services/api';
import { getTargetLanguageFromUser } from '../utils/apiHelpers';
import { normalizeSessionResult } from '../utils/sessionResult';
import { isBufferingResponse, mergePersistedWordResult, normalizeWordPrediction } from '../utils/aiPrediction';
import { releaseAiWindow } from '../services/aiInferenceService';
import { useAuth } from './AuthContext';

const SessionContext = createContext(null);

export function SessionProvider({ children }) {
  const { token, user } = useAuth();
  const [sessionId, setSessionId] = useState(null);
  const [lastResult, setLastResult] = useState(null);

  const getTargetLanguage = useCallback(() => {
    return getTargetLanguageFromUser(user);
  }, [user]);

  const ensureSession = useCallback(
    async (deviceName = 'ESP32_EMG_SENSOR') => {
      if (!token) throw new Error('Not authenticated.');
      if (sessionId) return sessionId;

      const current = await sessionApi.getCurrent(token);
      if (current.session?.sessionId) {
        setSessionId(current.session.sessionId);
        return current.session.sessionId;
      }

      const started = await sessionApi.start(deviceName, token).catch(async (error) => {
        if (error instanceof ApiError && error.status === 409) {
          const retry = await sessionApi.getCurrent(token);
          if (retry.session?.sessionId) return { session: retry.session };
        }
        throw error;
      });
      const id = started.session?.sessionId ?? started.session?.session_id;
      setSessionId(id);
      return id;
    },
    [token, sessionId]
  );

  const saveRecording = useCallback(
    async ({
      rawSignalData,
      durationMs,
      channelCount = 2,
      samplingRate = 50,
      signalLabel = null,
    }) => {
      if (!token) throw new Error('Not authenticated.');
      const activeSessionId = await ensureSession();
      const data = await recordingApi.save(
        {
          sessionId: activeSessionId,
          rawSignalData,
          channelCount,
          samplingRate,
          durationMs,
          signalLabel,
        },
        token
      );
      return data.recording;
    },
    [token, ensureSession]
  );

  const processAndRecognize = useCallback(
    async ({ recordingId, targetLanguage, minConfidence = 0.68 }) => {
      if (!token) throw new Error('Not authenticated.');

      const data = await inferenceApi.inferRecording(
        recordingId,
        {
          targetLanguage: targetLanguage ?? getTargetLanguage(),
          minConfidence,
        },
        token
      );

      const result = normalizeSessionResult({
        ...data.result,
        prediction: data.prediction,
      });

      setLastResult(result);
      return result;
    },
    [token, getTargetLanguage]
  );

  /**
   * Predict a word from a completed sample window.
   *
   * Talks only to the Node backend, using the existing authenticated request
   * layer. React Native never contacts the Python service directly.
   *
   * Session adaptation is optional and off by default, matching the verified
   * backend path. When a profile exists the backend applies it automatically
   * from the authenticated identity, so no session id is sent here.
   */
  const predictWordFromWindow = useCallback(
    async ({ rows, minConfidence } = {}) => {
      if (!token) throw new Error('Not authenticated.');
      if (!Array.isArray(rows) || rows.length === 0) {
        throw new Error('No signal window to predict from.');
      }

      try {
        const data = await inferenceApi.predictWord(rows, { minConfidence }, token);

        // The backend answers { ready: false } when the window is short. That is
        // a buffering state, not a failure, and must not be shown as an error.
        if (isBufferingResponse(data)) {
          releaseAiWindow({ allowRetry: true });
          return {
            buffering: true,
            requiredSamples: data.requiredSamples ?? null,
            receivedSamples: data.receivedSamples ?? rows.length,
          };
        }

        const result = normalizeWordPrediction(data);
        releaseAiWindow();
        setLastResult(result);
        return result;
      } catch (error) {
        // Free the in-flight lock but keep the window so a transient failure
        // can be retried without losing the captured samples.
        releaseAiWindow({ allowRetry: true });
        throw error;
      }
    },
    [token]
  );

  const saveWordResult = useCallback(
    async ({
      rows,
      result,
      durationMs,
      signalLabel = null,
      minConfidence,
      textId = null,
    }) => {
      if (!token) throw new Error('Not authenticated.');
      if (!Array.isArray(rows) || rows.length === 0) {
        throw new Error('No signal window to save.');
      }

      const data = await inferenceApi.persistWord(
        rows,
        {
          minConfidence,
          targetLanguage: getTargetLanguage(),
          durationMs,
          signalLabel,
          textId,
        },
        token
      );

      if (!data?.persisted) {
        throw new Error(data?.message || 'Result was not saved to history.');
      }

      const merged = mergePersistedWordResult(result, data);
      if (data.sessionId) {
        setSessionId(data.sessionId);
      }
      setLastResult(merged);
      return merged;
    },
    [token, getTargetLanguage]
  );

  const completeSession = useCallback(
    async (wordCount = 1, averageConfidence = 90) => {
      if (!token || !sessionId) return;
      await sessionApi.complete(sessionId, wordCount, averageConfidence, token);
      setSessionId(null);
    },
    [token, sessionId]
  );

  const resetSession = useCallback(() => {
    setSessionId(null);
    setLastResult(null);
  }, []);

  const value = useMemo(
    () => ({
      sessionId,
      lastResult,
      ensureSession,
      saveRecording,
      processAndRecognize,
      predictWordFromWindow,
      saveWordResult,
      completeSession,
      resetSession,
      getTargetLanguage,
    }),
    [
      sessionId,
      lastResult,
      ensureSession,
      saveRecording,
      processAndRecognize,
      predictWordFromWindow,
      saveWordResult,
      completeSession,
      resetSession,
      getTargetLanguage,
    ]
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession() {
  const context = useContext(SessionContext);
  if (!context) {
    throw new Error('useSession must be used within SessionProvider');
  }
  return context;
}
