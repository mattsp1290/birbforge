import React, {createContext, useContext, useState, type ReactNode} from 'react';
import {Pressable, StyleSheet, Text, TextInput, View, type StyleProp, type TextInputProps, type TextStyle} from 'react-native';

const light = {
  bg: '#f6f5f0', panel: '#ffffff', text: '#222824', muted: '#59665e', line: '#d3d9d0',
  accent: '#235947', onAccent: '#ffffff', tint: '#e4ede4', danger: '#9d3e32',
};
const dark: typeof light = {
  bg: '#151d19', panel: '#202a24', text: '#f0f2e9', muted: '#adbcb1', line: '#3c4940',
  accent: '#b0d7b7', onAccent: '#132c20', tint: '#2d4033', danger: '#ffb1a4',
};

export type Session = {endpoint: string; access: import('./access').ClientAccess};
const UIContext = createContext({colors: light, largeText: false});
export const useUI = () => useContext(UIContext);

export function UIProvider({darkMode, largeText, children}: {darkMode: boolean; largeText: boolean; children: ReactNode}) {
  return <UIContext.Provider value={{colors: darkMode ? dark : light, largeText}}>{children}</UIContext.Provider>;
}
export function Heading({children}: {children: ReactNode}) {
  const {colors, largeText} = useUI();
  return <Text accessibilityRole="header" style={{color: colors.text, fontWeight: '600', fontSize: largeText ? 26 : 20}}>{children}</Text>;
}
export function Body({children, muted, style}: {children: ReactNode; muted?: boolean; style?: StyleProp<TextStyle>}) {
  const {colors, largeText} = useUI();
  return <Text style={[{color: muted ? colors.muted : colors.text, fontSize: largeText ? 20 : 15, lineHeight: largeText ? 29 : 23}, style]}>{children}</Text>;
}
export function Card({children}: {children: ReactNode}) {
  const {colors} = useUI();
  return <View style={[styles.card, {backgroundColor: colors.panel, borderColor: colors.line}]}>{children}</View>;
}
export function Action({label, onPress, disabled = false, secondary = false, selected = false}: {
  label: string; onPress: () => void; disabled?: boolean; secondary?: boolean; selected?: boolean;
}) {
  const {colors, largeText} = useUI();
  const [focused, setFocused] = useState(false);
  const filled = !secondary || selected;
  return <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{selected, disabled}} disabled={disabled}
    onPress={onPress} onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
    style={({pressed}) => [styles.button, {backgroundColor: filled ? colors.accent : colors.panel,
      borderColor: filled ? colors.accent : colors.line, opacity: disabled ? 0.5 : pressed ? 0.76 : 1},
      focused && {outlineColor: colors.text, outlineWidth: 3, outlineOffset: 2, outlineStyle: 'solid'}]}>
    <Text style={{color: filled ? colors.onAccent : colors.text, fontSize: largeText ? 19 : 14, fontWeight: '600'}}>{label}</Text>
  </Pressable>;
}
export function Field({label, style, ...props}: TextInputProps & {label: string}) {
  const {colors, largeText} = useUI();
  return <View style={{gap: 7}}>
    <Body style={{fontWeight: '600'}}>{label}</Body>
    <TextInput accessibilityLabel={label} placeholderTextColor={colors.muted} autoCapitalize="none" autoCorrect={false}
      {...props} style={[styles.field, {color: colors.text, backgroundColor: colors.bg, borderColor: colors.line, fontSize: largeText ? 20 : 16}, style]} />
  </View>;
}
const styles = StyleSheet.create({
  card: {padding: 20, borderRadius: 14, gap: 14, borderWidth: 1},
  button: {maxWidth: '100%', minHeight: 44, paddingHorizontal: 17, paddingVertical: 9,
    borderRadius: 8, borderWidth: 1, alignSelf: 'flex-start', alignItems: 'center', justifyContent: 'center'},
  field: {minHeight: 48, paddingHorizontal: 13, paddingVertical: 10, borderWidth: 1, borderRadius: 8},
});
