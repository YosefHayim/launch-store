import { StatusBar } from 'expo-status-bar';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

const App = () => {
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
};

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

export default App;
