import { StatusBar } from 'expo-status-bar';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

/**
 * Hello World — a one-screen tap game. The point of this example is the Launch config wrapped around it
 * (see README.md for the full feature tour); the app itself only needs to build and run, so it stays a
 * single self-contained screen with no navigation or native modules.
 */
export default function App() {
  const [taps, setTaps] = useState(0);

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Hello World</Text>
      <Text style={styles.score}>{taps}</Text>
      <Pressable style={styles.button} onPress={() => setTaps((count) => count + 1)}>
        <Text style={styles.buttonText}>Tap me</Text>
      </Pressable>
      <StatusBar style="light" />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#0b1020',
    gap: 16,
  },
  title: { color: '#9bb4ff', fontSize: 28, fontWeight: '600' },
  score: { color: '#ffffff', fontSize: 72, fontWeight: '800', fontVariant: ['tabular-nums'] },
  button: {
    backgroundColor: '#3a5bff',
    paddingHorizontal: 32,
    paddingVertical: 14,
    borderRadius: 12,
  },
  buttonText: { color: '#ffffff', fontSize: 18, fontWeight: '600' },
});
