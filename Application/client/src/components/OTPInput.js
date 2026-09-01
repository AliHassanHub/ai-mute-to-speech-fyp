import React, { useRef, useState } from 'react';
import { View, TextInput, StyleSheet, Pressable } from 'react-native';
import { colors } from '../theme/colors';
import spacing from '../theme/spacing';
import typography from '../theme/typography';

const BOX_COUNT = 6;

export default function OTPInput({ value = '', onChange, length = BOX_COUNT }) {
  const inputs = useRef([]);
  const [focusedIndex, setFocusedIndex] = useState(0);

  const digits = Array.from({ length }, (_, i) => value[i] || '');

  const updateValue = (nextDigits) => {
    const code = nextDigits.join('').replace(/\D/g, '').slice(0, length);
    onChange(code);
    return code;
  };

  const focusAt = (index) => {
    const clamped = Math.max(0, Math.min(index, length - 1));
    inputs.current[clamped]?.focus();
    setFocusedIndex(clamped);
  };

  const handleChange = (text, index) => {
    const cleaned = text.replace(/\D/g, '');

    if (cleaned.length > 1) {
      const pasted = cleaned.slice(0, length).split('');
      const next = [...digits];
      pasted.forEach((d, i) => {
        if (index + i < length) next[index + i] = d;
      });
      const code = updateValue(next);
      focusAt(Math.min(index + pasted.length, length - 1));
      if (code.length === length) inputs.current[length - 1]?.blur();
      return;
    }

    const next = [...digits];
    next[index] = cleaned;
    const code = updateValue(next);

    if (cleaned && index < length - 1) {
      focusAt(index + 1);
    }
    if (code.length === length) inputs.current[length - 1]?.blur();
  };

  const handleKeyPress = (e, index) => {
    if (e.nativeEvent.key === 'Backspace' && !digits[index] && index > 0) {
      const next = [...digits];
      next[index - 1] = '';
      updateValue(next);
      focusAt(index - 1);
    }
  };

  return (
    <View style={styles.row}>
      {digits.map((digit, index) => {
        const isFocused = focusedIndex === index;
        return (
          <Pressable
            key={index}
            onPress={() => focusAt(index)}
            style={[styles.boxWrap, isFocused && styles.boxWrapFocused]}
          >
            <TextInput
              ref={(ref) => {
                inputs.current[index] = ref;
              }}
              style={[styles.box, isFocused && styles.boxFocused]}
              value={digit}
              onChangeText={(text) => handleChange(text, index)}
              onKeyPress={(e) => handleKeyPress(e, index)}
              onFocus={() => setFocusedIndex(index)}
              keyboardType="number-pad"
              maxLength={length}
              selectTextOnFocus
              caretHidden
            />
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  boxWrap: {
    flex: 1,
    borderRadius: 14,
    shadowColor: colors.shadow,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 2,
  },
  boxWrapFocused: {
    shadowOpacity: 0.18,
    shadowRadius: 12,
    elevation: 4,
  },
  box: {
    backgroundColor: colors.surface,
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: 14,
    minHeight: 56,
    textAlign: 'center',
    fontSize: typography.h3,
    fontWeight: typography.semiBold,
    color: colors.text,
    paddingVertical: spacing.sm,
  },
  boxFocused: {
    borderColor: colors.primary,
    backgroundColor: 'rgba(79, 70, 229, 0.04)',
  },
});
