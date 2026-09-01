import { useCallback, useMemo } from 'react';
import { useAuth } from '../context/AuthContext';
import { calibrationApi, inferenceApi } from '../services/api';
import { buildWordStatusMap, summarizePersonalization } from '../utils/calibrationCapture';

export function useCalibration() {
  const { token } = useAuth();

  const getStatus = useCallback(async () => {
    if (!token) {
      return { isCalibrated: false };
    }
    return calibrationApi.status(token);
  }, [token]);

  const getActiveCalibration = useCallback(async () => {
    if (!token) {
      return null;
    }
    return calibrationApi.get(token);
  }, [token]);

  const getProfile = useCallback(async () => {
    if (!token) {
      return { success: true, hasProfile: false, words: [], neutral: null };
    }
    return calibrationApi.getProfile(token);
  }, [token]);

  const getModelVocabulary = useCallback(async () => {
    if (!token) {
      return [];
    }
    const health = await inferenceApi.aiHealth(token);
    return Array.isArray(health.labels)
      ? health.labels.map((label) => String(label).toLowerCase())
      : [];
  }, [token]);

  const loadCalibrationDashboard = useCallback(async () => {
    const [profile, legacyStatus] = await Promise.all([
      getProfile(),
      getStatus(),
    ]);
    const vocabulary =
      Array.isArray(profile?.vocabulary) && profile.vocabulary.length > 0
        ? profile.vocabulary.map((label) => String(label).toLowerCase())
        : await getModelVocabulary();
    const words = buildWordStatusMap(profile, vocabulary);
    const calibratedCount = words.filter((item) => item.userPersonalized).length;
    const summary = summarizePersonalization(words);
    const hasBaseline = Boolean(profile?.neutral?.baselineAdc != null);
    const isCalibrated =
      calibratedCount > 0 || Boolean(legacyStatus?.isCalibrated);

    return {
      profile,
      vocabulary,
      words,
      calibratedCount,
      totalWords: vocabulary.length,
      summary,
      hasBaseline,
      isCalibrated,
    };
  }, [getProfile, getModelVocabulary, getStatus]);

  const saveCalibration = useCallback(
    async (baselineValue, thresholdLevel, calibrationData) => {
      if (!token) {
        throw new Error('Not authenticated.');
      }
      return calibrationApi.save(baselineValue, thresholdLevel, calibrationData, token);
    },
    [token]
  );

  const saveNeutralBaseline = useCallback(
    async (captures) => {
      if (!token) {
        throw new Error('Not authenticated.');
      }
      return calibrationApi.saveNeutral(captures, token);
    },
    [token]
  );

  const calibrateWord = useCallback(
    async (word, captures, idempotencyKey = null) => {
      if (!token) {
        throw new Error('Not authenticated.');
      }
      return calibrationApi.calibrateWord(word, captures, token, idempotencyKey);
    },
    [token]
  );

  return useMemo(
    () => ({
      getStatus,
      getActiveCalibration,
      getProfile,
      getModelVocabulary,
      loadCalibrationDashboard,
      saveCalibration,
      saveNeutralBaseline,
      calibrateWord,
    }),
    [
      getStatus,
      getActiveCalibration,
      getProfile,
      getModelVocabulary,
      loadCalibrationDashboard,
      saveCalibration,
      saveNeutralBaseline,
      calibrateWord,
    ]
  );
}
