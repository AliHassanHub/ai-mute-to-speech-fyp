import React, { useCallback, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
} from 'react-native';
import { useDialog } from '../../context/DialogContext';
import { useToast } from '../../context/ToastContext';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { GlassCard } from '../../components';
import { useHistory } from '../../context/HistoryContext';
import { useAuth } from '../../context/AuthContext';
import { getErrorMessage, getSpeechLanguageFromUser } from '../../utils/apiHelpers';
import { enrichHistoryItemWithPhrases } from '../../utils/phraseResult';
import { playResultSpeech, stopSpeech } from '../../services/speechService';
import { colors } from '../../theme/colors';
import spacing from '../../theme/spacing';
import typography from '../../theme/typography';

export default function HistoryScreen({ navigation }) {
  const { items, isLoading, error, fetchHistory, removeItem } = useHistory();
  const { user } = useAuth();
  const dialog = useDialog();
  const { showToast } = useToast();
  const [playingId, setPlayingId] = useState(null);
  const [refreshing, setRefreshing] = useState(false);

  useFocusEffect(
    useCallback(() => {
      fetchHistory();
      return () => stopSpeech();
    }, [fetchHistory])
  );

  const handleRefresh = async () => {
    setRefreshing(true);
    await fetchHistory();
    setRefreshing(false);
  };

  const handlePlay = async (item) => {
    if (playingId === item.id) {
      stopSpeech();
      setPlayingId(null);
      showToast('Playback stopped.');
      return;
    }

    try {
      setPlayingId(item.id);
      await playResultSpeech({
        recognizedText: item.recognizedText,
        englishPhrase: item.englishPhrase,
        phraseTranslations: item.phraseTranslations,
        targetLanguage: item.targetLanguage,
        speechLanguage: getSpeechLanguageFromUser(user),
      });
      setPlayingId(null);
    } catch (error) {
      setPlayingId(null);
      showToast(error?.message || 'Speech playback failed.');
    }
  };

  const handleDelete = (item) => {
    dialog.show({
      title: 'Delete Recording',
      description: `Delete "${item.recognizedText}"?`,
      buttons: [
        { text: 'Cancel', style: 'cancel', onPress: () => {} },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              await removeItem(item.id);
              showToast('Recording deleted.');
            } catch (error) {
              dialog.show({
                title: 'Delete Failed',
                description: getErrorMessage(error),
                buttons: [{ text: 'OK', onPress: () => {} }],
              });
            }
          },
        },
      ],
    });
  };

  const renderItem = ({ item: rawItem }) => {
    const item = enrichHistoryItemWithPhrases(rawItem);

    return (
      <GlassCard style={styles.card}>
        <View style={styles.cardContent}>
          <TouchableOpacity
            style={styles.cardLeft}
            onPress={() =>
              navigation.navigate('Result', {
                result: {
                  recognizedText: item.recognizedText,
                  translatedText: item.translatedText,
                  targetLanguage: item.targetLanguage,
                  confidenceScore: item.confidenceScore,
                },
              })
            }
            activeOpacity={0.7}
          >
            <Text style={styles.date}>{item.date}</Text>
            <Text style={styles.sectionLabel}>Predicted Word</Text>
            <Text style={styles.text} numberOfLines={2}>
              {item.recognizedText}
            </Text>
            {item.englishPhrase ? (
              <>
                <Text style={styles.sectionLabel}>Related Phrase</Text>
                <Text style={styles.translatedText} numberOfLines={2}>
                  {item.englishPhrase}
                </Text>
              </>
            ) : null}
            <Text style={styles.sectionLabel}>Translated Phrase</Text>
            <Text style={styles.translatedText} numberOfLines={3}>
              {item.translatedPhrase ?? item.translatedText}
            </Text>
            <View style={styles.confidenceRow}>
              <View style={styles.confidenceBadge}>
                <Text style={styles.confidenceText}>{item.confidence}</Text>
                <Text style={styles.confidenceLabel}>confidence</Text>
              </View>
            </View>
          </TouchableOpacity>
          <View style={styles.cardRight}>
            <TouchableOpacity
              onPress={() => handlePlay(item)}
              activeOpacity={0.85}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            >
              <LinearGradient
                colors={[colors.primary, colors.secondary]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                style={styles.playButton}
              >
                <Ionicons
                  name={playingId === item.id ? 'pause' : 'play'}
                  size={24}
                  color={colors.surface}
                />
              </LinearGradient>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => handleDelete(item)}
              style={styles.deleteButton}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            >
              <Ionicons name="trash" size={22} color={colors.error} />
            </TouchableOpacity>
          </View>
        </View>
      </GlassCard>
    );
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>History</Text>
        <Text style={styles.subtitle}>Past recordings</Text>
      </View>
      {isLoading && items.length === 0 ? (
        <ActivityIndicator size="large" color={colors.primary} style={styles.loader} />
      ) : (
        <FlatList
          data={items}
          renderItem={renderItem}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={colors.primary} />
          }
          ListEmptyComponent={
            <View style={styles.emptyState}>
              <View style={styles.emptyIconWrap}>
                <Ionicons
                  name={error ? 'cloud-offline-outline' : 'mic-outline'}
                  size={48}
                  color={colors.textMuted}
                />
              </View>
              <Text style={styles.emptyTitle}>
                {error ? 'Could not load history' : 'No recordings yet'}
              </Text>
              <Text style={styles.emptySubtitle}>
                {error
                  ? error
                  : 'Complete an EMG recording session while logged in to see your results here.'}
              </Text>
              {error ? (
                <TouchableOpacity onPress={fetchHistory} style={styles.retryBtn}>
                  <Text style={styles.retryText}>Tap to retry</Text>
                </TouchableOpacity>
              ) : null}
            </View>
          }
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    backgroundColor: colors.surface,
  },
  title: {
    fontSize: typography.h2,
    fontWeight: typography.bold,
    color: colors.text,
  },
  subtitle: {
    fontSize: typography.body,
    color: colors.textSecondary,
    marginTop: spacing.xs,
  },
  loader: { marginTop: spacing.xxl },
  list: {
    padding: spacing.lg,
    paddingBottom: spacing.xxl,
  },
  card: {
    marginBottom: spacing.md,
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 16,
    padding: spacing.lg,
    shadowColor: colors.shadow,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.12,
    shadowRadius: 12,
    elevation: 4,
  },
  cardContent: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  cardLeft: {
    flex: 1,
    marginRight: spacing.md,
  },
  cardRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  date: {
    fontSize: typography.small,
    color: colors.textMuted,
    marginBottom: spacing.xs,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  sectionLabel: {
    fontSize: typography.caption,
    color: colors.textSecondary,
    marginTop: spacing.xs,
    marginBottom: 2,
  },
  text: {
    fontSize: typography.body,
    fontWeight: typography.semiBold,
    color: colors.text,
    lineHeight: 22,
  },
  translatedText: {
    fontSize: typography.body,
    color: colors.text,
    lineHeight: 22,
    marginBottom: spacing.xs,
  },
  confidenceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: spacing.sm,
  },
  confidenceBadge: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 4,
  },
  confidenceText: {
    fontSize: typography.caption,
    fontWeight: typography.semiBold,
    color: colors.accent,
  },
  confidenceLabel: {
    fontSize: typography.small,
    color: colors.textSecondary,
  },
  playButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: colors.primary,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 2,
  },
  deleteButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(239, 68, 68, 0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyState: {
    alignItems: 'center',
    paddingVertical: spacing.xxl,
    paddingHorizontal: spacing.xl,
  },
  emptyIconWrap: {
    width: 88,
    height: 88,
    borderRadius: 44,
    backgroundColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.lg,
  },
  emptyTitle: {
    fontSize: typography.h3,
    fontWeight: typography.semiBold,
    color: colors.text,
    marginBottom: spacing.xs,
  },
  emptySubtitle: {
    fontSize: typography.body,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  retryBtn: {
    marginTop: spacing.md,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
  },
  retryText: {
    fontSize: typography.body,
    color: colors.primary,
    fontWeight: typography.semiBold,
  },
});
