import { useEffect, useMemo, useState } from "react";
import { AppState, View } from "react-native";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { NavigationBar } from "expo-navigation-bar";
import { deviceLang, LangContext, strings, type Lang } from "../lib/i18n";
import { SessionProvider } from "../lib/session";
import { store } from "../lib/storage";
import { flush } from "../lib/queue";
import { colors, serif } from "../lib/theme";
import { ScanButton } from "../components/ScanButton";

export default function RootLayout() {
  const [lang, setLangState] = useState<Lang>(deviceLang());
  useEffect(() => {
    void store.getJson<Lang | null>("rve.lang", null).then((l) => l && setLangState(l));
    // Send any check-ins saved while offline whenever the app comes back to the foreground.
    void flush();
    const sub = AppState.addEventListener("change", (st) => {
      if (st === "active") void flush();
    });
    return () => sub.remove();
  }, []);
  const value = useMemo(
    () => ({
      lang,
      t: strings[lang],
      setLang: (l: Lang) => {
        setLangState(l);
        void store.setJson("rve.lang", l);
      },
    }),
    [lang],
  );
  return (
    <LangContext.Provider value={value}>
      <SessionProvider>
        <StatusBar style="dark" />
        {/* Android: the system navigation bar is see-through over the cream app, with dark buttons (app.json plugin turns off the grey scrim). */}
        <NavigationBar style="light" />
        <View style={{ flex: 1, backgroundColor: colors.background }}>
          <Stack
            screenOptions={{
              headerStyle: { backgroundColor: colors.background },
              headerTintColor: colors.greenDark,
              headerTitleStyle: { fontFamily: serif, fontWeight: "700" },
              headerShadowVisible: false,
              contentStyle: { backgroundColor: colors.background },
            }}
          >
            <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
            <Stack.Screen name="item/[id]" options={{ title: "" }} />
            <Stack.Screen name="package/[id]" options={{ title: value.t.packages }} />
            <Stack.Screen name="login" options={{ title: value.t.loginTitle, presentation: "modal" }} />
            <Stack.Screen name="member" options={{ headerShown: false }} />
            <Stack.Screen name="scan" options={{ title: value.t.scan }} />
          </Stack>
          <ScanButton />
        </View>
      </SessionProvider>
    </LangContext.Provider>
  );
}
