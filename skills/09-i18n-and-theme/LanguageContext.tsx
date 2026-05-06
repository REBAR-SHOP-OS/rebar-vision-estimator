import React, { createContext, useContext, useState, useCallback } from "react";

export type Language = "en" | "fa" | "fr" | "es" | "ar" | "de" | "zh" | "tr" | "hi" | "pt";

interface LanguageInfo {
  code: Language;
  name: string;
  nativeName: string;
  dir: "ltr" | "rtl";
}

export const LANGUAGES: LanguageInfo[] = [
  { code: "en", name: "English", nativeName: "English", dir: "ltr" },
  { code: "fa", name: "Persian", nativeName: "فارسی", dir: "rtl" },
  { code: "ar", name: "Arabic", nativeName: "العربية", dir: "rtl" },
  { code: "fr", name: "French", nativeName: "Français", dir: "ltr" },
  { code: "es", name: "Spanish", nativeName: "Español", dir: "ltr" },
  { code: "de", name: "German", nativeName: "Deutsch", dir: "ltr" },
  { code: "tr", name: "Turkish", nativeName: "Türkçe", dir: "ltr" },
  { code: "zh", name: "Chinese", nativeName: "中文", dir: "ltr" },
  { code: "hi", name: "Hindi", nativeName: "हिन्दी", dir: "ltr" },
  { code: "pt", name: "Portuguese", nativeName: "Português", dir: "ltr" },
];

type TranslationKeys =
  | "appTitle"
  | "newEstimation"
  | "projects"
  | "lightMode"
  | "darkMode"
  | "signOut"
  | "uploadBlueprints"
  | "startNewEstimation"
  | "welcomeMessage"
  | "refresh"
  | "language"
  | "estimation";

