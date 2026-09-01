import React from 'react';
import { View, Text, StyleSheet, ScrollView, Image } from 'react-native';
import { GradientButton, GlassCard } from '../../components';
import { colors } from '../../theme/colors';
import spacing from '../../theme/spacing';
import typography from '../../theme/typography';

const LOGO_SIZE = 100;

export default function HomeScreen({ navigation }) {
  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
    >
      <View style={styles.hero}>
        <Image
          source={require('../../../assets/app-logo.png')}
          style={[styles.logoImage, { width: LOGO_SIZE, height: LOGO_SIZE }]}
          resizeMode="contain"
        />
        <Text style={styles.title}>AI Mute-to-Speech Translator</Text>
        <Text style={styles.subtitle}>Convert muscle signals into real-time speech.</Text>
      </View>

      <GlassCard style={styles.descriptionCard}>
        <Text style={styles.sectionTitle}>What this app does</Text>
        <Text style={styles.description}>
          This system captures EMG signals from facial and limb muscles, processes them with AI models, and translates
          them into readable text and synthesized speech for assistive communication.
        </Text>
      </GlassCard>

      <View style={styles.featuresRow}>
        <GlassCard style={styles.featureCard}>
          <Text style={styles.featureTitle}>EMG Detection</Text>
          <Text style={styles.featureBody}>Capture muscle activity with calibrated sensors.</Text>
        </GlassCard>
        <GlassCard style={styles.featureCard}>
          <Text style={styles.featureTitle}>AI Processing</Text>
          <Text style={styles.featureBody}>Neural models interpret EMG patterns.</Text>
        </GlassCard>
      </View>
      <View style={styles.featuresRow}>
        <GlassCard style={styles.featureCard}>
          <Text style={styles.featureTitle}>Text Output</Text>
          <Text style={styles.featureBody}>See recognized phrases in real time.</Text>
        </GlassCard>
        <GlassCard style={styles.featureCard}>
          <Text style={styles.featureTitle}>Speech Synthesis</Text>
          <Text style={styles.featureBody}>Hear generated speech for each session.</Text>
        </GlassCard>
      </View>

      <View style={styles.howItWorks}>
        <Text style={styles.sectionTitle}>How it works</Text>
        <Text style={styles.step}>1. Calibrate your EMG sensors</Text>
        <Text style={styles.step}>2. Record muscle activity while intending speech</Text>
        <Text style={styles.step}>3. Review recognized text and generated speech</Text>
      </View>

      <View style={styles.buttons}>
        <GradientButton
          title="Get Started"
          onPress={() => navigation.navigate('Auth', { screen: 'Login' })}
        />
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.xl,
  },
  hero: {
    alignItems: 'center',
    marginBottom: spacing.lg,
  },
  logoImage: { marginBottom: spacing.xl },
  title: {
    fontSize: typography.h2,
    fontWeight: typography.bold,
    color: colors.text,
    textAlign: 'center',
    marginBottom: spacing.md,
  },
  subtitle: {
    fontSize: typography.body,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  descriptionCard: {
    marginBottom: spacing.lg,
  },
  sectionTitle: {
    fontSize: typography.h3,
    fontWeight: typography.semiBold,
    color: colors.text,
    marginBottom: spacing.sm,
  },
  description: {
    fontSize: typography.body,
    color: colors.textSecondary,
    textAlign: 'center',
    lineHeight: 24,
  },
  featuresRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  featureCard: {
    flex: 1,
  },
  featureTitle: {
    fontSize: typography.caption,
    fontWeight: typography.semiBold,
    color: colors.text,
    marginBottom: spacing.xs,
  },
  featureBody: {
    fontSize: typography.small,
    color: colors.textSecondary,
  },
  howItWorks: {
    marginTop: spacing.lg,
    marginBottom: spacing.lg,
  },
  step: {
    fontSize: typography.small,
    color: colors.textSecondary,
    marginTop: spacing.xs,
  },
  buttons: { paddingBottom: spacing.xl },
});
