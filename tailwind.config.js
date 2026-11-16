/** @type {import('tailwindcss').Config} */
export default {
    content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
    darkMode: 'class',
    theme: {
        extend: {
            fontFamily: {
                sans: ["'Google Sans'", "'Google Sans Text'", '-apple-system', 'BlinkMacSystemFont', "'Segoe UI'", 'Roboto', 'sans-serif'],
                mono: ["'Google Sans Code'", 'ui-monospace', 'SFMono-Regular', 'Consolas', 'monospace'],
            },
        },
    },
    plugins: [],
};
