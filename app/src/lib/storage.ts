import * as SecureStore from "expo-secure-store";
import AsyncStorage from "@react-native-async-storage/async-storage";

/** Tokens go in the device keychain; everything else in plain app storage. */
export const secure = {
  get: (k: string) => SecureStore.getItemAsync(k),
  set: (k: string, v: string) => SecureStore.setItemAsync(k, v),
  del: (k: string) => SecureStore.deleteItemAsync(k),
};

export const store = {
  async getJson<T>(k: string, fallback: T): Promise<T> {
    try {
      const v = await AsyncStorage.getItem(k);
      return v ? (JSON.parse(v) as T) : fallback;
    } catch {
      return fallback;
    }
  },
  setJson: (k: string, v: unknown) => AsyncStorage.setItem(k, JSON.stringify(v)),
};
