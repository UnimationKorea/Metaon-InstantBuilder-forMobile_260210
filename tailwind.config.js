/** @type {import('tailwindcss').Config} */
export default {
    content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
    theme: {
        extend: {
            fontFamily: {
                display: ['"Plus Jakarta Sans"', "Inter", "system-ui", "sans-serif"],
                sans: ["Inter", "system-ui", "sans-serif"],
                serif: ['"Noto Sans KR"', "sans-serif"],
            },
            colors: {
                // 메타온 브랜드 컬러 (Bright & Trendy)
                metaon: {
                    primary: "#6366F1",
                    "primary-dark": "#4F46E5",
                    "primary-light": "#EEF2FF",
                    secondary: "#8B5CF6",
                    accent: "#F97316",
                    dark: "#0F172A",
                    light: "#F8FAFF",
                    surface: "#FFFFFF",
                    muted: "#64748B",
                    border: "#E2E8F0",
                },
                // Step 1: Coral/Orange — 에너지, 따뜻함
                step1: {
                    50: "#FFF7ED",
                    100: "#FFEDD5",
                    200: "#FED7AA",
                    500: "#F97316",
                    600: "#EA580C",
                    700: "#C2410C",
                },
                // Step 2: Electric Blue/Indigo — 집중, 생산성
                step2: {
                    50: "#EEF2FF",
                    100: "#E0E7FF",
                    200: "#C7D2FE",
                    500: "#6366F1",
                    600: "#4F46E5",
                    700: "#4338CA",
                },
                // Step 3: Teal/Emerald — 성취, 플레이
                step3: {
                    50: "#F0FDFA",
                    100: "#CCFBF1",
                    200: "#99F6E4",
                    500: "#14B8A6",
                    600: "#0D9488",
                    700: "#0F766E",
                },
            },
            animation: {
                "fade-in": "fadeIn 0.25s ease-out",
                "fade-up": "fadeUp 0.35s ease-out",
                "slide-up": "slideUp 0.35s ease-out",
                "scale-in": "scaleIn 0.2s ease-out",
                "pulse-slow": "pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite",
                "bounce-subtle": "bounceSubtle 1.5s ease-in-out infinite",
                shimmer: "shimmer 1.5s infinite",
                float: "float 4s ease-in-out infinite",
            },
            keyframes: {
                fadeIn: {
                    from: { opacity: "0" },
                    to: { opacity: "1" },
                },
                fadeUp: {
                    from: { opacity: "0", transform: "translateY(12px)" },
                    to: { opacity: "1", transform: "translateY(0)" },
                },
                slideUp: {
                    from: { opacity: "0", transform: "translateY(20px)" },
                    to: { opacity: "1", transform: "translateY(0)" },
                },
                scaleIn: {
                    from: { opacity: "0", transform: "scale(0.95)" },
                    to: { opacity: "1", transform: "scale(1)" },
                },
                bounceSubtle: {
                    "0%, 100%": { transform: "translateY(0)" },
                    "50%": { transform: "translateY(-6px)" },
                },
                shimmer: {
                    "0%": { backgroundPosition: "-200% 0" },
                    "100%": { backgroundPosition: "200% 0" },
                },
                float: {
                    "0%, 100%": { transform: "translateY(0px)" },
                    "50%": { transform: "translateY(-10px)" },
                },
            },
            boxShadow: {
                "card-sm": "0 1px 3px 0 rgb(0 0 0 / 0.06), 0 1px 2px -1px rgb(0 0 0 / 0.06)",
                "card-md": "0 4px 6px -1px rgb(0 0 0 / 0.07), 0 2px 4px -2px rgb(0 0 0 / 0.07)",
                "card-lg": "0 10px 15px -3px rgb(0 0 0 / 0.08), 0 4px 6px -4px rgb(0 0 0 / 0.05)",
                "card-hover": "0 20px 25px -5px rgb(0 0 0 / 0.08), 0 8px 10px -6px rgb(0 0 0 / 0.05)",
                "step1": "0 4px 14px 0 rgba(249, 115, 22, 0.2)",
                "step2": "0 4px 14px 0 rgba(99, 102, 241, 0.2)",
                "step3": "0 4px 14px 0 rgba(20, 184, 166, 0.2)",
                "inner-sm": "inset 0 1px 3px 0 rgb(0 0 0 / 0.06)",
            },
            backgroundImage: {
                "step1-gradient": "linear-gradient(135deg, #F97316, #FB923C)",
                "step2-gradient": "linear-gradient(135deg, #6366F1, #8B5CF6)",
                "step3-gradient": "linear-gradient(135deg, #14B8A6, #06B6D4)",
                "primary-gradient": "linear-gradient(135deg, #6366F1, #8B5CF6)",
                "hero-gradient": "linear-gradient(135deg, #EEF2FF 0%, #F8FAFF 50%, #F0FDFA 100%)",
                "shimmer-gradient": "linear-gradient(90deg, #f0f0f0 25%, #e0e0e0 50%, #f0f0f0 75%)",
            },
        },
    },
    plugins: [],
};
