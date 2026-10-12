import { App, ConfigProvider, Segmented, Select, Space, theme as antdTheme, type ThemeConfig } from "antd";
import { ThemedLayout, ThemedTitle, useNotificationProvider } from "@refinedev/antd";
import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { qiyUiConfig } from "./theme-config";

export type QiyThemeKey = "blue" | "purple" | "green" | "orange" | "red";
export type QiyColorMode = "light" | "dark" | "system";

const themeRegistry: Record<QiyThemeKey, { label: string; token: ThemeConfig["token"] }> = {
  blue: { label: "Blue", token: { colorPrimary: "#1677ff" } },
  purple: { label: "Purple", token: { colorPrimary: "#722ed1" } },
  green: { label: "Green", token: { colorPrimary: "#389e0d" } },
  orange: { label: "Orange", token: { colorPrimary: "#d46b08" } },
  red: { label: "Red", token: { colorPrimary: "#cf1322" } },
};

interface QiyUiState {
  themeKey: QiyThemeKey;
  colorMode: QiyColorMode;
  resolvedColorMode: "light" | "dark";
  setThemeKey: (value: QiyThemeKey) => void;
  setColorMode: (value: QiyColorMode) => void;
}

const QiyUiContext = createContext<QiyUiState | undefined>(undefined);
const themeStorageKey = "qiy.ui.theme";
const colorModeStorageKey = "qiy.ui.color-mode";

function initialTheme(): QiyThemeKey {
  if (typeof window === "undefined") return qiyUiConfig.theme;
  const stored = window.localStorage.getItem(themeStorageKey) as QiyThemeKey | null;
  return stored && (qiyUiConfig.themes as readonly string[]).includes(stored) ? stored : qiyUiConfig.theme;
}

function initialColorMode(): QiyColorMode {
  if (typeof window === "undefined") return qiyUiConfig.colorMode;
  const stored = window.localStorage.getItem(colorModeStorageKey);
  return stored === "light" || stored === "dark" || stored === "system" ? stored : qiyUiConfig.colorMode;
}

export function QiyUiProvider({ children, direction, locale }: { children: React.ReactNode; direction: "ltr" | "rtl"; locale: Parameters<typeof ConfigProvider>[0]["locale"] }) {
  const [themeKey, setThemeKey] = useState<QiyThemeKey>(initialTheme);
  const [colorMode, setColorMode] = useState<QiyColorMode>(initialColorMode);
  const [systemDark, setSystemDark] = useState(false);
  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const update = () => setSystemDark(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  useEffect(() => { window.localStorage.setItem(themeStorageKey, themeKey); }, [themeKey]);
  useEffect(() => { window.localStorage.setItem(colorModeStorageKey, colorMode); }, [colorMode]);
  const resolvedColorMode = colorMode === "system" ? (systemDark ? "dark" : "light") : colorMode;
  useEffect(() => {
    document.documentElement.dataset.theme = themeKey;
    document.documentElement.dataset.colorMode = resolvedColorMode;
    document.documentElement.style.colorScheme = resolvedColorMode;
  }, [resolvedColorMode, themeKey]);
  const contextValue = useMemo<QiyUiState>(() => ({ themeKey, colorMode, resolvedColorMode, setThemeKey, setColorMode }), [themeKey, colorMode, resolvedColorMode]);
  const selectedTheme = themeRegistry[themeKey];
  return <QiyUiContext.Provider value={contextValue}><ConfigProvider
    direction={direction}
    locale={locale}
    theme={{
      algorithm: resolvedColorMode === "dark" ? antdTheme.darkAlgorithm : antdTheme.defaultAlgorithm,
      token: { borderRadius: 6, ...selectedTheme.token },
    }}
  ><App>{children}</App></ConfigProvider></QiyUiContext.Provider>;
}

export function useQiyUi(): QiyUiState {
  const context = useContext(QiyUiContext);
  if (!context) throw new Error("useQiyUi must be used inside QiyUiProvider");
  return context;
}

export function QiyThemeControls() {
  const { themeKey, colorMode, setThemeKey, setColorMode } = useQiyUi();
  const themeOptions = qiyUiConfig.themes.map((key) => ({ value: key, label: themeRegistry[key].label }));
  return <Space wrap>
    {qiyUiConfig.allowThemeSwitch && themeOptions.length > 1 && <Select
      aria-label="Theme color"
      value={themeKey}
      onChange={(value) => setThemeKey(value)}
      options={themeOptions}
      style={{ minWidth: 112 }}
    />}
    {qiyUiConfig.allowColorModeSwitch && <Segmented
      aria-label="Color mode"
      value={colorMode}
      onChange={(value) => setColorMode(value as QiyColorMode)}
      options={[{ label: "Light", value: "light" }, { label: "Dark", value: "dark" }, { label: "System", value: "system" }]}
    />}
  </Space>;
}

export const QiyThemedLayout = ThemedLayout;
export const QiyThemedTitle = ThemedTitle;
export const useQiyNotificationProvider = useNotificationProvider;
