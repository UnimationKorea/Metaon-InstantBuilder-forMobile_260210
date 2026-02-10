/** @type {import('tailwindcss').Config} */
export default {
    content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
    theme: {
        extend: {
            fontFamily: {
                sans: ["Inter", "system-ui", "sans-serif"],
                serif: ["Noto Serif KR", "serif"],
            },
            colors: {
                // 메타온 브랜드 컬러
                metaon: {
                    primary: "#6366f1",
                    secondary: "#10b981",
                    accent: "#f59e0b",
                    dark: "#1e293b",
                    light: "#f8fafc",
                },
                // 스텝별 테마 컬러
                step1: {
                    50: "#fef3c7",
                    100: "#fde68a",
                    500: "#f59e0b",
                    600: "#d97706",
                    700: "#b45309",
                },
                step2: {
                    50: "#dbeafe",
                    100: "#bfdbfe",
                    500: "#3b82f6",
                    600: "#2563eb",
                    700: "#1d4ed8",
                },
                step3: {
                    50: "#d1fae5",
                    100: "#a7f3d0",
                    500: "#10b981",
                    600: "#059669",
                    700: "#047857",
                },
            },
            animation: {
                "fade-in": "fadeIn 0.3s ease-out",
                "slide-up": "slideUp 0.4s ease-out",
                "pulse-slow": "pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite",
                "bounce-subtle": "bounceSubtle 1s ease-in-out infinite",
            },
            keyframes: {
                fadeIn: {
                    from: { opacity: 0 },
                    to: { opacity: 1 },
                },
                slideUp: {
                    from: { opacity: 0, transform: "translateY(20px)" },
                    to: { opacity: 1, transform: "translateY(0)" },
                },
                bounceSubtle: {
                    "0%, 100%": { transform: "translateY(0)" },
                    "50%": { transform: "translateY(-5px)" },
                },
            },
            boxShadow: {
                glow: "0 0 20px rgba(99, 102, 241, 0.3)",
                "glow-green": "0 0 20px rgba(16, 185, 129, 0.3)",
                "glow-amber": "0 0 20px rgba(245, 158, 11, 0.3)",
            },
        },
    },
    plugins: [],
};