const translations: Record<Language, Record<TranslationKeys, string>> = {
  en: {
    appTitle: "Rebar Estimator Pro",
    newEstimation: "New Estimation",
    projects: "Projects",
    lightMode: "Light Mode",
    darkMode: "Dark Mode",
    signOut: "Sign Out",
    uploadBlueprints: "Upload your construction blueprints and get accurate rebar weight and wire mesh estimates powered by AI.",
    startNewEstimation: "Start New Estimation",
    welcomeMessage: "Rebar Estimator Pro",
    refresh: "Refresh",
    language: "Language",
    estimation: "Estimation",
  },
  fa: {
    appTitle: "ریبار استیمیتور پرو",
    newEstimation: "تخمین جدید",
    projects: "پروژه‌ها",
    lightMode: "حالت روشن",
    darkMode: "حالت تاریک",
    signOut: "خروج",
    uploadBlueprints: "نقشه‌های ساختمانی خود را آپلود کنید و تخمین دقیق وزن میلگرد و وایرمش را با هوش مصنوعی دریافت کنید.",
    startNewEstimation: "شروع تخمین جدید",
    welcomeMessage: "ریبار استیمیتور پرو",
    refresh: "بازنشانی",
    language: "زبان",
    estimation: "تخمین",
  },
  ar: {
    appTitle: "مقدر حديد التسليح برو",
    newEstimation: "تقدير جديد",
    projects: "المشاريع",
    lightMode: "الوضع الفاتح",
    darkMode: "الوضع الداكن",
    signOut: "تسجيل الخروج",
    uploadBlueprints: "قم بتحميل مخططات البناء الخاصة بك واحصل على تقديرات دقيقة لوزن حديد التسليح والشبك الملحوم بواسطة الذكاء الاصطناعي.",
    startNewEstimation: "بدء تقدير جديد",
    welcomeMessage: "مقدر حديد التسليح برو",
    refresh: "تحديث",
    language: "اللغة",
    estimation: "تقدير",
  },
  fr: {
    appTitle: "Rebar Estimator Pro",
    newEstimation: "Nouvelle estimation",
    projects: "Projets",
    lightMode: "Mode clair",
    darkMode: "Mode sombre",
    signOut: "Déconnexion",
    uploadBlueprints: "Téléchargez vos plans de construction et obtenez des estimations précises du poids des armatures et du treillis soudé par IA.",
    startNewEstimation: "Commencer une nouvelle estimation",
    welcomeMessage: "Rebar Estimator Pro",
    refresh: "Actualiser",
    language: "Langue",
    estimation: "Estimation",
  },
  es: {
    appTitle: "Rebar Estimator Pro",
    newEstimation: "Nueva estimación",
    projects: "Proyectos",
    lightMode: "Modo claro",
    darkMode: "Modo oscuro",
    signOut: "Cerrar sesión",
    uploadBlueprints: "Sube tus planos de construcción y obtén estimaciones precisas del peso de la armadura y la malla soldada con IA.",
    startNewEstimation: "Iniciar nueva estimación",
    welcomeMessage: "Rebar Estimator Pro",
    refresh: "Actualizar",
    language: "Idioma",
    estimation: "Estimación",
  },
  de: {
    appTitle: "Rebar Estimator Pro",
    newEstimation: "Neue Schätzung",
    projects: "Projekte",
    lightMode: "Heller Modus",
    darkMode: "Dunkler Modus",
    signOut: "Abmelden",
    uploadBlueprints: "Laden Sie Ihre Baupläne hoch und erhalten Sie präzise Bewehrungsgewicht- und Schweißgitterschätzungen mit KI.",
    startNewEstimation: "Neue Schätzung starten",
    welcomeMessage: "Rebar Estimator Pro",
    refresh: "Aktualisieren",
    language: "Sprache",
    estimation: "Schätzung",
  },
  tr: {
    appTitle: "Rebar Estimator Pro",
    newEstimation: "Yeni Tahmin",
    projects: "Projeler",
    lightMode: "Açık Mod",
    darkMode: "Koyu Mod",
    signOut: "Çıkış Yap",
    uploadBlueprints: "İnşaat planlarınızı yükleyin ve yapay zeka ile doğru donatı ağırlığı ve kaynaklı tel örgü tahminleri alın.",
    startNewEstimation: "Yeni Tahmin Başlat",
    welcomeMessage: "Rebar Estimator Pro",
    refresh: "Yenile",
    language: "Dil",
    estimation: "Tahmin",
  },
  zh: {
    appTitle: "钢筋估算专家",
    newEstimation: "新建估算",
    projects: "项目",
    lightMode: "浅色模式",
    darkMode: "深色模式",
    signOut: "退出登录",
    uploadBlueprints: "上传您的建筑蓝图，通过AI获取准确的钢筋重量和焊接网片估算。",
    startNewEstimation: "开始新估算",
    welcomeMessage: "钢筋估算专家",
    refresh: "刷新",
    language: "语言",
    estimation: "估算",
  },
  hi: {
    appTitle: "रीबार एस्टिमेटर प्रो",
    newEstimation: "नया अनुमान",
    projects: "प्रोजेक्ट",
    lightMode: "लाइट मोड",
    darkMode: "डार्क मोड",
    signOut: "साइन आउट",
    uploadBlueprints: "अपने निर्माण ब्लूप्रिंट अपलोड करें और AI द्वारा सटीक रीबार वजन और वेल्डेड वायर मेश अनुमान प्राप्त करें।",
    startNewEstimation: "नया अनुमान शुरू करें",
    welcomeMessage: "रीबार एस्टिमेटर प्रो",
    refresh: "रिफ्रेश",
    language: "भाषा",
    estimation: "अनुमान",
  },
  pt: {
    appTitle: "Rebar Estimator Pro",
    newEstimation: "Nova Estimativa",
    projects: "Projetos",
    lightMode: "Modo Claro",
    darkMode: "Modo Escuro",
    signOut: "Sair",
    uploadBlueprints: "Carregue seus projetos de construção e obtenha estimativas precisas de peso de armadura e malha soldada com IA.",
    startNewEstimation: "Iniciar Nova Estimativa",
    welcomeMessage: "Rebar Estimator Pro",
    refresh: "Atualizar",
    language: "Idioma",
    estimation: "Estimativa",
  },
};

interface LanguageContextType {
  language: Language;
  setLanguage: (lang: Language) => void;
  t: (key: TranslationKeys) => string;
  dir: "ltr" | "rtl";
  currentLanguageInfo: LanguageInfo;
}

const LanguageContext = createContext<LanguageContextType | null>(null);

export const useLanguage = () => {
  const ctx = useContext(LanguageContext);
  if (!ctx) throw new Error("useLanguage must be used within LanguageProvider");
  return ctx;
};

export const LanguageProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [language, setLanguageState] = useState<Language>(() => {
    const stored = localStorage.getItem("app-language");
    return (stored as Language) || "en";
  });

  const setLanguage = useCallback((lang: Language) => {
    setLanguageState(lang);
    localStorage.setItem("app-language", lang);
    const info = LANGUAGES.find((l) => l.code === lang)!;
    document.documentElement.dir = info.dir;
    document.documentElement.lang = lang;
  }, []);

  // Set initial dir/lang on mount
  React.useEffect(() => {
    const info = LANGUAGES.find((l) => l.code === language)!;
    document.documentElement.dir = info.dir;
    document.documentElement.lang = language;
  }, []);

  const t = useCallback(
    (key: TranslationKeys) => translations[language]?.[key] || translations.en[key] || key,
    [language]
  );

  const currentLanguageInfo = LANGUAGES.find((l) => l.code === language)!;

  return (
    <LanguageContext.Provider value={{ language, setLanguage, t, dir: currentLanguageInfo.dir, currentLanguageInfo }}>
      {children}
    </LanguageContext.Provider>
  );
};
